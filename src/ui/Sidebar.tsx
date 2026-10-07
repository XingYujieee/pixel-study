import { memo, useEffect, useMemo, useState } from "react";
import { chooseVault, openPath } from "../app/actions";
import { importFromDialog } from "../app/importer";
import { useDocInfo } from "../app/editor";
import { bookColor } from "./world/ShelfGui";
import { useApp } from "../app/store";
import type { FileEntry } from "../ipc";
import { basename, dirname, extname } from "../lib/paths";
import { ancestors, buildTree, type TreeDir } from "../lib/tree";

export function Sidebar() {
  const vault = useApp((s) => s.vault)!;
  const files = useApp((s) => s.files);
  const version = useApp((s) => s.filesVersion);
  const scanning = useApp((s) => s.scanning);
  const scanned = useApp((s) => s.scanned);
  const recent = useApp((s) => s.recent);
  const selected = useApp((s) => s.selected);

  const tree = useMemo(() => buildTree(files.values()), [files, version]);
  const [open, setOpen] = useState<Set<string>>(() => new Set());

  // 展开到当前文件
  useEffect(() => {
    if (!selected) return;
    setOpen((prev) => {
      const need = ancestors(selected).filter((a) => !prev.has(a));
      if (need.length === 0) return prev;
      const next = new Set(prev);
      need.forEach((a) => next.add(a));
      return next;
    });
  }, [selected]);

  const toggle = (path: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const recentShown = recent.filter((p) => files.has(p)).slice(0, 6);

  return (
    <aside className="sidebar">
      <div className="drag-strip" data-tauri-drag-region />
      <div className="vault-head">
        <button className="vault-name" onClick={() => void chooseVault()} title={`${vault.root}\n点击切换笔记库`}>
          <span className="vault-glyph" aria-hidden />
          <span className="ellipsis">{vault.name}</span>
        </button>
      </div>

      <button className="search-trigger" onClick={() => useApp.getState().setQuickOpen(true)}>
        <span>搜索笔记</span>
        <kbd>⌘K</kbd>
      </button>

      <div className="side-actions">
        <button className="btn small" onClick={() => useApp.getState().setNewNote(true)} title="新建笔记（⌘N）">
          ＋ 新建
        </button>
        <button className="btn small ghost" onClick={() => void importFromDialog()} title="复制外部文件到库内 Imports 文件夹（⌘O，也可以直接把文件拖进窗口）">
          导入
        </button>
      </div>

      <div className="side-scroll">
        {recentShown.length > 0 && (
          <section className="side-section">
            <h3>最近打开</h3>
            {recentShown.map((p) => (
              <FileRow key={p} path={p} label={basename(p)} hint={dirname(p)} active={p === selected} depth={0} />
            ))}
          </section>
        )}

        <section className="side-section">
          <h3>
            全部文件
            <span className="count">{scanning ? `扫描中 ${scanned}` : tree.count}</span>
          </h3>
          <DirChildren dir={tree} depth={0} open={open} toggle={toggle} selected={selected} />
          {!scanning && tree.count === 0 && <p className="side-empty">这个库还是空的。按 ⌘N 写下第一篇笔记。</p>}
        </section>
      </div>
    </aside>
  );
}

const DirChildren = memo(function DirChildren({
  dir,
  depth,
  open,
  toggle,
  selected,
}: {
  dir: TreeDir;
  depth: number;
  open: Set<string>;
  toggle: (p: string) => void;
  selected: string | null;
}) {
  return (
    <>
      {dir.dirs.map((d) => {
        const isOpen = open.has(d.path);
        return (
          <div key={d.path}>
            <button className="tree-row dir" style={{ paddingLeft: 10 + depth * 14 }} onClick={() => toggle(d.path)}>
              <span className={`caret ${isOpen ? "open" : ""}`} aria-hidden />
              <span className="ellipsis">{d.name}</span>
              <span className="count">{d.count}</span>
            </button>
            {isOpen && <DirChildren dir={d} depth={depth + 1} open={open} toggle={toggle} selected={selected} />}
          </div>
        );
      })}
      {dir.files.map((f) => (
        <FileRow key={f.path} path={f.path} entry={f} label={f.name} active={f.path === selected} depth={depth} />
      ))}
    </>
  );
});

function FileRow({
  path,
  label,
  hint,
  active,
  depth,
  entry,
}: {
  path: string;
  label: string;
  hint?: string;
  active: boolean;
  depth: number;
  entry?: FileEntry;
}) {
  const info = useDocInfo(path);
  const ext = extname(path);
  const kind = entry?.kind ?? (ext === "md" || ext === "markdown" ? "markdown" : ext === "txt" ? "text" : ext === "docx" ? "word" : "other");
  const shown = kind === "markdown" ? label.replace(/\.(md|markdown)$/i, "") : label;
  return (
    <button
      className={`tree-row file k-${kind} ${active ? "active" : ""}`}
      style={{ paddingLeft: 10 + depth * 14 + 14 }}
      onClick={() => void openPath(path)}
      title={path}
    >
      <span className={`spine k-${kind}`} style={kind === "markdown" || kind === "word" ? { background: bookColor(path, kind) } : undefined} aria-hidden />
      <span className="ellipsis">{shown}</span>
      {hint && <span className="hint ellipsis">{hint}</span>}
      {info && info.status !== "clean" && info.status !== "saving" && <i className={`dot s-${info.status}`} />}
    </button>
  );
}
