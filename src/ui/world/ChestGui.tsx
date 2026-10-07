import { useMemo, useState } from "react";
import { openExternal, revealInFinder } from "../../app/actions";
import { importFromDialog, shelveFiles, unsortedImports } from "../../app/importer";
import { sideBySideWithFinder } from "../../app/sideBySide";
import { useApp } from "../../app/store";
import { takeBook } from "../../app/worldActions";
import { useWorld } from "../../app/worldStore";
import type { FileEntry } from "../../ipc";
import { fuzzyFiles } from "../../lib/fuzzy";
import { dirname } from "../../lib/paths";
import { formatBytes } from "../../lib/text";
import { BookIcon } from "./ShelfGui";
import { useImeSafeKeys } from "./useImeSafeKeys";

type Tab = "sort" | "all";

/** 资料箱：分拣台（还没上架的导入文件，多选后一次放上书架）+ 全部资料浏览 */
export function ChestGui() {
  const files = useApp((s) => s.files);
  const v = useApp((s) => s.filesVersion);
  const layout = useWorld((s) => s.layout);
  const lv = useWorld((s) => s.layoutVersion);
  const shelves = layout?.furniture.filter((f) => f.type === "bookshelf" && f.shelf) ?? [];
  const [tab, setTab] = useState<Tab>("sort");
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState(() => shelves.find((s) => s.shelf?.mode === "folder")?.id ?? shelves[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const close = () => useWorld.getState().closeGui();

  const unsorted = useMemo(() => {
    const refs = new Set<string>();
    for (const f of layout?.furniture ?? []) if (f.shelf?.mode === "virtual") for (const r of f.shelf.refs) refs.add(r);
    return unsortedImports(files.values(), refs);
  }, [files, v, layout, lv]);

  const list = useMemo(() => {
    if (tab === "sort") return q.trim() ? fuzzyFiles(q, unsorted, 200).map((m) => m.entry) : unsorted;
    const pool = [...files.values()].filter((e) => all || e.kind === "other");
    if (q.trim()) return fuzzyFiles(q, pool, 80).map((m) => m.entry);
    return pool.sort((a, b) => b.mtime - a.mtime).slice(0, 80);
  }, [tab, unsorted, files, v, q, all]);
  const keys = useImeSafeKeys({ onEscape: close });

  const toggle = (p: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });
  const pickedNow = list.filter((e) => picked.has(e.path)).map((e) => e.path);
  const shelve = async () => {
    if (!target || !pickedNow.length) return;
    setBusy(true);
    await shelveFiles(pickedNow, target);
    setPicked(new Set());
    setBusy(false);
  };

  return (
    <div className="mc-overlay" onMouseDown={close}>
      <div className="mc-panel chest-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h2 className="mc-title">资料箱</h2>
          <div className="seg">
            <button className={`mc-btn small ${tab === "sort" ? "on" : ""}`} onClick={() => setTab("sort")}>
              待分拣 {unsorted.length ? `(${unsorted.length})` : ""}
            </button>
            <button className={`mc-btn small ${tab === "all" ? "on" : ""}`} onClick={() => setTab("all")}>
              全部资料
            </button>
          </div>
          <button className="mc-btn" onClick={() => void importFromDialog()} title="复制到库内 Imports 文件夹，原文件不变（⌘O）">
            导入文件…
          </button>
          <button className="mc-btn" onClick={() => void sideBySideWithFinder()} title="书房缩到左边，访达在右边打开库文件夹，直接拖文件进来">
            与访达并排
          </button>
        </div>
        <div className="folder-bar">
          <input className="mc-input" placeholder={tab === "sort" ? "在待分拣里搜索…" : "搜索资料…"} value={q} onChange={(e) => setQ(e.target.value)} {...keys} />
          {tab === "all" ? (
            <label className="mc-check">
              <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> 包括笔记与文档
            </label>
          ) : (
            <label className="mc-check">
              <input
                type="checkbox"
                checked={list.length > 0 && pickedNow.length === list.length}
                onChange={(e) => setPicked(e.target.checked ? new Set(list.map((x) => x.path)) : new Set())}
              />{" "}
              全选
            </label>
          )}
        </div>
        <div className="picker-list tall">
          {list.map((e) => (
            <Row key={e.path} e={e} sortable={tab === "sort"} checked={picked.has(e.path)} onToggle={() => toggle(e.path)} />
          ))}
          {list.length === 0 &&
            (tab === "sort" ? (
              <p className="mc-text small panel-note">
                没有待分拣的资料。从 Finder 把文件或文件夹直接拖进窗口：丢在书架上就进那个书架，丢在书桌上导入后直接打开，丢在 AI 工作台上就附进对话，丢在这里或地上就先放进 Imports/。
              </p>
            ) : (
              <p className="mc-text small panel-note">没有找到资料。</p>
            ))}
        </div>
        {tab === "sort" && (
          <div className="sort-bar">
            <span className="mc-text small">已选 {pickedNow.length} 个，放上</span>
            <select className="mc-select" value={target} onChange={(e) => setTarget(e.target.value)}>
              {shelves.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.shelf!.name}
                  {s.shelf!.mode === "folder" ? `（移到 ${s.shelf!.folder || "根目录"}/）` : "（收藏，只加引用）"}
                </option>
              ))}
            </select>
            <button className="mc-btn on" disabled={!pickedNow.length || !target || busy} onClick={() => void shelve()}>
              {busy ? "搬运中…" : "放上书架"}
            </button>
          </div>
        )}
        <div className="panel-foot">
          <span className="mc-text small">导入只复制，原文件不变；同名自动保留两份。</span>
          <span className="spacer" />
          <button className="mc-btn" onClick={close}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ e, sortable, checked, onToggle }: { e: FileEntry; sortable: boolean; checked: boolean; onToggle: () => void }) {
  return (
    <div className={`picker-row static ${checked ? "on" : ""}`}>
      {sortable && <input type="checkbox" checked={checked} onChange={onToggle} aria-label={`选择 ${e.name}`} />}
      <BookIcon path={e.path} kind={e.kind} />
      <span className="ellipsis" title={e.path} onClick={sortable ? onToggle : undefined} style={sortable ? { cursor: "pointer" } : undefined}>
        {e.name}
      </span>
      <span className="hint ellipsis">
        {dirname(e.path) || "根目录"} · {formatBytes(e.size)}
      </span>
      {e.kind === "other" ? (
        <button className="mc-btn small" onClick={() => void openExternal(e.path)}>
          打开
        </button>
      ) : (
        <button className="mc-btn small" onClick={() => void takeBook(e.path)}>
          去写
        </button>
      )}
      <button className="mc-btn small" onClick={() => void revealInFinder(e.path)}>
        Finder
      </button>
    </div>
  );
}
