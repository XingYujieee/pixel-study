//! 反向链接计数：解析 Markdown 中的 `[[维基链接]]` 与 `[文字](相对路径.md)`，
//! 按 Obsidian 的规则解析到库内文件，统计每个文件被多少篇**其他**笔记引用。
//! 只用于书房里"常被引用的书发亮"，不修改任何文件。

use crate::index::FileIndex;
use std::collections::{HashMap, HashSet};

/// 从一篇 Markdown 里取出所有链接目标（原样，未解析）。代码块里的内容忽略。
pub fn extract_links(text: &str) -> Vec<LinkTarget> {
    let mut out = vec![];
    let mut in_fence = false;
    for line in text.lines() {
        let t = line.trim_start();
        if t.starts_with("```") || t.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }
        // 去掉行内代码
        let mut clean = String::with_capacity(line.len());
        let mut in_code = false;
        for c in line.chars() {
            if c == '`' {
                in_code = !in_code;
                continue;
            }
            if !in_code {
                clean.push(c);
            }
        }
        wiki_links(&clean, &mut out);
        md_links(&clean, &mut out);
    }
    out
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LinkTarget {
    /// `[[名称]]`：按文件名（或部分路径）解析
    Wiki(String),
    /// `[x](路径)`：相对当前文件的路径
    Path(String),
}

fn wiki_links(line: &str, out: &mut Vec<LinkTarget>) {
    let mut rest = line;
    while let Some(i) = rest.find("[[") {
        let after = &rest[i + 2..];
        let Some(j) = after.find("]]") else { break };
        let inner = &after[..j];
        let target = inner.split('|').next().unwrap_or("");
        let target = target.split('#').next().unwrap_or("").split('^').next().unwrap_or("").trim();
        if !target.is_empty() {
            out.push(LinkTarget::Wiki(target.to_string()));
        }
        rest = &after[j + 2..];
    }
}

fn md_links(line: &str, out: &mut Vec<LinkTarget>) {
    let mut rest = line;
    while let Some(i) = rest.find("](") {
        let after = &rest[i + 2..];
        let end = after.find(')').unwrap_or(after.len());
        let raw = after[..end].trim();
        // 可能带标题：[x](a.md "标题")
        let raw = raw.split(" \"").next().unwrap_or(raw).trim_matches(|c| c == '<' || c == '>');
        let lower = raw.to_ascii_lowercase();
        let external = lower.contains("://") || lower.starts_with("mailto:") || lower.starts_with('#') || raw.is_empty();
        if !external {
            let path = raw.split('#').next().unwrap_or("");
            let decoded = percent_decode(path);
            if !decoded.is_empty() {
                out.push(LinkTarget::Path(decoded));
            }
        }
        rest = &after[end.min(after.len())..];
    }
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Some(v) = std::str::from_utf8(&b[i + 1..i + 3]).ok().and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8(out).unwrap_or_else(|_| s.to_string())
}

fn dir_of(path: &str) -> &str {
    path.rfind('/').map(|i| &path[..i]).unwrap_or("")
}

/// 规范化 `a/./b/../c` → `a/c`；越过根目录返回 None
fn normalize(path: &str) -> Option<String> {
    let mut parts: Vec<&str> = vec![];
    for seg in path.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            s => parts.push(s),
        }
    }
    Some(parts.join("/"))
}

/// 把链接解析为库内路径
pub fn resolve(index: &FileIndex, source: &str, target: &LinkTarget) -> Option<String> {
    match target {
        LinkTarget::Path(p) => {
            let base = if p.starts_with('/') { String::new() } else { dir_of(source).to_string() };
            let joined = if base.is_empty() { p.trim_start_matches('/').to_string() } else { format!("{base}/{p}") };
            let n = normalize(&joined)?;
            if index.get(&n).is_some() {
                return Some(n);
            }
            let with_md = format!("{n}.md");
            index.get(&with_md).map(|_| with_md)
        }
        LinkTarget::Wiki(t) => {
            let t = t.trim_start_matches('/');
            if t.contains('/') {
                // 部分路径：库根开始的完整路径，或任意以 /t 结尾的路径
                for cand in [t.to_string(), format!("{t}.md")] {
                    if index.get(&cand).is_some() {
                        return Some(cand);
                    }
                }
                let name = t.rsplit('/').next().unwrap_or(t);
                let suffix_md = format!("/{t}.md");
                let suffix = format!("/{t}");
                return index
                    .by_name(name)
                    .iter()
                    .find(|p| p.ends_with(&suffix_md) || p.ends_with(&suffix))
                    .cloned();
            }
            let cands = index.by_name(t);
            if cands.is_empty() {
                return None;
            }
            // 同名时：优先与来源同目录，其次路径最短
            let dir = dir_of(source);
            if let Some(p) = cands.iter().find(|p| dir_of(p) == dir) {
                return Some(p.clone());
            }
            cands.iter().min_by_key(|p| (p.len(), (*p).clone())).cloned()
        }
    }
}

/// 统计每个文件被多少篇其他 Markdown 笔记引用（同一篇里多次引用只算一次）
pub fn backlink_counts<'a>(index: &FileIndex, docs: impl Iterator<Item = (&'a str, &'a str)>) -> HashMap<String, u32> {
    let mut counts: HashMap<String, u32> = HashMap::new();
    for (source, text) in docs {
        let lower = source.to_lowercase();
        if !(lower.ends_with(".md") || lower.ends_with(".markdown")) {
            continue;
        }
        let mut seen: HashSet<String> = HashSet::new();
        for t in extract_links(text) {
            if let Some(p) = resolve(index, source, &t) {
                if p != source && seen.insert(p.clone()) {
                    *counts.entry(p).or_default() += 1;
                }
            }
        }
    }
    counts
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scan::{FileEntry, FileKind};

    fn idx(paths: &[&str]) -> FileIndex {
        let mut i = FileIndex::new();
        for p in paths {
            let name = p.rsplit('/').next().unwrap().to_string();
            i.upsert(FileEntry { path: p.to_string(), kind: FileKind::from_name(&name), name, size: 1, mtime: 0 });
        }
        i
    }

    #[test]
    fn extracts_wiki_and_md_links_skipping_code() {
        let text = "见 [[读书笔记|别名]] 和 ![[图.png]]，还有 [[a/b#标题]]\n[链接](../资料/c%20d.md \"t\") [外链](https://x.com)\n`[[不是]]`\n```\n[[也不是]]\n```\n[[#只有标题]]";
        let links = extract_links(text);
        assert_eq!(
            links,
            vec![
                LinkTarget::Wiki("读书笔记".into()),
                LinkTarget::Wiki("图.png".into()),
                LinkTarget::Wiki("a/b".into()),
                LinkTarget::Path("../资料/c d.md".into()),
            ]
        );
    }

    #[test]
    fn resolves_like_obsidian_and_counts_distinct_sources() {
        let index = idx(&["读书/读书笔记.md", "其他/读书笔记.md", "资料/c d.md", "a/b.md", "图.png", "x.md", "y.md"]);
        assert_eq!(resolve(&index, "其他/x.md", &LinkTarget::Wiki("读书笔记".into())).as_deref(), Some("其他/读书笔记.md"));
        assert_eq!(resolve(&index, "x.md", &LinkTarget::Wiki("读书笔记".into())).as_deref(), Some("其他/读书笔记.md"));
        assert_eq!(resolve(&index, "x.md", &LinkTarget::Wiki("读书/读书笔记".into())).as_deref(), Some("读书/读书笔记.md"));
        assert_eq!(resolve(&index, "读书/q.md", &LinkTarget::Path("../资料/c d.md".into())).as_deref(), Some("资料/c d.md"));
        assert_eq!(resolve(&index, "q.md", &LinkTarget::Path("../越界.md".into())), None);
        assert_eq!(resolve(&index, "q.md", &LinkTarget::Wiki("不存在".into())), None);

        let docs = vec![
            ("x.md", "[[a/b]] [[b]] [[图.png]] [[x]]"),
            ("y.md", "[[b]]"),
            ("图.png", "[[b]]"),
        ];
        let c = backlink_counts(&index, docs.into_iter());
        assert_eq!(c.get("a/b.md"), Some(&2));
        assert_eq!(c.get("图.png"), Some(&1));
        assert_eq!(c.get("x.md"), None, "自引用不算");
    }
}
