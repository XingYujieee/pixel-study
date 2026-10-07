// 鱼塘冒泡：偶尔浮上来一条放了几天的灵感，或一本很久没翻的书。
// 不弹窗、不通知：只是鱼塘冒泡，走过去点开才看到，不理它就自己消失。
import type { FileEntry } from "../ipc";
import { dustLevel, lastTouched, type OpenedMap } from "./bookState";
import { INBOX_DIR, inboxItems } from "./inbox";

export interface Surfacing {
  path: string;
  kind: "idea" | "book";
}

const DAY = 86400000;
/** 灵感放了这么多天才会浮上来 */
export const IDEA_MIN_DAYS = 3;
/** 冒泡持续时间 */
export const BUBBLE_MS = 90_000;

/** 两次冒泡之间的间隔（毫秒）：4–9 分钟 */
export function nextBubbleDelay(rand: () => number = Math.random): number {
  return (4 + rand() * 5) * 60_000;
}

export function pickSurfacing(
  files: Iterable<FileEntry>,
  opened: OpenedMap,
  now: number,
  opts: { exclude?: Set<string>; templateDir?: string; rand?: () => number } = {},
): Surfacing | null {
  const rand = opts.rand ?? Math.random;
  const exclude = opts.exclude ?? new Set<string>();
  const all = [...files];
  const ideas = inboxItems(all).filter((f) => now - lastTouched(f, opened[f.path]) >= IDEA_MIN_DAYS * DAY && !exclude.has(f.path));
  const tpl = opts.templateDir ? `${opts.templateDir}/` : null;
  const books = all.filter(
    (f) =>
      f.kind !== "other" &&
      !f.path.startsWith(`${INBOX_DIR}/`) &&
      !(tpl && f.path.startsWith(tpl)) &&
      !exclude.has(f.path) &&
      dustLevel(lastTouched(f, opened[f.path]), now) > 0,
  );
  if (!ideas.length && !books.length) return null;
  const useIdea = ideas.length > 0 && (books.length === 0 || rand() < 0.5);
  const pool = useIdea ? ideas : books;
  const f = pool[Math.floor(rand() * pool.length) % pool.length];
  return { path: f.path, kind: useIdea ? "idea" : "book" };
}
