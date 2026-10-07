import type { FileEntry } from "../ipc";

export interface FuzzyMatch {
  entry: FileEntry;
  score: number;
  /** 文件名中命中的字符下标 */
  hits: number[];
}

/**
 * 文件名模糊匹配：子序列匹配，连续、词首、文件名开头命中加分。
 * 全部在内存中进行，几千个文件以内足够快。
 */
export function fuzzyScore(query: string, target: string): { score: number; hits: number[] } | null {
  const q = query.toLowerCase().replace(/\s+/g, "");
  const t = target.toLowerCase();
  if (!q) return { score: 0, hits: [] };
  // 完整子串优先
  const sub = t.indexOf(q);
  if (sub !== -1) {
    const hits = Array.from({ length: q.length }, (_, i) => sub + i);
    return { score: 1000 - sub * 2 - (t.length - q.length) * 0.5 + (sub === 0 ? 200 : 0), hits };
  }
  let ti = 0;
  let score = 0;
  let prev = -2;
  const hits: number[] = [];
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found === -1) return null;
    const boundary = found === 0 || /[\s_\-./（(]/.test(t[found - 1]);
    score += found === prev + 1 ? 15 : 1;
    if (boundary) score += 10;
    hits.push(found);
    prev = found;
    ti = found + 1;
  }
  return { score: score - t.length * 0.2, hits };
}

export function fuzzyFiles(query: string, entries: Iterable<FileEntry>, limit = 20): FuzzyMatch[] {
  const out: FuzzyMatch[] = [];
  for (const e of entries) {
    const byName = fuzzyScore(query, e.name);
    if (byName) {
      out.push({ entry: e, score: byName.score + 50, hits: byName.hits });
      continue;
    }
    const byPath = fuzzyScore(query, e.path);
    // 只在路径中命中的排在文件名命中之后
    if (byPath) out.push({ entry: e, score: byPath.score - 600, hits: [] });
  }
  out.sort((a, b) => b.score - a.score || a.entry.path.length - b.entry.path.length);
  return out.slice(0, limit);
}
