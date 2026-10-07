import { useEffect, useState } from "react";
import { importAudioFromDialog, loadTracks, next, play, removeTrack, renameTrack, setMode, toggle, useJukebox, type PlayMode } from "../../app/jukebox";
import { setBgm, setEnvAmbience, setVolumes, toggleBgmStyle, useStudy } from "../../app/study";
import { playBgmNow, stopBgm, useBgm } from "../../app/sound";
import { ALL_STYLES, STYLE_NAMES, type BgmFrequency } from "../../world/compose";

const BGM_OPTS: [BgmFrequency, string][] = [
  ["off", "关"],
  ["rare", "偶尔"],
  ["often", "经常"],
  ["always", "一直"],
];
import { useWorld } from "../../app/worldStore";
import type { Volumes } from "../../world/audio";
import { useImeSafeKeys } from "./useImeSafeKeys";

const SLIDERS: [keyof Omit<Volumes, "muted">, string, string][] = [
  ["master", "总音量", ""],
  ["sfx", "音效", "脚步、翻书、放东西、宠物"],
  ["ambience", "环境声", "雨、炉火、海浪、虫鸣、地毯氛围"],
  ["music", "音乐", "背景音乐与留声机"],
];

/** 声音：各轨音量、静音、环境声是否跟随屋子与天气 */
export function SoundGui() {
  const v = useStudy((s) => s.volumes);
  const env = useStudy((s) => s.envAmbience);
  const bgm = useStudy((s) => s.bgm);
  const bgmPlaying = useBgm((s) => s.playing);
  const bgmTitle = useBgm((s) => s.title);
  const styles = useStudy((s) => s.bgmStyles);
  const close = () => useWorld.getState().closeGui();
  return (
    <div className="mc-overlay" onMouseDown={close}>
      <div className="mc-panel small-panel" onMouseDown={(e) => e.stopPropagation()}>
        <h2 className="mc-title">声音</h2>
        {SLIDERS.map(([k, name, desc]) => (
          <label key={k} className="field-row wide" title={desc}>
            <span className="mc-text">{name}</span>
            <input type="range" min={0} max={1} step={0.05} value={v[k]} disabled={v.muted} onChange={(e) => setVolumes({ [k]: Number(e.target.value) })} />
            <span className="mc-text small">{Math.round(v[k] * 100)}%</span>
          </label>
        ))}
        <label className="mc-check">
          <input type="checkbox" checked={v.muted} onChange={(e) => setVolumes({ muted: e.target.checked })} /> 全部静音
        </label>
        <div className="opt-row">
          <span className="mc-text small bgm-label">背景音乐</span>
          {BGM_OPTS.map(([k, n]) => (
            <button key={k} className={`mc-btn small ${bgm === k ? "on" : ""}`} onClick={() => setBgm(k)}>
              {n}
            </button>
          ))}
          <button className="mc-btn small" onClick={() => (bgmPlaying ? stopBgm() : playBgmNow())} disabled={bgm === "off" && !bgmPlaying}>
            {bgmPlaying ? "停下这首" : "现在放一首"}
          </button>
        </div>
        <div className="opt-row">
          <span className="mc-text small bgm-label">风格</span>
          {ALL_STYLES.map((st) => (
            <button key={st} className={`mc-btn small ${styles.includes(st) ? "on" : ""}`} onClick={() => toggleBgmStyle(st)} title="可以多选，至少留一种">
              {STYLE_NAMES[st]}
            </button>
          ))}
        </div>
        <p className="mc-text small panel-note">
          {bgmPlaying && bgmTitle ? `正在放：${bgmTitle}。` : ""}背景音乐每首都是现场写的原创小曲：钢琴、八音盒、氛围长音、圆舞曲（竖琴和长笛）、电钢琴、田园（吉他和陶笛）。白天明亮，夜里和雨天安静一些。留声机放歌时会自动让路。
        </p>
        <label className="mc-check" title="下雨时听到雨声，木屋里有壁炉声，灯塔听到海浪，晚上有虫鸣">
          <input type="checkbox" checked={env} onChange={(e) => setEnvAmbience(e.target.checked)} /> 环境声跟随屋子、天气和时间
        </label>
        <p className="mc-text small panel-note">所有声音和背景音乐都是现场合成的，不需要联网。留声机里放的是你自己导入的音频。</p>
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

const MODES: [PlayMode, string][] = [
  ["all", "顺序"],
  ["one", "单曲"],
  ["shuffle", "随机"],
];

/** 留声机：歌单与播放 */
export function JukeboxGui() {
  const { tracks, current, playing, mode } = useJukebox();
  const music = useStudy((s) => s.volumes.music);
  const close = () => useWorld.getState().closeGui();
  useEffect(() => {
    void loadTracks();
  }, []);
  const cur = tracks.find((t) => t.id === current);
  return (
    <div className="mc-overlay" onMouseDown={close}>
      <div className="mc-panel chest-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h2 className="mc-title">留声机</h2>
          <span className="spacer" />
          <button className="mc-btn" onClick={() => void importAudioFromDialog()} title="复制到应用里，原文件不变">
            加歌…
          </button>
        </div>
        <div className="jb-now">
          <span className="mc-text">{cur ? `${playing ? "♪ 正在放" : "暂停"}：${cur.name}` : "还没放歌"}</span>
          <span className="spacer" />
          <button className="mc-btn small" onClick={() => void next(-1)} disabled={!tracks.length} title="上一首">
            ⏮
          </button>
          <button className="mc-btn small on" onClick={toggle} disabled={!tracks.length}>
            {playing ? "暂停" : "播放"}
          </button>
          <button className="mc-btn small" onClick={() => void next(1)} disabled={!tracks.length} title="下一首">
            ⏭
          </button>
          <span className="seg">
            {MODES.map(([m, n]) => (
              <button key={m} className={`mc-btn small ${mode === m ? "on" : ""}`} onClick={() => setMode(m)}>
                {n}
              </button>
            ))}
          </span>
        </div>
        <div className="picker-list tall">
          {tracks.map((t) => (
            <TrackRow key={t.id} id={t.id} name={t.name} on={t.id === current} playing={t.id === current && playing} />
          ))}
          {tracks.length === 0 && (
            <p className="mc-text small panel-note">
              歌单是空的。点「加歌」，或者直接把 mp3、m4a、wav、flac 文件从访达拖到留声机上。音频会复制到应用自己的文件夹，不会放进笔记库。
            </p>
          )}
        </div>
        <div className="panel-foot">
          <label className="field-row wide jb-vol">
            <span className="mc-text">音量</span>
            <input type="range" min={0} max={1} step={0.05} value={music} onChange={(e) => setVolumes({ music: Number(e.target.value) })} />
            <span className="mc-text small">{Math.round(music * 100)}%</span>
          </label>
          <span className="spacer" />
          <button className="mc-btn" onClick={close}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

function TrackRow({ id, name, on, playing }: { id: string; name: string; on: boolean; playing: boolean }) {
  const [editing, setEditing] = useState(false);
  const [n, setN] = useState(name);
  const keys = useImeSafeKeys({
    onEnter: () => {
      void renameTrack(id, n);
      setEditing(false);
    },
    onEscape: () => setEditing(false),
  });
  return (
    <div className={`picker-row static ${on ? "on" : ""}`}>
      <span className="jb-icon">{playing ? "♪" : "·"}</span>
      {editing ? (
        <input className="mc-input pet-name" autoFocus value={n} onChange={(e) => setN(e.target.value)} {...keys} onBlur={() => setEditing(false)} />
      ) : (
        <button className="jb-name" onClick={() => void play(id)} onDoubleClick={() => setEditing(true)} title="单击播放，双击改名">
          {name}
        </button>
      )}
      <button className="mc-btn small" onClick={() => void removeTrack(id)} title="移出歌单（删除应用里的副本，原文件不受影响）">
        移出
      </button>
    </div>
  );
}
