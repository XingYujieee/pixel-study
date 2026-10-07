import { openExternal, revealInFinder } from "../app/actions";
import { useApp } from "../app/store";
import { exitFocus } from "../app/worldActions";
import { basename, dirname, isEditablePath, isWordPath } from "../lib/paths";
import { formatBytes, formatTime } from "../lib/text";
import { DocSurface } from "./DocSurface";
import { LiveToggle } from "./LiveToggle";

/** 专注模式的主区域 */
export function EditorPane() {
  const selected = useApp((s) => s.selected);
  const unreadable = useApp((s) => s.unreadable);
  if (!selected) return <EmptyState />;
  if (!isEditablePath(selected) || unreadable.has(selected)) return <FileCard path={selected} />;
  return (
    <section className="note">
      <NoteHead path={selected} />
      <DocSurface path={selected} variant="focus" />
    </section>
  );
}

function NoteHead({ path }: { path: string }) {
  const preview = useApp((s) => s.preview);
  return (
    <header className="note-head" data-tauri-drag-region>
      <div className="crumbs" title={path}>
        {dirname(path) && <span className="crumb-dir">{dirname(path).split("/").join(" / ")} /</span>}
        <span className="crumb-name">{basename(path).replace(/\.(md|markdown)$/i, "")}</span>
      </div>
      <div className="note-tools">
        {!isWordPath(path) && /\.(md|markdown)$/i.test(path) && <LiveToggle className="btn ghost" />}
        {!isWordPath(path) && (
          <button className={`btn ghost ${preview === "split" ? "on" : ""}`} onClick={() => useApp.getState().togglePreview()} title="预览（⌘E）">
            预览
          </button>
        )}
        <button className="btn ghost" onClick={() => void revealInFinder(path)} title="在 Finder 中显示">
          Finder
        </button>
        <button className="btn small" onClick={exitFocus} title="回到书房（⌘J）">
          回到书房
        </button>
      </div>
    </header>
  );
}

function FileCard({ path }: { path: string }) {
  const entry = useApp((s) => s.files.get(path));
  const ext = path.split(".").pop()?.toUpperCase() ?? "";
  return (
    <section className="filecard-wrap">
      <div className="filecard">
        <div className="filecard-icon">{ext.slice(0, 4) || "FILE"}</div>
        <h2>{basename(path)}</h2>
        <p className="muted">
          {dirname(path) || "库根目录"}
          {entry && ` · ${formatBytes(entry.size)} · 修改于 ${formatTime(entry.mtime)}`}
        </p>
        <p className="muted small">这种文件用系统默认应用打开。</p>
        <div className="row">
          <button className="btn primary" onClick={() => void openExternal(path)}>
            用系统应用打开
          </button>
          <button className="btn" onClick={() => void revealInFinder(path)}>
            在 Finder 中显示
          </button>
        </div>
      </div>
    </section>
  );
}

function EmptyState() {
  return (
    <section className="empty">
      <div className="empty-art" aria-hidden>
        {Array.from({ length: 7 }, (_, i) => (
          <i key={i} style={{ height: `${46 + ((i * 37) % 28)}px` }} />
        ))}
      </div>
      <h2>挑一本书，开始写吧</h2>
      <dl className="shortcuts">
        <dt>⌘K</dt>
        <dd>搜索文件名和正文</dd>
        <dt>⌘J</dt>
        <dd>回到书房</dd>
        <dt>⌘E</dt>
        <dd>切换预览</dd>
        <dt>⌘S</dt>
        <dd>立即保存（平时会自动保存）</dd>
        <dt>/</dt>
        <dd>行首或中文后输入 /（输入法里是「、」）：插入标题、待办、表格、提示框……</dd>
        <dt>选中文字</dt>
        <dd>上方出现工具条：字号、粗体、斜体、下划线、删除线、高亮、颜色</dd>
        <dt>⌘B ⌘I ⌘U</dt>
        <dd>粗体、斜体、下划线；⌘⇧X 删除线，⌘⇧H 高亮，⌘⌥1/2/3 标题，⌘⇧9 待办，⌘↩ 勾选</dd>
        <dt>Tab</dt>
        <dd>表格里跳到下一格并自动对齐，最后一格新起一行</dd>
      </dl>
    </section>
  );
}
