//! 一个打开的库的全部运行时状态：边界、索引、全文缓存、已知内容哈希。
//! 已知哈希用于过滤自己写入触发的监听事件（风险 4）。

use crate::error::Result;
use crate::index::FileIndex;
use crate::io::{self, NoteContent, SaveOutcome};
use crate::scan::{self, FileEntry};
use crate::scope::{is_hidden_rel, Vault};
use crate::search::{ContentCache, SearchHit};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum VaultEvent {
    Created { entry: FileEntry },
    /// `hash` 仅对文本文件提供
    Modified { entry: FileEntry, hash: Option<String> },
    Removed { path: String },
    Renamed { from: String, entry: FileEntry },
}

pub struct VaultSession {
    pub vault: Vault,
    pub index: FileIndex,
    pub cache: ContentCache,
    /// 相对路径 → 最近一次读取 / 写入 / 已通知的内容哈希
    known: HashMap<String, String>,
}

impl VaultSession {
    pub fn new(vault: Vault) -> Self {
        Self { vault, index: FileIndex::new(), cache: ContentCache::new(), known: HashMap::new() }
    }

    /// 重新扫描整个库，替换索引。
    pub fn rescan(&mut self, batch: usize, mut on_batch: impl FnMut(&[FileEntry])) -> Result<usize> {
        self.index.clear();
        let index = &mut self.index;
        let total = scan::scan(&self.vault, batch, |b| {
            on_batch(&b);
            for e in b {
                index.upsert(e);
            }
        })?;
        self.cache.retain_indexed(&self.index);
        Ok(total)
    }

    pub fn read(&mut self, rel: &str) -> Result<NoteContent> {
        let n = io::read_note(&self.vault, rel)?;
        self.known.insert(rel.to_string(), n.hash.clone());
        Ok(n)
    }

    pub fn save(&mut self, rel: &str, content: &str, base_hash: Option<&str>) -> Result<SaveOutcome> {
        let known = &mut self.known;
        let previous = known.get(rel).cloned();
        let key = rel.to_string();
        let out = io::save_note(&self.vault, rel, content, base_hash, |h| {
            known.insert(key, h.to_string());
        });
        match &out {
            Ok(SaveOutcome::Saved { .. }) => self.refresh_entry(rel, Some(content)),
            Ok(SaveOutcome::Conflict { disk_hash, .. }) => {
                self.known.insert(rel.to_string(), disk_hash.clone());
            }
            Ok(SaveOutcome::Missing) => {}
            Err(_) => match previous {
                Some(p) => {
                    self.known.insert(rel.to_string(), p);
                }
                None => {
                    self.known.remove(rel);
                }
            },
        }
        out
    }

    pub fn read_bytes(&mut self, rel: &str) -> Result<(Vec<u8>, String)> {
        let (b, h) = io::read_bytes(&self.vault, rel)?;
        self.known.insert(rel.to_string(), h.clone());
        Ok((b, h))
    }

    pub fn save_bytes(&mut self, rel: &str, bytes: &[u8], base_hash: Option<&str>) -> Result<io::BytesSaveOutcome> {
        let known = &mut self.known;
        let key = rel.to_string();
        let out = io::save_bytes(&self.vault, rel, bytes, base_hash, |h| {
            known.insert(key, h.to_string());
        })?;
        if let io::BytesSaveOutcome::Saved { .. } = out {
            self.cache.invalidate(rel);
            self.refresh_entry(rel, None);
        }
        Ok(out)
    }

    pub fn create_file(&mut self, dir: Option<&str>, name: &str, default_ext: &str, bytes: &[u8]) -> Result<FileEntry> {
        let rel = io::create_file(&self.vault, dir, name, default_ext, bytes)?;
        self.known.insert(rel.clone(), io::hash_bytes(bytes));
        self.refresh_entry(&rel, std::str::from_utf8(bytes).ok().filter(|_| default_ext != "docx"));
        Ok(self.index.get(&rel).cloned().expect("刚创建的文件"))
    }

    pub fn create(&mut self, dir: Option<&str>, name: &str, content: &str) -> Result<FileEntry> {
        let rel = io::create_note(&self.vault, dir, name, content)?;
        self.known.insert(rel.clone(), io::hash_bytes(content.as_bytes()));
        self.refresh_entry(&rel, Some(content));
        Ok(self.index.get(&rel).cloned().expect("刚创建的文件"))
    }

    /// 移动文件到另一个目录。返回 (新路径, 新条目)；新条目为 None 表示移到了隐藏目录（如 `.trash`）。
    /// 索引与已知哈希同步更新，所以监听器随后报告的变化不会重复通知前端。
    pub fn move_file(&mut self, from: &str, to_dir: &str) -> Result<(String, Option<FileEntry>)> {
        let rel = io::move_file(&self.vault, from, to_dir)?;
        if rel == from {
            return Ok((rel, self.index.get(from).cloned()));
        }
        self.index.remove(from);
        self.cache.invalidate(from);
        let hash = self.known.remove(from);
        if is_hidden_rel(&rel) {
            return Ok((rel, None));
        }
        let abs = self.vault.root().join(&rel);
        let h = match hash {
            Some(h) => Some(h),
            None => io::disk_hash(&abs).ok().flatten(),
        };
        if let Some(h) = h {
            self.known.insert(rel.clone(), h);
        }
        self.refresh_entry(&rel, None);
        let e = self.index.get(&rel).cloned();
        Ok((rel, e))
    }

    /// 拖放导入：复制后立即登记索引与哈希，监听器随后报告时不会重复通知；返回新条目
    pub fn import_tree(&mut self, sources: &[PathBuf], target_dir: &str) -> Result<(Vec<FileEntry>, crate::import::ImportReport)> {
        let report = crate::import::import_tree(&self.vault, sources, target_dir)?;
        let mut entries = vec![];
        for rel in &report.imported {
            let abs = self.vault.root().join(rel);
            if let Some(e) = FileEntry::from_path(&self.vault, &abs) {
                if e.kind.is_editable() {
                    if let Ok(Some(h)) = io::disk_hash(&abs) {
                        self.known.insert(rel.clone(), h);
                    }
                }
                self.index.upsert(e.clone());
                entries.push(e);
            }
        }
        Ok((entries, report))
    }

    /// 反向链接计数（读取尚未缓存的正文）
    pub fn backlink_counts(&mut self) -> HashMap<String, u32> {
        self.cache.refresh(&self.vault, &self.index);
        crate::links::backlink_counts(&self.index, self.cache.texts())
    }

    fn refresh_entry(&mut self, rel: &str, content: Option<&str>) {
        if let Some(e) = FileEntry::from_path(&self.vault, &self.vault.root().join(rel)) {
            if let (Some(c), true) = (content, e.kind.is_text()) {
                self.cache.put(e.path.clone(), e.mtime, e.size, c.to_string());
            }
            self.index.upsert(e);
        }
    }

    pub fn search(&mut self, query: &str, limit: usize) -> Vec<SearchHit> {
        self.cache.refresh(&self.vault, &self.index);
        self.cache.search(query, limit, 3)
    }

    /// 把监听到的路径变化与索引对账，产出事件。
    /// `paths` 为绝对路径；`renames` 为能配对的 (from, to)。
    pub fn reconcile(&mut self, paths: Vec<PathBuf>, renames: Vec<(PathBuf, PathBuf)>) -> Vec<VaultEvent> {
        let mut events = vec![];
        let mut handled: HashSet<String> = HashSet::new();

        for (from, to) in renames {
            let (Some(f), Some(t)) = (self.vault.rel_of(&from), self.vault.rel_of(&to)) else { continue };
            if is_hidden_rel(&t) {
                continue;
            }
            if is_hidden_rel(&f) || self.index.get(&f).is_none() {
                // 例如自己的原子写入：隐藏临时文件 → 目标文件，按普通变化处理
                self.reconcile_path(&t, &mut events);
                handled.insert(t);
                continue;
            }
            match FileEntry::from_path(&self.vault, &to) {
                Some(entry) => {
                    self.index.remove(&f);
                    self.cache.invalidate(&f);
                    if let Some(h) = self.known.remove(&f) {
                        self.known.insert(t.clone(), h);
                    }
                    self.index.upsert(entry.clone());
                    events.push(VaultEvent::Renamed { from: f.clone(), entry });
                }
                None => {
                    self.reconcile_path(&f, &mut events);
                    self.reconcile_path(&t, &mut events);
                }
            }
            handled.insert(f);
            handled.insert(t);
        }

        let mut rels: Vec<String> = paths.iter().filter_map(|p| self.vault.rel_of(p)).collect();
        rels.sort();
        rels.dedup();
        for rel in rels {
            if rel.is_empty() || is_hidden_rel(&rel) || handled.contains(&rel) {
                continue;
            }
            self.reconcile_path(&rel, &mut events);
        }
        events
    }

    fn reconcile_path(&mut self, rel: &str, events: &mut Vec<VaultEvent>) {
        let abs = self.vault.root().join(rel);
        let meta = abs.symlink_metadata();
        if meta.is_err() {
            // 已不存在：文件或整个目录被删除 / 移走
            let mut gone: Vec<String> = self.index.paths_under(rel);
            if self.index.get(rel).is_some() {
                gone.push(rel.to_string());
            }
            for p in gone {
                self.index.remove(&p);
                self.cache.invalidate(&p);
                self.known.remove(&p);
                events.push(VaultEvent::Removed { path: p });
            }
            return;
        }
        if abs.is_dir() && !meta.as_ref().is_ok_and(|m| m.file_type().is_symlink()) {
            // 新出现的目录（例如从外部移入）：只登记索引中还没有的文件
            let mut found = vec![];
            for e in walkdir::WalkDir::new(&abs)
                .follow_links(false)
                .min_depth(1)
                .into_iter()
                .filter_entry(|e| !e.file_name().to_string_lossy().starts_with('.'))
                .flatten()
            {
                if e.file_type().is_dir() {
                    continue;
                }
                if let Some(fe) = FileEntry::from_path(&self.vault, e.path()) {
                    if self.index.get(&fe.path).is_none() {
                        found.push(fe);
                    }
                }
            }
            for fe in found {
                self.index.upsert(fe.clone());
                events.push(VaultEvent::Created { entry: fe });
            }
            return;
        }
        let Some(entry) = FileEntry::from_path(&self.vault, &abs) else { return };
        let existed = self.index.get(rel).is_some();
        let hash = if entry.kind.is_editable() { io::disk_hash(&abs).ok().flatten() } else { None };
        if let (Some(h), Some(k)) = (&hash, self.known.get(rel)) {
            if h == k {
                // 自己写入的，或内容未变：只更新元数据
                self.index.upsert(entry);
                return;
            }
        }
        if let Some(h) = &hash {
            self.known.insert(rel.to_string(), h.clone());
        }
        self.cache.invalidate(rel);
        self.index.upsert(entry.clone());
        if existed {
            events.push(VaultEvent::Modified { entry, hash });
        } else {
            events.push(VaultEvent::Created { entry });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn session() -> (tempfile::TempDir, VaultSession) {
        let d = tempfile::tempdir().unwrap();
        fs::create_dir_all(d.path().join("读书")).unwrap();
        fs::write(d.path().join("读书/a.md"), "v1").unwrap();
        fs::write(d.path().join("b.md"), "b").unwrap();
        let mut s = VaultSession::new(Vault::open(d.path()).unwrap());
        s.rescan(100, |_| {}).unwrap();
        (d, s)
    }

    #[test]
    fn own_writes_are_suppressed_external_ones_reported() {
        let (_d, mut s) = session();
        let root = s.vault.root().to_path_buf();
        let n = s.read("读书/a.md").unwrap();
        assert!(matches!(s.save("读书/a.md", "v2", Some(&n.hash)).unwrap(), SaveOutcome::Saved { .. }));
        // 监听器随后报告这个路径：内容等于自己写的 → 无事件
        assert!(s.reconcile(vec![root.join("读书/a.md")], vec![]).is_empty());
        // 外部修改 → Modified，带新哈希
        fs::write(root.join("读书/a.md"), "外部").unwrap();
        let ev = s.reconcile(vec![root.join("读书/a.md")], vec![]);
        match &ev[..] {
            [VaultEvent::Modified { entry, hash: Some(h) }] => {
                assert_eq!(entry.path, "读书/a.md");
                assert_eq!(h, &io::hash_bytes("外部".as_bytes()));
            }
            e => panic!("{e:?}"),
        }
        // 重复通知同一内容 → 不再重复报告
        assert!(s.reconcile(vec![root.join("读书/a.md")], vec![]).is_empty());
    }

    #[test]
    fn created_removed_renamed_and_dirs() {
        let (_d, mut s) = session();
        let root = s.vault.root().to_path_buf();
        fs::write(root.join("新.md"), "x").unwrap();
        assert!(matches!(&s.reconcile(vec![root.join("新.md")], vec![])[..], [VaultEvent::Created { .. }]));

        fs::rename(root.join("新.md"), root.join("改名.md")).unwrap();
        let ev = s.reconcile(vec![], vec![(root.join("新.md"), root.join("改名.md"))]);
        assert!(matches!(&ev[..], [VaultEvent::Renamed { from, entry }] if from == "新.md" && entry.path == "改名.md"));
        assert!(s.index.get("新.md").is_none() && s.index.get("改名.md").is_some());

        fs::remove_dir_all(root.join("读书")).unwrap();
        let ev = s.reconcile(vec![root.join("读书")], vec![]);
        assert_eq!(ev, vec![VaultEvent::Removed { path: "读书/a.md".into() }]);

        fs::create_dir_all(root.join("移入/子")).unwrap();
        fs::write(root.join("移入/子/c.md"), "c").unwrap();
        let ev = s.reconcile(vec![root.join("移入")], vec![]);
        assert!(matches!(&ev[..], [VaultEvent::Created { entry }] if entry.path == "移入/子/c.md"));

        // 隐藏路径被忽略
        fs::write(root.join(".tmp"), "").unwrap();
        assert!(s.reconcile(vec![root.join(".tmp")], vec![]).is_empty());
    }

    #[test]
    fn atomic_write_rename_from_hidden_tmp() {
        let (_d, mut s) = session();
        let root = s.vault.root().to_path_buf();
        let n = s.read("b.md").unwrap();
        s.save("b.md", "b2", Some(&n.hash)).unwrap();
        let ev = s.reconcile(vec![], vec![(root.join(".b.md.tmp-1-0"), root.join("b.md"))]);
        assert!(ev.is_empty());
    }

    #[test]
    fn move_is_not_reported_back_as_external_change() {
        let (_d, mut s) = session();
        let root = s.vault.root().to_path_buf();
        let e = s.move_file("b.md", "读书").unwrap().1.unwrap();
        assert_eq!(e.path, "读书/b.md");
        assert!(s.index.get("b.md").is_none());
        // 监听器报告改名、或分别报告两个路径：都不应产生事件
        assert!(s.reconcile(vec![], vec![(root.join("b.md"), root.join("读书/b.md"))]).is_empty());
        assert!(s.reconcile(vec![root.join("b.md"), root.join("读书/b.md")], vec![]).is_empty());
        // 放生到回收站
        let (to, e) = s.move_file("读书/b.md", ".trash").unwrap();
        assert!(e.is_none());
        assert_eq!(to, ".trash/b.md");
        // 从回收站找回
        let (back, e) = s.move_file(&to, "Inbox").unwrap();
        assert_eq!(back, "Inbox/b.md");
        assert!(e.is_some() && s.index.get("Inbox/b.md").is_some());
        assert!(s.index.get("读书/b.md").is_none());
    }

    #[test]
    fn backlinks_from_session() {
        let (_d, mut s) = session();
        s.create(None, "x", "参考 [[a]] 和 [[b]]").unwrap();
        let c = s.backlink_counts();
        assert_eq!(c.get("读书/a.md"), Some(&1));
        assert_eq!(c.get("b.md"), Some(&1));
    }

    #[test]
    fn search_and_create() {
        let (_d, mut s) = session();
        let e = s.create(None, "灵感", "今天想到一个像素书房的点子").unwrap();
        assert_eq!(e.path, "Notes/灵感.md");
        let hits = s.search("像素书房", 10);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].path, "Notes/灵感.md");
    }

    #[test]
    fn thousand_note_scan_and_search() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("中文目录")).unwrap();
        for i in 0..1000 {
            fs::write(dir.path().join(format!("中文目录/笔记{i:04}.md")),
                format!("---\ntags: [测试]\n---\n# 笔记{i}\n{}\n唯一关键词{i:04}\n", "知识整理与写作。".repeat(200))).unwrap();
        }
        let mut session = VaultSession::new(Vault::open(dir.path()).unwrap());
        let start = std::time::Instant::now();
        let mut batches = vec![];
        assert_eq!(session.rescan(200, |batch| batches.push(batch.len())).unwrap(), 1000);
        let scan = start.elapsed();
        assert_eq!(batches.iter().sum::<usize>(), 1000);
        assert!(batches.iter().all(|n| *n <= 200));
        let start = std::time::Instant::now();
        let hits = session.search("唯一关键词0999", 60);
        let cold = start.elapsed();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].path, "中文目录/笔记0999.md");
        let start = std::time::Instant::now();
        assert_eq!(session.search("知识整理", 60).len(), 60);
        println!("1000 notes: scan={scan:?}, cold_search={cold:?}, warm_search={:?}", start.elapsed());
    }
}
