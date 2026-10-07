import { useState } from "react";
import { addFloorHere, goToFloor, removeFloorAction, renameFloorAction } from "../../app/floors";
import { useWorld } from "../../app/worldStore";
import { floorsOf, MAX_FLOORS } from "../../world/floors";
import { useImeSafeKeys } from "./useImeSafeKeys";

/** 楼梯：选一层上去 / 下来；加一层、改名、拆掉空楼层 */
export function FloorsGui() {
  useWorld((s) => s.layoutVersion);
  const layout = useWorld((s) => s.layout);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const keys = useImeSafeKeys({
    onEnter: () => {
      if (editing && name.trim()) renameFloorAction(editing, name);
      setEditing(null);
    },
    onEscape: () => setEditing(null),
  });
  if (!layout) return null;
  const all = floorsOf(layout);
  const cur = layout.floor ?? all[0].id;
  const close = () => useWorld.getState().closeGui();
  return (
    <div className="mc-overlay" onMouseDown={close}>
      <div className="mc-panel small-panel floors-panel" onMouseDown={(e) => e.stopPropagation()}>
        <h2 className="mc-title">楼梯</h2>
        <div className="floors-list">
          {[...all].reverse().map((f) => {
            const shelves = f.furniture.filter((x) => x.type === "bookshelf").length;
            const here = f.id === cur;
            return (
              <div key={f.id} className={`floor-row ${here ? "here" : ""}`}>
                {editing === f.id ? (
                  <input className="mc-input" autoFocus value={name} maxLength={20} onChange={(e) => setName(e.target.value)} onBlur={() => setEditing(null)} {...keys} />
                ) : (
                  <button
                    className="mc-btn floor-go"
                    disabled={here}
                    onClick={() => {
                      close();
                      void goToFloor(f.id);
                    }}
                  >
                    {f.name}
                    <span className="mc-text small"> · {shelves} 个书架{here ? " · 你在这层" : ""}</span>
                  </button>
                )}
                <button
                  className="mc-btn small"
                  onClick={() => {
                    setEditing(f.id);
                    setName(f.name);
                  }}
                  title="改名"
                >
                  改名
                </button>
                {all[0].id !== f.id && !here && shelves === 0 && (
                  <button className="mc-btn small" onClick={() => removeFloorAction(f.id)} title="拆掉这一层（上面的家具一起拿掉）">
                    拆掉
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <p className="mc-text small panel-note">
          书多了一层放不下，就往上加一层：每层有自己的书架、家具和墙上挂件，可以单独换屋子主题。也可以叫管家（G）说「整理书架」，它会按文件夹自动排，放不下会自己加楼层。
        </p>
        <div className="panel-foot">
          <span className="spacer" />
          <button className="mc-btn" disabled={all.length >= MAX_FLOORS} onClick={() => addFloorHere()}>
            ＋ 加一层
          </button>
          <button className="mc-btn" onClick={close}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
