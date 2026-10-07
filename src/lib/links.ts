// Wikilink 解析（风险 5）。规则：
// 1. 去掉 |显示名称、#标题、#^块
// 2. 含 / ：先按库根相对路径，再按当前笔记相对路径；无扩展名补 .md
// 3. 不含 / ：按文件名匹配（NFC + 忽略大小写）
// 4. 多个匹配：同目录优先 → 路径最短 → 字母顺序；标记 ambiguous
import { basename, dirname, resolveRelative } from "./paths";

export function linkKey(name: string): string {
  const n = name.normalize("NFC").toLowerCase();
  return n.endsWith(".md") ? n.slice(0, -3) : n;
}

export interface ParsedLink {
  target: string;
  alias?: string;
  heading?: string;
}

export function parseWikilink(inner: string): ParsedLink {
  let target = inner;
  let alias: string | undefined;
  const bar = target.indexOf("|");
  if (bar !== -1) {
    alias = target.slice(bar + 1).trim() || undefined;
    target = target.slice(0, bar);
  }
  let heading: string | undefined;
  const hash = target.indexOf("#");
  if (hash !== -1) {
    heading = target.slice(hash + 1).replace(/^\^/, "") || undefined;
    target = target.slice(0, hash);
  }
  return { target: target.trim(), alias, heading };
}

export interface LinkResolution {
  path: string | null;
  ambiguous: boolean;
  candidates: string[];
}

/** 由库内全部路径建立 文件名键 → 路径[] 映射 */
export function buildLinkIndex(paths: Iterable<string>): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const p of paths) {
    const k = linkKey(basename(p));
    const arr = m.get(k);
    if (arr) arr.push(p);
    else m.set(k, [p]);
  }
  return m;
}

export function resolveWikilink(
  target: string,
  fromNote: string,
  index: Map<string, string[]>,
  exists: (p: string) => boolean,
): LinkResolution {
  const none = { path: null, ambiguous: false, candidates: [] };
  if (!target) return none;
  if (target.includes("/")) {
    const withExt = /\.[a-z0-9]+$/i.test(basename(target)) ? target : `${target}.md`;
    for (const candidate of [withExt.replace(/^\/+/, ""), resolveRelative(fromNote, withExt)]) {
      if (candidate && exists(candidate)) return { path: candidate, ambiguous: false, candidates: [candidate] };
    }
    // 退回按文件名匹配
    return resolveWikilink(basename(target), fromNote, index, exists);
  }
  const candidates = index.get(linkKey(target)) ?? [];
  if (candidates.length === 0) return none;
  const here = dirname(fromNote);
  const sorted = [...candidates].sort((a, b) => {
    const sa = dirname(a) === here ? 0 : 1;
    const sb = dirname(b) === here ? 0 : 1;
    return sa - sb || a.split("/").length - b.split("/").length || a.length - b.length || a.localeCompare(b);
  });
  return { path: sorted[0], ambiguous: sorted.length > 1, candidates: sorted };
}
