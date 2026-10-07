import { setRoomTheme } from "../../app/worldActions";
import { useWorld } from "../../app/worldStore";
import { roomTextures, textures } from "../../world/textures";
import { THEME_ORDER, THEMES, type TexName } from "../../world/themes";

function texUrl(name: TexName): string {
  const t = (textures() as unknown as Record<string, { image?: HTMLCanvasElement }>)[name] ?? (roomTextures() as unknown as Record<string, { image?: HTMLCanvasElement }>)[name];
  return t?.image?.toDataURL?.() ?? "";
}

/** 换屋子：七种主题，只换墙、地板、窗户、灯光和默认窗景 */
export function ThemeGui() {
  const current = useWorld((s) => s.layout?.theme ?? "study");
  useWorld((s) => s.layoutVersion);
  const close = () => useWorld.getState().closeGui();
  return (
    <div className="mc-overlay" onMouseDown={close}>
      <div className="mc-panel theme-panel" onMouseDown={(e) => e.stopPropagation()}>
        <h2 className="mc-title">换屋子</h2>
        <p className="mc-text small panel-note">只换墙、地板、窗户和灯光，家具摆法、书和文件都不变，随时换回来。</p>
        <div className="theme-grid">
          {THEME_ORDER.map((id) => {
            const t = THEMES[id];
            return (
              <button key={id} className={`theme-card ${current === id ? "on" : ""}`} onClick={() => setRoomTheme(id)}>
                <span className="theme-swatch">
                  <span style={{ backgroundImage: `url(${texUrl(t.upper)})` }} />
                  <span style={{ backgroundImage: `url(${texUrl(t.lower)})` }} />
                  <span style={{ backgroundImage: `url(${texUrl(t.floor)})` }} />
                </span>
                <span className="mc-text">{t.name}</span>
                <span className="recipe-desc">{t.desc}</span>
              </button>
            );
          })}
        </div>
        <div className="panel-foot">
          <span className="spacer" />
          <button className="mc-btn" onClick={close} autoFocus>
            好
          </button>
        </div>
      </div>
    </div>
  );
}
