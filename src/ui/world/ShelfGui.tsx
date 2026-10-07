import { useMemo, useState } from "react";
import { useApp } from "../../app/store";
import { addToShelf, furniture, removeFromShelf, takeBook, updateShelf } from "../../app/worldActions";
import { useWorld } from "../../app/worldStore";
import type { FileEntry } from "../../ipc";
import { fuzzyFiles } from "../../lib/fuzzy";
import { basename, dirname } from "../../lib/paths";
import { folderBooks, hashString, shelfBooks, shelfSubfolders } from "../../world/layout";
import { BOOK_COLORS } from "../../world/textures";
import { useImeSafeKeys } from "./useImeSafeKeys";

const PAGE = 27;

export function bookColor(path: string, kind: FileEntry["kind"] | undefined) {
  const palette = BOOK_COLORS[kind ?? "other"] ?? BOOK_COLORS.other;
  return palette[(hashString(path) >>> 20) % palette.length];
}

export function BookIcon({ path, kind, missing }: { path: string; kind?: FileEntry["kind"]; missing?: boolean }) {
  return (
    <i
      className={`book-icon k-${kind ?? "other"} ${missing ? "missing" : ""}`}
      style={{ ["--book" as string]: missing ? "#777" : bookColor(path, kind) }}
    />
  );
}

export function ShelfGui({ fid }: { fid: string }) {
  useWorld((s) => s.layoutVersion);
  const files = useApp((s) => s.files);
  const filesVersion = useApp((s) => s.filesVersion);
  const f = furniture(fid);
  const [page, setPage] = useState(0);
  const [picking, setPicking] = useState(false);
  const close = () => useWorld.getState().closeGui();
  const shelf = f?.shelf;

  // 文件夹书架可以一层层点进子文件夹看（不改变书架绑定）
  const [view, setView] = useState<string | null>(null);
  const at = shelf?.mode === "folder" ? (view ?? shelf.folder) : null;
  const books = useMemo(
    () => (!shelf ? [] : at === null ? shelfBooks(shelf, files) : folderBooks(at, files, true)),
    [shelf, files, filesVersion, shelf?.refs.length, shelf?.folder, shelf?.mode, at],
  );
  const subfolders = useMemo(
    () => (shelf && at !== null && !(at === shelf.folder && shelf.flat) ? shelfSubfolders({ ...shelf, folder: at }, files) : []),
    [shelf, files, filesVersion, at, shelf?.flat],
  );
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of subfolders) {
      let n = 0;
      for (const p of files.keys()) if (p.startsWith(`${d}/`)) n++;
      m.set(d, n);
    }
    return m;
  }, [subfolders, files, filesVersion]);
  const allDirs = useMemo(() => {
    const s = new Set<string>([""]);
    for (const p of files.keys()) {
      let d = dirname(p);
      while (d) {
        s.add(d);
        d = dirname(d);
      }
    }
    return [...s].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  }, [files, filesVersion]);

  if (!f || !shelf) return null;
  type Cell = { dir: string } | { path: string; entry: FileEntry | null };
  const cells: Cell[] = [...subfolders.map((d) => ({ dir: d })), ...books];
  const pages = Math.max(1, Math.ceil(cells.length / PAGE));
  const shown = cells.slice(page * PAGE, page * PAGE + PAGE);
  const crumbs: string[] = [];
  if (at !== null && shelf) {
    let d = at;
    while (d !== shelf.folder && d) {
      crumbs.unshift(d);
      d = dirname(d);
    }
  }
  const open = (d: string | null) => {
    setView(d);
    setPage(0);
  };

  return (
    <div className="mc-overlay" onMouseDown={close}>
      <div className="mc-panel shelf-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <ShelfName fid={fid} name={shelf.name} />
          <div className="seg">
            <button className={`mc-btn small ${shelf.mode === "virtual" ? "on" : ""}`} onClick={() => updateShelf(fid, { mode: "virtual" })} title="自由放入任意文件的引用，一本书可以放在多个书架">
              收藏书架
            </button>
            <button
              className={`mc-btn small ${shelf.mode === "folder" ? "on" : ""}`}
              onClick={() => updateShelf(fid, { mode: "folder" })}
              title="绑定库里的真实文件夹，随磁盘变化"
            >
              文件夹书架
            </button>
          </div>
        </div>

        {shelf.mode === "folder" && (
          <div className="folder-bar">
            <span className="mc-text small">文件夹</span>
            <select className="mc-select" value={shelf.folder} onChange={(e) => updateShelf(fid, { folder: e.target.value })}>
              {allDirs.map((d) => (
                <option key={d} value={d}>
                  {d || "（库根目录）"}
                </option>
              ))}
            </select>
            <label className="mc-check light small" title="只放这一层的文件，子文件夹交给它们自己的书架">
              <input type="checkbox" checked={!!shelf.flat} onChange={(e) => updateShelf(fid, { flat: e.target.checked || undefined })} /> 只放这一层
            </label>
          </div>
        )}
        {shelf.mode === "folder" && (
          <div className="crumbs">
            <button className={`mc-chip ${view === null || view === shelf.folder ? "on" : ""}`} onClick={() => open(null)}>
              {basename(shelf.folder) || "库根目录"}
            </button>
            {crumbs.map((d) => (
              <span key={d}>
                <span className="mc-text small"> ▸ </span>
                <button className={`mc-chip ${d === at ? "on" : ""}`} onClick={() => open(d)}>
                  {basename(d)}
                </button>
              </span>
            ))}
            {at !== null && at !== shelf.folder && (
              <>
                <span className="spacer" />
                <button className="mc-btn small" onClick={() => updateShelf(fid, { folder: at, name: basename(at) })} title="这个书架以后就放这个文件夹">
                  书架换到这里
                </button>
                <button className="mc-btn small" onClick={() => void import("../../app/butler").then((m) => m.addShelfFor(at))} title="在这层楼靠墙的空位放一个新书架">
                  单独放一个书架
                </button>
              </>
            )}
          </div>
        )}

        {picking ? (
          <LibraryPicker
            exclude={new Set(shelf.refs)}
            onDone={(paths) => {
              addToShelf(fid, paths);
              setPicking(false);
            }}
            onCancel={() => setPicking(false)}
          />
        ) : (
          <>
            <div className="slot-grid">
              {shown.map((c) =>
                "dir" in c ? (
                  <div key={`d:${c.dir}`} className="slot folder" title={`${c.dir}（${counts.get(c.dir) ?? 0} 个文件）`}>
                    <button className="slot-btn" onClick={() => open(c.dir)}>
                      <i className="folder-icon" />
                      <span className="slot-name">{basename(c.dir)}</span>
                      <span className="slot-sub">{counts.get(c.dir) ?? 0}</span>
                    </button>
                  </div>
                ) : (
                  <BookSlot key={c.path} b={c} fid={fid} virtual={shelf.mode === "virtual"} />
                ),
              )}
              {Array.from({ length: Math.max(0, PAGE - shown.length) }, (_, i) => (
                <div key={`e${i}`} className="slot empty" />
              ))}
            </div>
            {cells.length === 0 && (
              <p className="mc-text small panel-note">
                {shelf.mode === "virtual" ? "书架是空的。点「放入书」把库里的笔记放上来，或者去工作台制作一本新书。" : "这个文件夹里还没有文件。"}
              </p>
            )}
          </>
        )}

        <div className="panel-foot">
          {pages > 1 && !picking && (
            <span className="pager">
              <button className="mc-btn small" disabled={page === 0} onClick={() => setPage(page - 1)}>
                ◀
              </button>
              <span className="mc-text">
                {page + 1} / {pages}
              </span>
              <button className="mc-btn small" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
                ▶
              </button>
            </span>
          )}
          <span className="spacer" />
          {shelf.mode === "virtual" && !picking && (
            <button className="mc-btn" onClick={() => setPicking(true)}>
              ＋ 放入书
            </button>
          )}
          <button className="mc-btn" onClick={() => useWorld.getState().openGui({ kind: "workbench", shelfId: fid })}>
            制作新书
          </button>
          <button className="mc-btn" onClick={close}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

function BookSlot({ b, fid, virtual }: { b: { path: string; entry: FileEntry | null }; fid: string; virtual: boolean }) {
  return (
    <div className={`slot ${b.entry ? "" : "dead"}`} title={b.entry ? b.path : `${b.path}（文件已不存在）`}>
      <button className="slot-btn" onClick={() => b.entry && void takeBook(b.path)} disabled={!b.entry}>
        <BookIcon path={b.path} kind={b.entry?.kind} missing={!b.entry} />
        <span className="slot-name">{basename(b.path).replace(/\.(md|markdown)$/i, "")}</span>
      </button>
      {virtual && (
        <button className="slot-x" onClick={() => removeFromShelf(fid, b.path)} title="从书架拿下（不删除文件）">
          ×
        </button>
      )}
    </div>
  );
}

function ShelfName({ fid, name }: { fid: string; name: string }) {
  const [v, setV] = useState(name);
  const keys = useImeSafeKeys({ onEnter: (e) => (e.target as HTMLInputElement).blur() });
  return (
    <input
      className="mc-title-input"
      value={v}
      maxLength={24}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v.trim() && v !== name && updateShelf(fid, { name: v.trim() })}
      title="书架名称（可修改）"
      {...keys}
    />
  );
}

/** 从整个库里挑选文件放入书架 */
export function LibraryPicker({ exclude, onDone, onCancel }: { exclude: Set<string>; onDone: (paths: string[]) => void; onCancel: () => void }) {
  const files = useApp((s) => s.files);
  const filesVersion = useApp((s) => s.filesVersion);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const list = useMemo(() => {
    if (q.trim()) return fuzzyFiles(q, files.values(), 60).map((m) => m.entry);
    return [...files.values()].sort((a, b) => b.mtime - a.mtime).slice(0, 60);
  }, [q, files, filesVersion]);
  const keys = useImeSafeKeys({ onEnter: () => picked.length && onDone(picked), onEscape: onCancel });
  return (
    <div className="picker">
      <input className="mc-input" autoFocus placeholder="搜索库里的文件…（默认按最近修改）" value={q} onChange={(e) => setQ(e.target.value)} {...keys} />
      <div className="picker-list">
        {list.map((e) => {
          const on = picked.includes(e.path);
          const already = exclude.has(e.path);
          return (
            <button
              key={e.path}
              className={`picker-row ${on ? "on" : ""}`}
              disabled={already}
              onClick={() => setPicked(on ? picked.filter((p) => p !== e.path) : [...picked, e.path])}
            >
              <span className="check">{already ? "✓" : on ? "■" : "□"}</span>
              <BookIcon path={e.path} kind={e.kind} />
              <span className="ellipsis">{e.name}</span>
              <span className="hint ellipsis">{dirname(e.path)}</span>
            </button>
          );
        })}
      </div>
      <div className="picker-foot">
        <span className="mc-text small">已选 {picked.length}</span>
        <span className="spacer" />
        <button className="mc-btn small" onClick={onCancel}>
          取消
        </button>
        <button className="mc-btn small on" disabled={!picked.length} onClick={() => onDone(picked)}>
          放入书架
        </button>
      </div>
    </div>
  );
}
