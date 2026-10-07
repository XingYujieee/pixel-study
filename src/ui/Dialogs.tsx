import { useRef, useState } from "react";
import { openPath, refreshDrafts } from "../app/actions";
import { controller, docInfo, word } from "../app/editor";
import { craftBook, type BookType } from "../app/worldActions";
import { isWordPath } from "../lib/paths";
import { useApp } from "../app/store";
import { formatTime } from "../lib/text";

function defaultName() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `未命名 ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}`;
}

export function NewNoteDialog() {
  const open = useApp((s) => s.newNote);
  if (!open) return null;
  return <NewNoteInner />;
}

function NewNoteInner() {
  const [name, setName] = useState(defaultName);
  const [type, setType] = useState<BookType>("md");
  const composing = useRef(false);
  const close = () => useApp.getState().setNewNote(false);
  const submit = () => {
    if (!name.trim()) return;
    close();
    void craftBook(type, name.trim(), null).then((p) => { if (p) void openPath(p); });
  };
  return (
    <div className="overlay" onMouseDown={close}>
      <div className="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <h3>新建笔记</h3>
        <input
          autoFocus
          className="field"
          value={name}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setName(e.target.value)}
          onCompositionStart={() => (composing.current = true)}
          onCompositionEnd={() => setTimeout(() => (composing.current = false), 0)}
          onKeyDown={(e) => {
            if (composing.current || e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (e.key === "Enter") submit();
            if (e.key === "Escape") close();
          }}
        />
        <div className="row type-row">
          {(["md", "docx", "txt"] as BookType[]).map((t) => (
            <button key={t} className={`btn small ${type === t ? "primary" : "ghost"}`} onClick={() => setType(t)}>
              {t === "md" ? "Markdown" : t === "docx" ? "Word" : "TXT"}
            </button>
          ))}
        </div>
        <p className="muted small">保存在 Notes/ 文件夹；同名时自动加序号。</p>
        <div className="row end">
          <button className="btn ghost" onClick={close}>
            取消
          </button>
          <button className="btn primary" onClick={submit} disabled={!name.trim()}>
            创建
          </button>
        </div>
      </div>
    </div>
  );
}

/** 异常退出后留下的草稿 */
export function DraftBanner() {
  const drafts = useApp((s) => s.drafts);
  const [expanded, setExpanded] = useState(true);
  const pending = drafts.filter((d) => {
    const info = docInfo(d.path);
    return !info || info.status === "clean";
  });
  if (pending.length === 0) return null;
  const remove = (path: string) => useApp.getState().setDrafts(useApp.getState().drafts.filter((d) => d.path !== path));
  return (
    <div className="banner draft">
      <div className="banner-line">
        <span>
          发现 <strong>{pending.length}</strong> 份未保存的草稿，可能来自上次异常退出。
        </span>
        <button className="btn ghost small" onClick={() => setExpanded(!expanded)}>
          {expanded ? "收起" : "查看"}
        </button>
      </div>
      {expanded && (
        <ul className="draft-list">
          {pending.map((d) => (
            <li key={d.path}>
              <span className="ellipsis" title={d.path}>
                {d.path}
              </span>
              <span className="muted small">{formatTime(d.savedAt)}</span>
              <button
                className="btn small"
                onClick={async () => {
                  remove(d.path);
                  if (isWordPath(d.path)) await word.restoreDraft(d);
                  else await controller.restoreDraft(d);
                  useApp.getState().select(d.path);
                }}
              >
                恢复
              </button>
              <button
                className="btn small ghost"
                onClick={async () => {
                  remove(d.path);
                  await controller.discardDraft(d);
                  void refreshDrafts();
                }}
              >
                丢弃
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  return (
    <div className="toasts" role="status">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`} onClick={() => useApp.getState().dismiss(t.id)}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
