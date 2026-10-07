//! 文件索引：扫描结果 + 监听事件增量维护。按规范化文件名建立映射，供链接解析使用（风险 5）。

use crate::scan::FileEntry;
use std::collections::{BTreeMap, HashMap};
use unicode_normalization::UnicodeNormalization;

/// 规范化键：NFC + 小写，去掉 `.md` 扩展名。与 macOS 默认文件系统和 Obsidian 的匹配方式一致。
pub fn link_key(name: &str) -> String {
    let n: String = name.nfc().collect::<String>().to_lowercase();
    match n.strip_suffix(".md") {
        Some(s) => s.to_string(),
        None => n,
    }
}

#[derive(Debug, Default)]
pub struct FileIndex {
    entries: BTreeMap<String, FileEntry>,
    by_key: HashMap<String, Vec<String>>,
}

impl FileIndex {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn get(&self, path: &str) -> Option<&FileEntry> {
        self.entries.get(path)
    }

    pub fn entries(&self) -> impl Iterator<Item = &FileEntry> {
        self.entries.values()
    }

    pub fn clear(&mut self) {
        self.entries.clear();
        self.by_key.clear();
    }

    /// 插入或更新，返回是否为新文件。
    pub fn upsert(&mut self, e: FileEntry) -> bool {
        let key = link_key(&e.name);
        let path = e.path.clone();
        let is_new = self.entries.insert(path.clone(), e).is_none();
        if is_new {
            let v = self.by_key.entry(key).or_default();
            v.push(path);
            v.sort();
        }
        is_new
    }

    pub fn remove(&mut self, path: &str) -> Option<FileEntry> {
        let e = self.entries.remove(path)?;
        let key = link_key(&e.name);
        if let Some(v) = self.by_key.get_mut(&key) {
            v.retain(|p| p != path);
            if v.is_empty() {
                self.by_key.remove(&key);
            }
        }
        Some(e)
    }

    /// 某目录（及子目录）下的全部路径，用于目录被删除或移动时的批量处理。
    pub fn paths_under(&self, dir: &str) -> Vec<String> {
        let prefix = format!("{}/", dir.trim_end_matches('/'));
        self.entries.range(prefix.clone()..).take_while(|(k, _)| k.starts_with(&prefix)).map(|(k, _)| k.clone()).collect()
    }

    /// 按文件名（不含路径）查找所有同名文件，已排序。
    pub fn by_name(&self, name: &str) -> &[String] {
        self.by_key.get(&link_key(name)).map(|v| v.as_slice()).unwrap_or(&[])
    }

    /// 规范化文件名 → 路径列表的完整映射（前端链接解析用）。
    pub fn link_map(&self) -> HashMap<String, Vec<String>> {
        self.by_key.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scan::FileKind;

    fn e(path: &str) -> FileEntry {
        let name = path.rsplit('/').next().unwrap().to_string();
        FileEntry { kind: FileKind::from_name(&name), path: path.into(), name, size: 1, mtime: 1 }
    }

    #[test]
    fn indexes_by_normalized_name() {
        let mut idx = FileIndex::new();
        assert!(idx.upsert(e("a/读书.md")));
        assert!(!idx.upsert(e("a/读书.md")));
        idx.upsert(e("b/读书.md"));
        idx.upsert(e("Readme.md"));
        assert_eq!(idx.by_name("读书"), &["a/读书.md".to_string(), "b/读书.md".to_string()]);
        assert_eq!(idx.by_name("README.md").len(), 1);
        // NFD 形式的 é 与 NFC 视为同名
        idx.upsert(e("caf\u{0065}\u{0301}.md"));
        assert_eq!(idx.by_name("caf\u{00e9}").len(), 1);
        idx.remove("a/读书.md");
        assert_eq!(idx.by_name("读书"), &["b/读书.md".to_string()]);
    }

    #[test]
    fn paths_under_dir() {
        let mut idx = FileIndex::new();
        for p in ["x/1.md", "x/y/2.md", "xy/3.md", "z.md"] {
            idx.upsert(e(p));
        }
        let mut got = idx.paths_under("x");
        got.sort();
        assert_eq!(got, vec!["x/1.md", "x/y/2.md"]);
    }
}
