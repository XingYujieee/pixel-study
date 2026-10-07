// 书脊状态：久没碰的书蒙灰，常被其他笔记引用的书发亮。只是外观，不给分数、不排名。
import type { FileEntry } from "../ipc";

const DAY = 86400000;
/** 超过这么多天没打开也没修改，开始蒙灰 */
export const DUST_START_DAYS = 60;
/** 这么多天后灰最厚 */
export const DUST_FULL_DAYS = 240;

/** 最后一次碰过（在书房打开过，或文件被修改过，取较晚的） */
export function lastTouched(entry: Pick<FileEntry, "mtime">, opened: number | undefined): number {
  return Math.max(entry.mtime || 0, opened || 0);
}

/** 蒙灰程度 0–1 */
export function dustLevel(touched: number, now: number): number {
  if (!touched) return 0;
  const days = (now - touched) / DAY;
  if (days < DUST_START_DAYS) return 0;
  const k = (days - DUST_START_DAYS) / (DUST_FULL_DAYS - DUST_START_DAYS);
  return Math.round(Math.min(1, 0.35 + 0.65 * k) * 100) / 100;
}

/** 发亮程度 0–1：被 3 篇以上笔记引用开始发亮，8 篇以上最亮 */
export function glowLevel(backlinks: number | undefined): number {
  const n = backlinks ?? 0;
  if (n < 3) return 0;
  if (n >= 8) return 1;
  return Math.round((0.4 + (0.6 * (n - 3)) / 5) * 100) / 100;
}

/** 打开记录：路径 → 时间戳。只保留最近的若干条，文件改名时跟着改 */
export type OpenedMap = Record<string, number>;

export const MAX_OPENED = 4000;

export function recordOpened(map: OpenedMap, path: string, now: number): OpenedMap {
  const next = { ...map, [path]: now };
  const keys = Object.keys(next);
  if (keys.length <= MAX_OPENED) return next;
  keys.sort((a, b) => next[b] - next[a]);
  const out: OpenedMap = {};
  for (const k of keys.slice(0, MAX_OPENED)) out[k] = next[k];
  return out;
}

export function renameOpened(map: OpenedMap, from: string, to: string | null): OpenedMap {
  if (!(from in map)) return map;
  const next = { ...map };
  const t = next[from];
  delete next[from];
  if (to) next[to] = Math.max(t, next[to] ?? 0);
  return next;
}

export function parseOpened(raw: unknown): OpenedMap {
  const out: OpenedMap = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (typeof v === "number" && v > 0) out[k] = v;
  return out;
}
