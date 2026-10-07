// 灵感池（鱼塘）：随手记下的一句话存成 Inbox/ 下的普通 Markdown，Obsidian 里也能直接看到。
// 这里只有纯函数，读写文件在 app/study.ts。
import type { FileEntry } from "../ipc";
import type { Weather } from "../world/sky";

export const INBOX_DIR = "Inbox";
/** Obsidian 的回收站目录：放生的灵感移到这里，随时能找回 */
export const TRASH_DIR = ".trash";

const pad = (n: number) => String(n).padStart(2, "0");

export function localDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function localTime(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Obsidian 不允许出现在文件名里的字符 */
const BAD_CHARS = /[/\\:*?"<>|#^[\]\u0000-\u001f]/g;

/**
 * 用灵感的第一行做文件名（去掉 Markdown 符号与非法字符，最多 24 字）；
 * 第一行没有可用文字时用时间。
 */
export function ideaFileName(text: string, now: Date): string {
  const first = text.split("\n").find((l) => l.trim()) ?? "";
  let name = first
    .replace(/^\s*(#+|[-*+]|\d+\.|>)\s*/, "")
    .replace(/[*_`~]/g, "")
    .replace(/\[\[([^\]|]*)(\|[^\]]*)?\]\]/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(BAD_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");
  const chars = [...name];
  if (chars.length > 24) name = chars.slice(0, 24).join("").trim() + "…";
  if (!name) name = `灵感 ${localDate(now)} ${localTime(now).replace(":", "")}`;
  return name;
}

/** 灵感文件内容：带 created 与 tags 的 frontmatter，Obsidian 的属性面板能识别 */
export function ideaContent(text: string, now: Date): string {
  return `---\ncreated: ${localDate(now)}T${localTime(now)}\ntags:\n  - 灵感\n---\n\n${text.trim()}\n`;
}

/** 去掉 frontmatter */
export function stripFrontmatter(text: string): string {
  if (!text.startsWith("---")) return text;
  const m = /^---\r?\n[\s\S]*?\r?\n(---|\.\.\.)\s*(\r?\n|$)/.exec(text);
  return m ? text.slice(m[0].length) : text;
}

/** 列表里显示的预览 */
export function ideaPreview(text: string, max = 140): string {
  const body = stripFrontmatter(text).trim().replace(/\n{2,}/g, "\n");
  const chars = [...body];
  return chars.length > max ? chars.slice(0, max).join("") + "…" : body;
}

/** 鱼塘里的灵感：Inbox/ 下的直接文件（可编辑类型），新的在前 */
export function inboxItems(files: Iterable<FileEntry>): FileEntry[] {
  const out: FileEntry[] = [];
  for (const f of files) {
    if (!f.path.startsWith(`${INBOX_DIR}/`)) continue;
    if (f.path.indexOf("/", INBOX_DIR.length + 1) !== -1) continue;
    if (f.kind === "other") continue;
    out.push(f);
  }
  return out.sort((a, b) => b.mtime - a.mtime || a.path.localeCompare(b.path));
}

/**
 * 天气跟随灵感池：待处理越多天越阴。
 * 少于阈值一半：晴；少于阈值：多云；少于两倍：雨（冬天下雪）；再多：雷雨。
 */
export function pendingWeather(count: number, threshold: number, winter: boolean): Weather {
  const t = Math.max(2, Math.round(threshold));
  if (count < Math.ceil(t / 2)) return "clear";
  if (count < t) return "cloudy";
  if (count < t * 2) return winter ? "snow" : "rain";
  return "storm";
}

export function relativeAge(ms: number, now: number): string {
  const d = Math.max(0, now - ms);
  const min = Math.floor(d / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时前`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days} 天前`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} 个月前`;
  return `${Math.floor(days / 365)} 年前`;
}
