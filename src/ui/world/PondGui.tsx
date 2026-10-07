import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../../app/store";
import { archiveIdea, castIdea, releaseIdea, restoreIdea, takeBubble, useStudy } from "../../app/study";
import { takeBook } from "../../app/worldActions";
import { useWorld } from "../../app/worldStore";
import { api } from "../../ipc";
import { basename, dirname } from "../../lib/paths";
import { ideaPreview, inboxItems, relativeAge } from "../../study/inbox";
import type { Surfacing } from "../../study/bubble";
import { WEATHER_NAMES } from "../../world/sky";
import { BookIcon } from "./ShelfGui";
import { useImeSafeKeys } from "./useImeSafeKeys";

/** 抛竿输入框：Enter 放进鱼塘，Shift+Enter 换行 */
export function CastInput({ onCast, onEscape, autoFocus }: { onCast?: (path: string) => void; onEscape?: () => void; autoFocus?: boolean }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const cast = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    const p = await castIdea(text);
    setBusy(false);
    if (p) {
      setText("");
      onCast?.(p);
    }
  };
  const keys = useImeSafeKeys({
    onEnter: (e) => {
      if (e.shiftKey) {
        // 让 Shift+Enter 正常换行
        const el = e.target as HTMLTextAreaElement;
        const { selectionStart: a, selectionEnd: b, value } = el;
        setText(value.slice(0, a) + "\n" + value.slice(b));
        requestAnimationFrame(() => el.setSelectionRange(a + 1, a + 1));
        return;
      }
      void cast();
    },
    onEscape: onEscape ? () => onEscape() : undefined,
  });
  return (
    <div className="cast-row">
      <textarea
        className="mc-input cast-input"
        rows={2}
        autoFocus={autoFocus}
        placeholder="想到什么写一句…（Enter 抛进鱼塘，Shift+Enter 换行）"
        value={text}
        onChange={(e) => setText(e.target.value)}
        {...keys}
      />
      <button className="mc-btn on" disabled={!text.trim() || busy} onClick={() => void cast()}>
        抛竿
      </button>
    </div>
  );
}

interface Released {
  name: string;
  trash: string;
  dir: string;
}

/** 鱼塘：灵感池列表。写成笔记、放上书架（归档）、放生（移到 .trash，可撤销）。 */
export function PondGui() {
  const files = useApp((s) => s.files);
  const filesVersion = useApp((s) => s.filesVersion);
  const layout = useWorld((s) => s.layout);
  useWorld((s) => s.layoutVersion);
  const close = () => useWorld.getState().closeGui();
  const items = useMemo(() => inboxItems(files.values()), [files, filesVersion]);
  const shelves = layout?.furniture.filter((f) => f.type === "bookshelf" && f.shelf) ?? [];
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [archiving, setArchiving] = useState<string | null>(null);
  const [target, setTarget] = useState(() => shelves.find((s) => s.shelf?.mode === "virtual")?.id ?? shelves[0]?.id ?? "");
  const [released, setReleased] = useState<Released[]>([]);
  const [surfaced] = useState<Surfacing | null>(() => takeBubble());
  const env = layout?.env;
  const now = Date.now();

  // 读取预览（只读前 60 条的文本）
  const loaded = useRef(new Set<string>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const want = items.slice(0, 60).map((i) => i.path);
    if (surfaced?.kind === "book") want.unshift(surfaced.path);
    for (const p of want) {
      if (loaded.current.has(p) || /\.docx$/i.test(p)) continue;
      loaded.current.add(p);
      api
        .noteRead(p)
        .then((n) => mounted.current && setPreviews((m) => ({ ...m, [p]: ideaPreview(n.content) })))
        .catch(() => loaded.current.delete(p));
    }
  }, [items, surfaced]);

  const write = async (path: string) => {
    useWorld.getState().closeGui();
    await takeBook(path);
  };

  const release = async (path: string) => {
    const trash = await releaseIdea(path);
    if (trash) setReleased((r) => [{ name: basename(path), trash, dir: dirname(path) }, ...r].slice(0, 5));
  };

  const undo = async (r: Released) => {
    if (await restoreIdea(r.trash, r.dir)) setReleased((list) => list.filter((x) => x !== r));
  };

  const archive = async (path: string) => {
    if (!target) return;
    if (await archiveIdea(path, target)) setArchiving(null);
  };

  const surfacedEntry = surfaced ? files.get(surfaced.path) : undefined;

  return (
    <div className="mc-overlay" onMouseDown={close}>
      <div className="mc-panel pond-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h2 className="mc-title">鱼塘 · 灵感池</h2>
          <span className="spacer" />
          <span className="mc-text small">{items.length ? `${items.length} 条待整理` : "空空的，很平静"}</span>
        </div>
        <CastInput autoFocus />
        {env?.weather === "inbox" && (
          <p className="mc-text small panel-note">
            窗外天气正跟随鱼塘：少于 {Math.ceil(env.inboxThreshold / 2)} 条是晴天，{env.inboxThreshold} 条起下雨，{env.inboxThreshold * 2} 条起{WEATHER_NAMES.storm}。
          </p>
        )}

        {surfaced && surfacedEntry && (
          <div className="surfaced">
            <span className="mc-text small">{surfaced.kind === "idea" ? "浮上来一条放了几天的灵感：" : "浮上来一本很久没翻的书："}</span>
            <div className="picker-row static">
              <BookIcon path={surfaced.path} kind={surfacedEntry.kind} />
              <span className="idea-text">
                <b>{basename(surfaced.path).replace(/\.(md|markdown|txt)$/i, "")}</b>
                {previews[surfaced.path] && <span className="idea-preview">{previews[surfaced.path]}</span>}
              </span>
              <span className="hint">{relativeAge(surfacedEntry.mtime, now)}</span>
              <button className="mc-btn small" onClick={() => void write(surfaced.path)}>
                翻开
              </button>
            </div>
          </div>
        )}

        <div className="picker-list tall pond-list">
          {items.length === 0 && <p className="mc-text small ai-empty">想到什么就抛进来，之后再慢慢整理。也可以在书房里随时按 C，或在任何地方按 ⌘⇧I。</p>}
          {items.map((it) => (
            <div key={it.path} className="picker-row static idea-row">
              <BookIcon path={it.path} kind={it.kind} />
              <span className="idea-text">
                <span className="idea-preview">{previews[it.path] ?? basename(it.path)}</span>
                <span className="hint">{relativeAge(it.mtime, now)}</span>
              </span>
              {archiving === it.path ? (
                <span className="idea-actions">
                  <select className="mc-select" value={target} onChange={(e) => setTarget(e.target.value)} autoFocus>
                    {shelves.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.shelf!.name}
                        {s.shelf!.mode === "folder" ? `（${s.shelf!.folder || "根目录"}）` : "（收藏 · Notes/）"}
                      </option>
                    ))}
                  </select>
                  <button className="mc-btn small on" disabled={!target} onClick={() => void archive(it.path)}>
                    放上去
                  </button>
                  <button className="mc-btn small" onClick={() => setArchiving(null)}>
                    取消
                  </button>
                </span>
              ) : (
                <span className="idea-actions">
                  <button className="mc-btn small" onClick={() => void write(it.path)} title="带到书桌，展开写成笔记">
                    写成笔记
                  </button>
                  <button className="mc-btn small" disabled={!shelves.length} onClick={() => setArchiving(it.path)} title="移到某个书架对应的文件夹">
                    放上书架
                  </button>
                  <button className="mc-btn small" onClick={() => void release(it.path)} title="移到库里的 .trash 文件夹（Obsidian 的回收站），可以撤销">
                    放生
                  </button>
                </span>
              )}
            </div>
          ))}
        </div>
        {released.map((r) => (
          <div key={r.trash} className="released mc-text small">
            已放生「{r.name}」到 .trash/
            <button className="mc-btn small" onClick={() => void undo(r)}>
              撤销
            </button>
          </div>
        ))}
        <div className="panel-foot">
          <span className="mc-text small panel-note">灵感存放在 Inbox/，是普通的 Markdown 文件，Obsidian 里也能看到。</span>
          <span className="spacer" />
          <button className="mc-btn" onClick={close}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

/** 随手记：任何时候按 ⌘⇧I（书房里按 C）弹出，写一句就扔进鱼塘 */
export function CaptureDialog() {
  const open = useStudy((s) => s.capture);
  if (!open) return null;
  const close = () => useStudy.setState({ capture: false });
  return (
    <div className="mc-overlay capture-overlay" onMouseDown={close}>
      <div className="mc-panel capture-panel" onMouseDown={(e) => e.stopPropagation()}>
        <h2 className="mc-title">抛一竿</h2>
        <CastInput autoFocus onCast={close} onEscape={close} />
        <p className="mc-text small panel-note">存到 Inbox/，之后在鱼塘里整理。Esc 关闭。</p>
      </div>
    </div>
  );
}
