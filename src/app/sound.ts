// 声音的总控：第一次点击时解锁音频；按屋子、天气、时间、脚下地毯混合环境声；把各种操作接到音效上。
import { create } from "zustand";
import { audio, type Layer, type Sfx } from "../world/audio";
import { compose, gapSeconds, type Style } from "../world/compose";
import type { PetKind } from "../world/pets";
import { themeOf } from "../world/themes";
import { setHourglassDoneHandler } from "./hourglass";
import { setDistanceFactor, setMusicVolume, trackUrl, useJukebox } from "./jukebox";
import { onPat } from "./pets";
import { standingAmbience, useStudy } from "./study";
import { furniture, getEngine } from "./worldActions";
import { useWorld } from "./worldStore";

let started = false;
let carpetAudio: HTMLAudioElement | null = null;
let carpetTrack: string | null = null;

export function sfx(name: Sfx, vol = 1) {
  audio.play(name, vol);
}

const PET_SOUND: Record<PetKind, Sfx> = { cat: "meow", dog: "bark", rabbit: "squeak", chick: "chirp", fox: "yip" };

/** 根据当前状态算出每层环境声的音量 */
export function ambienceLevels(): Record<Layer, number> {
  const lv: Record<Layer, number> = { rain: 0, fire: 0, waves: 0, wind: 0, crickets: 0, birds: 0 };
  const eng = getEngine();
  const w = useWorld.getState();
  const layout = w.layout;
  if (!eng || !layout) return lv;
  const st = useStudy.getState();
  const mode = w.mode;
  const factor = mode === "focus" ? 0.5 : mode === "writing" ? 0.75 : 1;
  if (st.envAmbience) {
    const theme = themeOf(layout.theme);
    // 出了门，外面的声音就清楚了
    const outdoor = eng.isOutside ? 1.15 : theme.id === "cellar" ? 0.15 : theme.windowStyle === "shoji" ? 1 : 0.7;
    const weather = eng.env.weather;
    const night = eng.env.light < 0.3;
    const hour = eng.env.hour;
    if (weather === "rain") lv.rain = 0.55 * outdoor;
    if (weather === "storm") lv.rain = 0.9 * outdoor;
    if (weather === "snow") lv.wind = 0.35 * outdoor;
    const dry = weather === "clear" || weather === "cloudy";
    if (night && dry) lv.crickets = 0.35 * outdoor;
    if (!night && dry && hour > 5.5 && hour < 18.5) lv.birds = 0.25 * outdoor;
    const sea = (layout.env.sceneryPreset ?? theme.scenery) === "sea" && !layout.env.scenery;
    if (theme.id === "lighthouse" || sea) lv.waves = 0.4 * outdoor;
    if (theme.fireplace) {
      const p = eng.player();
      const d = Math.hypot(p.x + 0.3, p.z - 5.5);
      lv.fire = Math.max(0.12, Math.min(1, 1 - d / 9)) * 0.85;
    }
  }
  const { a } = standingAmbience();
  const set = (k: Layer, v: number) => (lv[k] = Math.max(lv[k], v));
  if (a === "rain") set("rain", 0.9);
  if (a === "fire") set("fire", 0.9);
  if (a === "night") set("crickets", 0.6);
  if (a === "waves") set("waves", 0.9);
  if (a === "wind") set("wind", 0.8);
  if (a === "birds") set("birds", 0.8);
  for (const k of Object.keys(lv) as Layer[]) lv[k] *= factor;
  return lv;
}

// ───────────── 背景音乐 ─────────────

export const useBgm = create<{ playing: boolean; key: string | null; title: string | null }>(() => ({ playing: false, key: null, title: null }));
let bgmNextAt = Date.now() + 40_000;

function bgmMood(): "day" | "night" {
  const env = getEngine()?.env;
  if (!env) return "day";
  return env.light < 0.35 || env.weather === "rain" || env.weather === "storm" || env.weather === "snow" ? "night" : "day";
}

/** 现在放一首（设置面板里的按钮，也用于计时器）；style 指定风格 */
export function playBgmNow(style?: Style): boolean {
  if (!audio.ready) return false;
  if (useJukebox.getState().playing) return false;
  const piece = compose(Date.now() & 0x7fffffff, bgmMood(), style ?? useStudy.getState().bgmStyles);
  const ok = audio.playPiece(piece, () => {
    useBgm.setState({ playing: false, key: null, title: null });
    bgmNextAt = Date.now() + gapSeconds(useStudy.getState().bgm) * 1000;
  });
  if (ok) useBgm.setState({ playing: true, key: piece.key, title: piece.title });
  return ok;
}

export function stopBgm() {
  audio.stopPiece();
  useBgm.setState({ playing: false, key: null, title: null });
  bgmNextAt = Date.now() + gapSeconds(useStudy.getState().bgm) * 1000;
}

function bgmTick() {
  const st = useStudy.getState();
  const jukebox = useJukebox.getState().playing;
  // 留声机在放歌、关掉背景音乐或静音时让路
  if (audio.pieceActive && (jukebox || st.bgm === "off" || st.volumes.muted)) {
    stopBgm();
    return;
  }
  if (st.bgm === "off" || st.volumes.muted || jukebox || audio.pieceActive) return;
  if (Date.now() >= bgmNextAt) playBgmNow();
}

function tick() {
  if (!audio.ready) return;
  bgmTick();
  const lv = ambienceLevels();
  for (const [k, v] of Object.entries(lv) as [Layer, number][]) audio.setLayer(k, v);
  void carpetLoop();
  // 留声机：离得越远越小声；写作和专注时保持原音量
  const w = useWorld.getState();
  const eng = getEngine();
  const box = w.layout?.furniture.find((f) => f.type === "jukebox");
  if (eng && box && (w.mode === "explore" || w.mode === "idle" || w.mode === "gui" || w.mode === "paused")) {
    const p = eng.player();
    const d = Math.hypot(p.x - box.x - 0.5, p.z - box.z - 0.5);
    setDistanceFactor(Math.max(0.35, Math.min(1, 1 - (d - 2) / 12)));
  } else setDistanceFactor(1);
}

/** 地毯氛围为「我的音频」：循环播放那一首，音量跟氛围轨走 */
async function carpetLoop() {
  const { a, track } = standingAmbience();
  const want = a === "track" && track ? track : null;
  const v = useStudy.getState().volumes;
  const vol = v.muted ? 0 : v.master * v.ambience;
  if (want !== carpetTrack) {
    carpetTrack = want;
    if (!want) {
      carpetAudio?.pause();
      return;
    }
    carpetAudio ??= new Audio();
    carpetAudio.loop = true;
    try {
      carpetAudio.src = await trackUrl(want);
      carpetAudio.volume = vol;
      await carpetAudio.play();
    } catch {
      carpetTrack = null;
    }
  } else if (carpetAudio && want) carpetAudio.volume = vol;
}

/** 按钮点击的轻响 */
function onClick(e: MouseEvent) {
  const t = e.target as HTMLElement | null;
  if (t?.closest(".mc-btn, .env-opt, .recipe, .theme-card, .preset, .hot-slot, .picker-row")) sfx("click", 0.8);
}

export function startSound() {
  if (started) return;
  started = true;
  const unlock = () => audio.unlock();
  window.addEventListener("pointerdown", unlock, true);
  window.addEventListener("keydown", unlock, true);
  document.addEventListener("click", onClick, true);
  audio.onMusicVolume = (v) => setMusicVolume(v);
  const applyVol = () => audio.setVolumes(useStudy.getState().volumes);
  applyVol();
  useStudy.subscribe((s, p) => {
    if (s.volumes !== p.volumes) applyVol();
  });
  setInterval(tick, 400);
  setHourglassDoneHandler(() => sfx("chime"));
  onPat((pet) => sfx(PET_SOUND[pet.kind]));
  useJukebox.subscribe((s, p) => {
    if (s.playing !== p.playing) getEngine()?.setJukeboxPlaying(s.playing);
  });
}

/** 踩在什么地面上：地毯软、石头脆、木头闷 */
export function stepSound() {
  const w = useWorld.getState();
  const eng = getEngine();
  const under = eng?.surface();
  if (under === "grass") return sfx("stepGrass", 0.8);
  if (under === "stone") return sfx("stepStone", 0.7);
  if (under === "wood") return sfx("stepWood", 0.7);
  const carpet = useStudy.getState().carpetId;
  if (carpet && furniture(carpet)) return sfx("stepSoft", 0.8);
  const floor = themeOf(w.layout?.theme).floor;
  if (floor === "stoneFloor" || floor === "darkCobble") sfx("stepStone", 0.7);
  else if (floor === "tatami") sfx("stepSoft", 0.8);
  else sfx("stepWood", 0.7);
}
