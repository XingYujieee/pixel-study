// 留声机：播放用户导入的音频（存在应用数据目录）。歌单、上一首 / 下一首、单曲循环、随机。
import { convertFileSrc } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { create } from "zustand";
import { api, errorMessage, type Track } from "../ipc";
import { useApp } from "./store";
import { getEngine } from "./worldActions";

export type PlayMode = "all" | "one" | "shuffle";

interface JukeboxStore {
  tracks: Track[];
  current: string | null;
  playing: boolean;
  mode: PlayMode;
  /** 留声机上那张唱片的歌（按曲序）；null 表示唱盘空着 */
  queue: string[] | null;
}

export const useJukebox = create<JukeboxStore>(() => ({ tracks: [], current: null, playing: false, mode: "all", queue: null }));

/** 正在放的这张唱片里的歌 */
function playlist(): Track[] {
  const { tracks, queue } = useJukebox.getState();
  if (!queue) return [];
  const byId = new Map(tracks.map((t) => [t.id, t]));
  return queue.map((id) => byId.get(id)).filter((t): t is Track => !!t);
}

/** 换唱片：设好歌单；autoplay 时从第一首放起 */
export async function loadRecord(ids: string[] | null, autoplay: boolean) {
  pause();
  if (player) player.removeAttribute("src");
  useJukebox.setState({ queue: ids, current: null });
  if (ids?.length && autoplay) await play(ids[0]);
}

const toast = (t: string, tone: "info" | "error" = "info") => useApp.getState().toast(t, tone);

export const AUDIO_EXT = /\.(mp3|m4a|aac|wav|aiff?|flac|caf|mp4)$/i;

let player: HTMLAudioElement | null = null;
/** 总音量 × 音乐音量（来自音量面板） */
let baseVolume = 0.56;
/** 离留声机越远越小声（声音模块设置） */
let distanceFactor = 1;

function el(): HTMLAudioElement {
  if (player) return player;
  player = new Audio();
  player.preload = "auto";
  player.addEventListener("ended", () => {
    if (useJukebox.getState().mode === "one") {
      player!.currentTime = 0;
      void player!.play().catch(() => {});
    } else void next();
  });
  player.addEventListener("pause", () => sync());
  player.addEventListener("play", () => sync());
  player.addEventListener("error", () => {
    if (useJukebox.getState().current) toast("这首播放不了（格式可能不支持），换一首试试。", "error");
    useJukebox.setState({ playing: false });
  });
  return player;
}

function sync() {
  const playing = !!player && !player.paused && !player.ended;
  useJukebox.setState({ playing });
  getEngine()?.setJukeboxPlaying(playing);
}

function applyVolume() {
  if (player) player.volume = Math.max(0, Math.min(1, baseVolume * distanceFactor));
}

export function setMusicVolume(v: number) {
  baseVolume = v;
  applyVolume();
}

export function setDistanceFactor(f: number) {
  if (Math.abs(f - distanceFactor) < 0.01) return;
  distanceFactor = f;
  applyVolume();
}

export async function loadTracks() {
  try {
    useJukebox.setState({ tracks: await api.audioList() });
  } catch {
    // 浏览器预览等
  }
}

export async function trackUrl(id: string): Promise<string> {
  return convertFileSrc(await api.audioPath(id));
}

export async function play(id?: string) {
  const st = useJukebox.getState();
  const target = id ?? st.current ?? playlist()[0]?.id;
  if (!target) {
    toast("留声机上还没有唱片：去唱片架拿一张，对着留声机按 E 放上去。");
    return;
  }
  const p = el();
  try {
    if (target !== st.current || !p.src) {
      p.src = await trackUrl(target);
      useJukebox.setState({ current: target });
    }
    applyVolume();
    await p.play();
  } catch (e) {
    toast(`播放不了：${errorMessage(e)}`, "error");
  }
}

export function pause() {
  player?.pause();
}

export function toggle() {
  if (player && !player.paused) pause();
  else void play();
}

export async function next(delta = 1) {
  const { current, mode } = useJukebox.getState();
  const tracks = playlist();
  if (!tracks.length) return;
  let i = tracks.findIndex((t) => t.id === current);
  if (mode === "shuffle" && tracks.length > 1) {
    let j = i;
    while (j === i) j = Math.floor(Math.random() * tracks.length);
    i = j;
  } else i = (i + delta + tracks.length) % tracks.length;
  await play(tracks[i].id);
}

export function setMode(mode: PlayMode) {
  useJukebox.setState({ mode });
}

export async function importAudio(paths: string[]): Promise<number> {
  try {
    const r = await api.audioImport(paths);
    await loadTracks();
    if (r.rejected.length) toast(`这些不是能播放的音频（支持 mp3、m4a、wav、aiff、flac）：${r.rejected.slice(0, 3).join("、")}${r.rejected.length > 3 ? " 等" : ""}`, "error");
    if (r.added.length) toast(`唱片架上多了 ${r.added.length} 首歌（同一专辑的放进同一张唱片）`);
    return r.added.length;
  } catch (e) {
    toast(`加歌失败：${errorMessage(e)}`, "error");
    return 0;
  }
}

export async function importAudioFromDialog() {
  const picked = await openDialog({ multiple: true, directory: false, title: "导入音乐（复制到应用里，原文件不变）", filters: [{ name: "音频", extensions: ["mp3", "m4a", "aac", "wav", "aif", "aiff", "flac", "caf"] }] });
  const sources = Array.isArray(picked) ? picked : typeof picked === "string" ? [picked] : [];
  if (sources.length) await importAudio(sources);
}

export async function removeTrack(id: string) {
  if (useJukebox.getState().current === id) {
    pause();
    if (player) player.removeAttribute("src");
    useJukebox.setState({ current: null });
  }
  const q = useJukebox.getState().queue;
  if (q?.includes(id)) useJukebox.setState({ queue: q.filter((x) => x !== id) });
  await api.audioRemove(id).catch((e) => toast(errorMessage(e), "error"));
  await loadTracks();
}

export async function renameTrack(id: string, name: string) {
  await api.audioRename(id, name).catch(() => {});
  await loadTracks();
}
