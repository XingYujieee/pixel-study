// 书桌沙漏：番茄钟式的专注计时。不记分、不打卡，漏完轻轻提示一声。
import { create } from "zustand";
import { useApp } from "./store";
import { getEngine } from "./worldActions";

interface HourglassStore {
  /** 计时中：开始时间与总时长；暂停时 pausedLeft 为剩余毫秒 */
  running: { startedAt: number; durationMs: number; pausedLeft: number | null } | null;
  /** 刚漏完（显示一会儿"漏完了"） */
  doneAt: number | null;
}

export const useHourglass = create<HourglassStore>(() => ({ running: null, doneAt: null }));

export const HOURGLASS_MINUTES = [15, 25, 45, 60];

let timer: ReturnType<typeof setInterval> | null = null;
let onDone: (() => void) | null = null;

/** 漏完时的提示音等（声音模块设置） */
export function setHourglassDoneHandler(fn: () => void) {
  onDone = fn;
}

export function remainingMs(now = Date.now()): number {
  const r = useHourglass.getState().running;
  if (!r) return 0;
  if (r.pausedLeft !== null) return r.pausedLeft;
  return Math.max(0, r.startedAt + r.durationMs - now);
}

export function progress(now = Date.now()): number | null {
  const r = useHourglass.getState().running;
  if (!r) return null;
  return 1 - remainingMs(now) / r.durationMs;
}

function tick() {
  const r = useHourglass.getState().running;
  if (!r) return;
  getEngine()?.setHourglass(progress());
  if (r.pausedLeft === null && remainingMs() <= 0) {
    useHourglass.setState({ running: null, doneAt: Date.now() });
    getEngine()?.setHourglass(null);
    stopTimer();
    onDone?.();
    useApp.getState().toast(`沙漏漏完了（${Math.round(r.durationMs / 60000)} 分钟）。起来走走，喝口水？`);
  }
  // 触发界面刷新（剩余时间）
  useHourglass.setState({ running: useHourglass.getState().running });
}

function stopTimer() {
  if (timer) clearInterval(timer);
  timer = null;
}

/** 翻过来开始计时 */
export function startHourglass(minutes: number) {
  stopTimer();
  useHourglass.setState({ running: { startedAt: Date.now(), durationMs: minutes * 60000, pausedLeft: null }, doneAt: null });
  getEngine()?.setHourglass(0);
  timer = setInterval(tick, 1000);
}

export function pauseHourglass() {
  const r = useHourglass.getState().running;
  if (!r) return;
  if (r.pausedLeft === null) {
    useHourglass.setState({ running: { ...r, pausedLeft: remainingMs() } });
    stopTimer();
  } else {
    useHourglass.setState({ running: { startedAt: Date.now() - (r.durationMs - r.pausedLeft), durationMs: r.durationMs, pausedLeft: null } });
    timer = setInterval(tick, 1000);
  }
}

export function stopHourglass() {
  stopTimer();
  useHourglass.setState({ running: null });
  getEngine()?.setHourglass(null);
}

export function formatLeft(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
