import { useState } from "react";
import { useEffect } from "react";
import { loadTracks, useJukebox } from "../../app/jukebox";
import { BACKUP_PRESET, deletePreset, loadPreset, savePreset, setCarpetAmbience, useStudy } from "../../app/study";
import { furniture } from "../../app/worldActions";
import { useWorld } from "../../app/worldStore";
import { relativeAge } from "../../study/inbox";
import { AMBIENCES } from "../../world/layout";
import { useImeSafeKeys } from "./useImeSafeKeys";

/** 地毯氛围：站在地毯上时生效 */
export function CarpetGui({ fid }: { fid: string }) {
  useWorld((s) => s.layoutVersion);
  const tracks = useJukebox((s) => s.tracks);
  useEffect(() => {
    void loadTracks();
  }, []);
  const f = furniture(fid);
  const close = () => useWorld.getState().closeGui();
  if (!f) return null;
  const cur = f.ambience ?? "none";
  return (
    <div className="mc-overlay" onMouseDown={close}>
      <div className="mc-panel small-panel" onMouseDown={(e) => e.stopPropagation()}>
        <h2 className="mc-title">地毯氛围</h2>
        <p className="mc-text small panel-note">站到这块地毯上时生效，走开就恢复。不会改动窗户里的时间和天气设置。</p>
        <div className="env-tab">
          {AMBIENCES.filter((a) => a.id !== "track").map((a) => (
            <button key={a.id} className={`env-opt ${cur === a.id ? "on" : ""}`} onClick={() => setCarpetAmbience(fid, a.id)}>
              <span className="mc-text">{a.name}</span>
              <span className="recipe-desc">{a.desc}</span>
            </button>
          ))}
          <div className={`env-opt ${cur === "track" ? "on" : ""}`}>
            <span className="mc-text">我的音频</span>
            {tracks.length ? (
              <select className="mc-select" value={cur === "track" ? (f.track ?? "") : ""} onChange={(e) => e.target.value && setCarpetAmbience(fid, "track", e.target.value)}>
                <option value="">选留声机歌单里的一首…</option>
                {tracks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="recipe-desc">先在留声机里加几首（比如你喜欢的雨声录音）</span>
            )}
          </div>
        </div>
        <button className="mc-btn small" onClick={() => useWorld.getState().openGui({ kind: "sound" })}>
          调音量…
        </button>
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

/** 布局预设：保存 / 换成某一套家具摆法 */
export function PresetsGui() {
  const presets = useStudy((s) => s.presets);
  const [name, setName] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);
  const close = () => useWorld.getState().closeGui();
  const save = () => {
    if (!name.trim()) return;
    void savePreset(name);
    setName("");
  };
  const keys = useImeSafeKeys({ onEnter: save });
  const now = Date.now();
  return (
    <div className="mc-overlay" onMouseDown={close}>
      <div className="mc-panel small-panel presets-panel" onMouseDown={(e) => e.stopPropagation()}>
        <h2 className="mc-title">布局预设</h2>
        <p className="mc-text small panel-note">把现在的家具摆法存起来，比如"写论文""读文献"各一套，随时换。换之前会自动保存当前摆法，可以换回来。书和文件不受影响。</p>
        <div className="cast-row">
          <input className="mc-input" placeholder="给现在的摆法起个名字" value={name} onChange={(e) => setName(e.target.value)} {...keys} />
          <button className="mc-btn on" disabled={!name.trim()} onClick={save}>
            保存
          </button>
        </div>
        <div className="picker-list">
          {presets.length === 0 && <p className="mc-text small ai-empty">还没有保存过摆法。</p>}
          {presets.map((p) => (
            <div key={p.name} className="picker-row static">
              <span className="idea-text">
                <b>{p.name}</b>
                <span className="hint">
                  {p.furniture.length} 件家具 · {relativeAge(p.savedAt, now)}
                </span>
              </span>
              <span className="idea-actions">
                {confirm === p.name ? (
                  <>
                    <button
                      className="mc-btn small on"
                      onClick={() => {
                        setConfirm(null);
                        void loadPreset(p.name);
                      }}
                    >
                      确定换成这套
                    </button>
                    <button className="mc-btn small" onClick={() => setConfirm(null)}>
                      取消
                    </button>
                  </>
                ) : (
                  <>
                    <button className="mc-btn small" onClick={() => setConfirm(p.name)}>
                      换成这套
                    </button>
                    {p.name !== BACKUP_PRESET && (
                      <button className="mc-btn small" onClick={() => void deletePreset(p.name)} title="只删除这条预设，不影响现在的书房">
                        删除
                      </button>
                    )}
                  </>
                )}
              </span>
            </div>
          ))}
        </div>
        <div className="panel-foot">
          <span className="spacer" />
          <button className="mc-btn" onClick={close}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
