import { useEffect, useLayoutEffect, useRef } from "react";
import { openExternal } from "../app/actions";
import { controller, useActiveText, useDocInfo, word, type AnyInfo } from "../app/editor";
import { useApp } from "../app/store";
import { isWordPath } from "../lib/paths";
import { countWords, formatTime } from "../lib/text";
import { ConflictView } from "./ConflictView";
import { Preview } from "./Preview";

/**
 * 编辑表面：把唯一的编辑器（CodeMirror 或 Word 编辑区）移入此处。
 * 书桌写作与专注模式共用；切换时只移动 DOM，不重建实例（撤销记录保留）。
 */
export function DocSurface({ path, variant }: { path: string; variant: "book" | "focus" }) {
  const host = useRef<HTMLDivElement>(null);
  const isWord = isWordPath(path);
  const info = useDocInfo(path);
  const preview = useApp((s) => s.preview);
  const text = useActiveText(path);
  const ready = isWord ? word.activePath === path : controller.activePath === path;

  useLayoutEffect(() => {
    if (!host.current) return;
    if (isWord) word.moveTo(host.current);
    else controller.moveTo(host.current);
  });

  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => (isWord ? word.focus() : controller.focus()), 30);
    return () => clearTimeout(t);
  }, [ready, path, isWord]);

  const textConflict = info?.kind === "text" && info.status === "conflict" && info.conflict ? info : null;
  const showPreview = !isWord && preview === "split" && !textConflict && ready && /\.(md|markdown)$/i.test(path);

  return (
    <div className={`doc-surface v-${variant} ${isWord ? "is-word" : "is-text"}`}>
      {info?.status === "missing" && <MissingBanner path={path} />}
      {info?.kind === "word" && info.status === "conflict" && <WordConflictBanner path={path} />}
      {info?.kind === "word" && info.readOnly && <LossyBanner path={path} lossy={info.lossy} />}
      {isWord && info?.kind === "word" && !info.readOnly && <WordToolbar />}
      <div className={`doc-body ${showPreview ? "split" : ""}`}>
        <div className="editor-host" ref={host} hidden={!!textConflict} />
        {textConflict && <ConflictView info={textConflict} />}
        {showPreview && <Preview text={text} notePath={path} />}
      </div>
      <StatusBar info={info} text={ready ? text : ""} />
    </div>
  );
}

function MissingBanner({ path }: { path: string }) {
  const isWord = isWordPath(path);
  return (
    <div className="banner warn">
      <span>这个文件已在外部被删除或移走。内容仍在编辑器中，不会自动重新创建。</span>
      <span className="banner-actions">
        <button className="btn" onClick={() => void (isWord ? word.recreate(path) : controller.recreate(path))}>
          按当前内容重新创建
        </button>
        <button
          className="btn ghost"
          onClick={() => {
            if (isWord) word.discard(path);
            else controller.discard(path);
            useApp.getState().select(null);
          }}
        >
          关闭
        </button>
      </span>
    </div>
  );
}

function WordConflictBanner({ path }: { path: string }) {
  return (
    <div className="banner warn">
      <span>这份 Word 文档在别处被修改了。你的修改还没写入磁盘。</span>
      <span className="banner-actions">
        <button className="btn" onClick={() => void word.resolveConflict(path, "disk")}>
          载入磁盘版本
        </button>
        <button className="btn" onClick={() => void word.resolveConflict(path, "mine")}>
          保留我的版本（备份原文件）
        </button>
      </span>
    </div>
  );
}

function LossyBanner({ path, lossy }: { path: string; lossy: string[] }) {
  return (
    <div className="banner">
      <span>
        这份文档包含 <strong>{lossy.join("、")}</strong>。在这里编辑保存后，这些格式可能被简化。现在是只读预览。
      </span>
      <span className="banner-actions">
        <button className="btn" onClick={() => word.allowEditing(path)} title="首次保存前会把原文件备份到应用数据目录">
          仍然编辑（自动备份原文件）
        </button>
        <button className="btn ghost" onClick={() => void openExternal(path)}>
          用 Word 打开
        </button>
      </span>
    </div>
  );
}

function WordToolbar() {
  const b = (label: string, title: string, fn: () => void, cls = "") => (
    <button
      className={`tb ${cls}`}
      title={title}
      onMouseDown={(e) => {
        e.preventDefault();
        fn();
      }}
    >
      {label}
    </button>
  );
  return (
    <div className="word-toolbar" role="toolbar">
      {b("正文", "正文段落", () => word.block("p"))}
      {b("标题1", "一级标题", () => word.block("h1"))}
      {b("标题2", "二级标题", () => word.block("h2"))}
      {b("标题3", "三级标题", () => word.block("h3"))}
      <span className="tb-sep" />
      {b("B", "粗体 ⌘B", () => word.exec("bold"), "b")}
      {b("I", "斜体 ⌘I", () => word.exec("italic"), "i")}
      {b("U", "下划线 ⌘U", () => word.exec("underline"), "u")}
      {b("S", "删除线", () => word.exec("strikeThrough"), "s")}
      <span className="tb-sep" />
      {b("• 列表", "项目符号", () => word.exec("insertUnorderedList"))}
      {b("1. 编号", "编号列表", () => word.exec("insertOrderedList"))}
      {b("❝ 引用", "引用", () => word.block("blockquote"))}
      <span className="tb-sep" />
      {b("清除格式", "清除选中文字的格式", () => word.exec("removeFormat"))}
    </div>
  );
}

const STATUS_TEXT: Record<AnyInfo["status"], string> = {
  clean: "已保存",
  dirty: "未保存",
  saving: "保存中…",
  error: "保存失败",
  conflict: "有冲突，等待处理",
  missing: "文件已被删除",
};

function StatusBar({ info, text }: { info?: AnyInfo; text: string }) {
  const words = countWords(text);
  return (
    <footer className="statusbar">
      {info && (
        <span className={`save-state s-${info.status}`} title={info.error}>
          <i className="pip" />
          {info.kind === "word" && info.readOnly ? "只读预览" : STATUS_TEXT[info.status]}
          {info.status === "error" && info.error ? `：${info.error}（将自动重试）` : ""}
          {info.status === "clean" && info.lastSavedAt ? ` · ${formatTime(info.lastSavedAt).slice(11)}` : ""}
        </span>
      )}
      <span className="spacer" />
      {info?.kind === "text" && info.lineSeparator === "\r\n" && <span className="meta">CRLF</span>}
      {info?.kind === "word" && <span className="meta">Word</span>}
      <span className="meta">{words.toLocaleString("zh-CN")} 字</span>
      <span className="meta kbd-hint">⌘S 保存</span>
    </footer>
  );
}
