//! 全文搜索（风险 8）：正文读入内存，子串匹配。中文不需要分词。索引可随时重建，不是正文的存储。

use crate::index::FileIndex;
use crate::scope::Vault;
use serde::Serialize;
use std::collections::HashMap;

/// 超过此大小的文件不进入全文索引
const MAX_INDEXED_BYTES: u64 = 8 * 1024 * 1024;
const SNIPPET_CHARS: usize = 36;

#[derive(Debug, Default)]
pub struct ContentCache {
    /// path → (mtime, size, 小写正文, 原文)
    docs: HashMap<String, CachedDoc>,
}

#[derive(Debug)]
struct CachedDoc {
    mtime: u64,
    size: u64,
    lower: String,
    text: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub path: String,
    /// 1 起始行号；文件名命中时为 0
    pub line: usize,
    pub snippet: String,
    /// 命中词在 snippet 中的字符区间
    pub start: usize,
    pub end: usize,
}

impl ContentCache {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn len(&self) -> usize {
        self.docs.len()
    }

    pub fn is_empty(&self) -> bool {
        self.docs.is_empty()
    }

    pub fn invalidate(&mut self, path: &str) {
        self.docs.remove(path);
    }

    pub fn clear(&mut self) {
        self.docs.clear();
    }

    /// 去掉索引中已不存在的条目（不读文件）。
    pub fn retain_indexed(&mut self, index: &FileIndex) {
        self.docs.retain(|p, _| index.get(p).is_some());
    }

    /// 已缓存且未过期的条目返回 true。
    fn fresh(&self, path: &str, mtime: u64, size: u64) -> bool {
        self.docs.get(path).is_some_and(|d| d.mtime == mtime && d.size == size)
    }

    /// 返回需要（重新）读取的文本文件列表。
    pub fn stale_paths(&self, index: &FileIndex) -> Vec<(String, u64, u64)> {
        index
            .entries()
            .filter(|e| e.kind.is_editable() && e.size <= MAX_INDEXED_BYTES && !self.fresh(&e.path, e.mtime, e.size))
            .map(|e| (e.path.clone(), e.mtime, e.size))
            .collect()
    }

    /// 全部已缓存的 (路径, 原文)
    pub fn texts(&self) -> impl Iterator<Item = (&str, &str)> {
        self.docs.iter().map(|(p, d)| (p.as_str(), d.text.as_str()))
    }

    pub fn put(&mut self, path: String, mtime: u64, size: u64, text: String) {
        let lower = text.to_lowercase();
        self.docs.insert(path, CachedDoc { mtime, size, lower, text });
    }

    /// 读取过期条目（读文件时不需要持有任何锁的版本见 `load_paths`）。
    pub fn refresh(&mut self, vault: &Vault, index: &FileIndex) {
        for (path, mtime, size, text) in load_paths(vault, self.stale_paths(index)) {
            self.put(path, mtime, size, text);
        }
        self.retain_indexed(index);
    }

    /// 子串搜索：不区分大小写，每个文件最多返回 `per_file` 条，总数最多 `limit`。
    pub fn search(&self, query: &str, limit: usize, per_file: usize) -> Vec<SearchHit> {
        let q = query.trim().to_lowercase();
        if q.is_empty() {
            return vec![];
        }
        let mut paths: Vec<&String> = self.docs.keys().collect();
        paths.sort();
        let mut hits = vec![];
        for path in paths {
            let d = &self.docs[path];
            if !d.lower.contains(&q) {
                continue;
            }
            let mut n = 0;
            for (i, (lower_line, line)) in d.lower.lines().zip(d.text.lines()).enumerate() {
                if let Some(pos) = lower_line.find(&q) {
                    hits.push(make_snippet(path, i + 1, line, lower_line, pos, q.len()));
                    n += 1;
                    if n >= per_file || hits.len() >= limit {
                        break;
                    }
                }
            }
            if hits.len() >= limit {
                break;
            }
        }
        hits
    }
}

/// 不持锁地读取一批文件（大库首次扫描后在后台线程调用）。
pub fn load_paths(vault: &Vault, paths: Vec<(String, u64, u64)>) -> Vec<(String, u64, u64, String)> {
    paths
        .into_iter()
        .filter_map(|(p, m, s)| {
            let abs = vault.resolve(&p).ok()?;
            let bytes = std::fs::read(abs).ok()?;
            let text = if p.to_ascii_lowercase().ends_with(".docx") {
                crate::docx::docx_text(&bytes)?
            } else {
                String::from_utf8(bytes).ok()?
            };
            Some((p, m, s, text))
        })
        .collect()
}

fn make_snippet(path: &str, line_no: usize, line: &str, lower_line: &str, byte_pos: usize, q_len: usize) -> SearchHit {
    // to_lowercase 可能改变字节长度；按字符序号对齐原文
    let char_start = lower_line[..byte_pos].chars().count();
    let char_len = lower_line[byte_pos..byte_pos + q_len].chars().count();
    let chars: Vec<char> = line.chars().collect();
    let char_start = char_start.min(chars.len());
    let from = char_start.saturating_sub(SNIPPET_CHARS / 2);
    let to = (char_start + char_len + SNIPPET_CHARS).min(chars.len());
    let mut snippet: String = chars[from..to].iter().collect::<String>();
    let mut offset = char_start - from;
    if from > 0 {
        snippet.insert(0, '…');
        offset += 1;
    }
    if to < chars.len() {
        snippet.push('…');
    }
    let snippet = snippet.trim_end().to_string();
    SearchHit { path: path.to_string(), line: line_no, start: offset, end: offset + char_len, snippet }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_chinese_and_case_insensitive() {
        let mut c = ContentCache::new();
        c.put("a.md".into(), 1, 1, "# 标题\n今天读了《三体》，记录一些想法。\nRust 很好".into());
        c.put("b.md".into(), 1, 1, "没有关系".into());
        let hits = c.search("三体", 10, 3);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].path, "a.md");
        assert_eq!(hits[0].line, 2);
        let chars: Vec<char> = hits[0].snippet.chars().collect();
        assert_eq!(chars[hits[0].start..hits[0].end].iter().collect::<String>(), "三体");
        assert_eq!(c.search("rust", 10, 3)[0].line, 3);
        assert!(c.search("  ", 10, 3).is_empty());
    }

    #[test]
    fn snippet_truncates_long_lines() {
        let mut c = ContentCache::new();
        let line = format!("{}关键词{}", "前".repeat(100), "后".repeat(100));
        c.put("a.md".into(), 1, 1, line);
        let h = &c.search("关键词", 10, 3)[0];
        assert!(h.snippet.starts_with('…') && h.snippet.ends_with('…'));
        let chars: Vec<char> = h.snippet.chars().collect();
        assert_eq!(chars[h.start..h.end].iter().collect::<String>(), "关键词");
    }

    #[test]
    fn respects_limits() {
        let mut c = ContentCache::new();
        for i in 0..10 {
            c.put(format!("{i}.md"), 1, 1, "x\nx\nx\nx".into());
        }
        assert_eq!(c.search("x", 100, 2).len(), 20);
        assert_eq!(c.search("x", 5, 2).len(), 5);
    }
}
