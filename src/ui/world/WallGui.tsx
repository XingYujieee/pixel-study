import { useMemo, useState } from "react";
import { useApp } from "../../app/store";
import { removeWall, startWallPlacing, updateWall, wallItem } from "../../app/wall";
import { takeBook } from "../../app/worldActions";
import { useWorld } from "../../app/worldStore";
import { fuzzyFiles } from "../../lib/fuzzy";
import { basename, dirname } from "../../lib/paths";
import { WALL_NAMES, WALL_SIZES, type WallItemType } from "../../world/wall";
import { BookIcon } from "./ShelfGui";
import { useImeSafeKeys } from "./useImeSafeKeys";

const IMAGE_RE = /\.(png|jpe?g|webp|gif|bmp)$/i;

/** 选择要挂的东西：黑板或画框（画框选尺寸），然后进入挂墙模式 */
export function WallPickGui() {
  const close = () => useWorld.getState().closeGui();
  const pick = (type: WallItemType, w: number, h: number) => {
    useWorld.getState().closeGui();
    startWallPlacing(type, w, h);
  };
  return (
    <div className="mc-overlay" onMouseDown={close}>
      <div className="mc-panel small-panel" onMouseDown={(e) => e.stopPropagation()}>
        <h2 className="mc-title">挂到墙上</h2>
        <p className="mc-text small panel-note">选好后对准墙面左键挂上，右键取消。挂画框时按 R 换尺寸。</p>
        <div className="env-tab">
          <button className="env-opt" onClick={() => pick("board", WALL_SIZES.board[0].w, WALL_SIZES.board[0].h)}>
            <span className="mc-text">黑板</span>
            <span className="recipe-desc">钉一篇笔记（比如待办、本周计划），改了笔记黑板跟着变</span>
          </button>
          {WALL_SIZES.frame.map((z) => (
            <button key={z.name} className="env-opt" onClick={() => pick("frame", z.w, z.h)}>
              <span className="mc-text">画框 · {z.name}</span>
              <span className="recipe-desc">挂库里的一张图片，当灵感板</span>
            </button>
          ))}
        </div>
        <div className="panel-foot">
          <span className="spacer" />
          <button className="mc-btn" onClick={close}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}

/** 黑板 / 画框：选内容、去改、取下 */
export function WallGui({ id }: { id: string }) {
  useWorld((s) => s.layoutVersion);
  const files = useApp((s) => s.files);
  const v = useApp((s) => s.filesVersion);
  const it = wallItem(id);
  const [q, setQ] = useState("");
  const close = () => useWorld.getState().closeGui();
  const keys = useImeSafeKeys({ onEscape: close });
  const list = useMemo(() => {
    if (!it) return [];
    const pool = [...files.values()].filter((e) => (it.type === "board" ? e.kind === "markdown" || e.kind === "text" : IMAGE_RE.test(e.path)));
    if (q.trim()) return fuzzyFiles(q, pool, 60).map((m) => m.entry);
    return pool.sort((a, b) => b.mtime - a.mtime).slice(0, 60);
  }, [files, v, q, it?.type]);
  if (!it) return null;
  const current = it.type === "board" ? it.note : it.image;
  return (
    <div className="mc-overlay" onMouseDown={close}>
      <div className="mc-panel chest-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h2 className="mc-title">{WALL_NAMES[it.type]}</h2>
          <span className="spacer" />
          <span className="mc-text small">{current ? `现在：${basename(current)}` : it.type === "board" ? "还没钉笔记" : "还没挂图片"}</span>
        </div>
        <input
          className="mc-input"
          autoFocus
          placeholder={it.type === "board" ? "找一篇笔记钉上去…" : "找库里的一张图片…"}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          {...keys}
        />
        <div className="picker-list">
          {list.map((e) => (
            <button
              key={e.path}
              className={`picker-row ${current === e.path ? "on" : ""}`}
              onClick={() => updateWall(id, it.type === "board" ? { note: e.path } : { image: e.path })}
            >
              <BookIcon path={e.path} kind={e.kind} />
              <span className="ellipsis">{e.name}</span>
              <span className="hint ellipsis">{dirname(e.path) || "根目录"}</span>
            </button>
          ))}
          {list.length === 0 && (
            <p className="mc-text small panel-note">{it.type === "board" ? "没有找到笔记。" : "库里还没有图片。可以先把图片从访达拖到资料箱或书架上导入。"}</p>
          )}
        </div>
        <div className="panel-foot">
          {it.type === "board" && it.note && (
            <button
              className="mc-btn"
              onClick={() => {
                close();
                void takeBook(it.note!);
              }}
            >
              去改这篇
            </button>
          )}
          {it.type === "frame" && (
            <>
              <label className="mc-check">
                <input type="checkbox" checked={it.pixel !== false} onChange={(e) => updateWall(id, { pixel: e.target.checked })} /> 像素风
              </label>
              {WALL_SIZES.frame.map((z) => (
                <button key={z.name} className={`mc-btn small ${it.w === z.w && it.h === z.h ? "on" : ""}`} onClick={() => updateWall(id, { w: z.w, h: z.h })}>
                  {z.name}
                </button>
              ))}
            </>
          )}
          <span className="spacer" />
          <button
            className="mc-btn danger"
            onClick={() => {
              removeWall(id);
              close();
            }}
            title="只是取下来，不会删除笔记或图片"
          >
            取下
          </button>
          <button className="mc-btn" onClick={close}>
            好
          </button>
        </div>
      </div>
    </div>
  );
}
