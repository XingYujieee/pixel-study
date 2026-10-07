import { useMemo, useState } from "react";
import { revealInFinder } from "../../app/actions";
import { useApp } from "../../app/store";
import { enterFocus, standUp, takeBook } from "../../app/worldActions";
import { useWorld } from "../../app/worldStore";
import { fuzzyFiles } from "../../lib/fuzzy";
import { basename, dirname, isEditablePath, isWordPath } from "../../lib/paths";
import { DocSurface } from "../DocSurface";
import { BookIcon } from "./ShelfGui";
import { HourglassChip } from "./HourglassChip";
import { useImeSafeKeys } from "./useImeSafeKeys";
import { LiveToggle } from "../LiveToggle";

/** 坐在书桌前：摊开的书承载编辑区。镜头固定，书页与屏幕平行，输入法候选窗不偏移。 */
export function WritingDesk() {
  const selected = useApp((s) => s.selected);
  const unreadable = useApp((s) => s.unreadable);
  const preview = useApp((s) => s.preview);
  const [choosing, setChoosing] = useState(false);
  const path = selected && isEditablePath(selected) && !unreadable.has(selected) ? selected : null;
  const showPicker = choosing || !path;

  return (
    <div className="desk-overlay">
      <div className="book-frame">
        <div className="book-head">
          <div className="book-title mc-text" title={path ?? ""}>
            {path ? basename(path).replace(/\.(md|markdown)$/i, "") : "选一本书"}
            {path && dirname(path) && <span className="book-dir">{dirname(path)}</span>}
          </div>
          <div className="book-tools">
            <HourglassChip />
            {path && !showPicker && /\.(md|markdown)$/i.test(path) && <LiveToggle className="mc-btn small" />}
            {path && !showPicker && !isWordPath(path) && (
              <button className={`mc-btn small ${preview === "split" ? "on" : ""}`} onClick={() => useApp.getState().togglePreview()} title="⌘E">
                预览
              </button>
            )}
            {path && (
              <button className="mc-btn small" onClick={() => setChoosing(!choosing)}>
                {choosing ? "回到这本" : "换一本"}
              </button>
            )}
            {path && (
              <button className="mc-btn small" onClick={() => void revealInFinder(path)}>
                Finder
              </button>
            )}
            {path && (
              <button className="mc-btn small" onClick={enterFocus} title="⌘J">
                全屏专注
              </button>
            )}
            <button className="mc-btn small" onClick={() => void standUp()} title="Esc">
              起身
            </button>
          </div>
        </div>
        <div className="book-page">
          {showPicker ? (
            <BookPicker
              onPick={(p) => {
                setChoosing(false);
                void takeBook(p, useWorld.getState().deskId ?? undefined);
              }}
            />
          ) : (
            <DocSurface path={path!} variant="book" />
          )}
        </div>
      </div>
      <div className="desk-hint mc-text small">输入 / 插入标题、表格、待办 · 选中文字出格式工具条 · Esc 起身 · ⌘S 保存 · ⌘J 全屏专注</div>
    </div>
  );
}

function BookPicker({ onPick }: { onPick: (path: string) => void }) {
  const files = useApp((s) => s.files);
  const v = useApp((s) => s.filesVersion);
  const recent = useApp((s) => s.recent);
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const editable = [...files.values()].filter((e) => e.kind !== "other");
    if (q.trim()) return fuzzyFiles(q, editable, 40).map((m) => m.entry);
    const r = recent.map((p) => files.get(p)).filter((e): e is NonNullable<typeof e> => !!e && e.kind !== "other");
    const rest = editable.filter((e) => !recent.includes(e.path)).sort((a, b) => b.mtime - a.mtime);
    return [...r, ...rest].slice(0, 40);
  }, [files, v, q, recent]);
  const keys = useImeSafeKeys({ onEnter: () => list[0] && onPick(list[0].path) });
  return (
    <div className="book-picker">
      <input className="mc-input" autoFocus placeholder="搜索要写的书…" value={q} onChange={(e) => setQ(e.target.value)} {...keys} />
      <div className="picker-list tall">
        {list.map((e) => (
          <button key={e.path} className="picker-row" onClick={() => onPick(e.path)}>
            <BookIcon path={e.path} kind={e.kind} />
            <span className="ellipsis">{e.name}</span>
            <span className="hint ellipsis">{dirname(e.path)}</span>
          </button>
        ))}
      </div>
      <p className="mc-text small panel-note">
        想写新的？到 <strong>工作台</strong> 制作一本 Markdown、Word 或 TXT。
        <button className="mc-btn small" onClick={() => useWorld.getState().openGui({ kind: "workbench" })}>
          去工作台
        </button>
      </p>
    </div>
  );
}
