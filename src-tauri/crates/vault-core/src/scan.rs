//! 扫描（风险 8）：只收集元数据，按批回调，不读正文。

use crate::error::Result;
use crate::scope::Vault;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::UNIX_EPOCH;
use walkdir::WalkDir;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FileKind {
    Markdown,
    Text,
    /// Word 文档（.docx）：可在应用内编辑
    Word,
    Other,
}

impl FileKind {
    pub fn from_name(name: &str) -> Self {
        match name.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()) {
            Some(e) if e == "md" || e == "markdown" => FileKind::Markdown,
            Some(e) if e == "txt" => FileKind::Text,
            Some(e) if e == "docx" => FileKind::Word,
            _ => FileKind::Other,
        }
    }
    pub fn is_text(self) -> bool {
        matches!(self, FileKind::Markdown | FileKind::Text)
    }
    /// 可在应用内编辑、参与全文搜索的类型
    pub fn is_editable(self) -> bool {
        matches!(self, FileKind::Markdown | FileKind::Text | FileKind::Word)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    /// 库内相对路径，`/` 分隔
    pub path: String,
    pub name: String,
    pub kind: FileKind,
    pub size: u64,
    /// 修改时间（毫秒）
    pub mtime: u64,
}

impl FileEntry {
    pub fn from_path(vault: &Vault, abs: &Path) -> Option<Self> {
        let rel = vault.rel_of(abs)?;
        // 跟随符号链接取元数据；目标必须在库内
        let real = abs.canonicalize().ok()?;
        if !real.starts_with(vault.root()) {
            return None;
        }
        let meta = std::fs::metadata(&real).ok()?;
        if !meta.is_file() {
            return None;
        }
        let name = rel.rsplit('/').next().unwrap_or(&rel).to_string();
        let mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        Some(FileEntry { kind: FileKind::from_name(&name), path: rel, name, size: meta.len(), mtime })
    }
}

/// 遍历整个库，每 `batch` 条调用一次 `on_batch`，返回文件总数。
/// 跳过隐藏文件和隐藏目录（`.obsidian`、`.git`、`.trash` 等），不进入符号链接目录。
pub fn scan(vault: &Vault, batch: usize, mut on_batch: impl FnMut(Vec<FileEntry>)) -> Result<usize> {
    let mut buf = Vec::with_capacity(batch);
    let mut total = 0;
    let walker = WalkDir::new(vault.root())
        .follow_links(false)
        .min_depth(1)
        .into_iter()
        .filter_entry(|e| !e.file_name().to_string_lossy().starts_with('.'));
    for entry in walker {
        let Ok(entry) = entry else { continue };
        let ft = entry.file_type();
        if ft.is_dir() {
            continue;
        }
        // 普通文件，或指向库内文件的符号链接
        if let Some(fe) = FileEntry::from_path(vault, entry.path()) {
            buf.push(fe);
            total += 1;
            if buf.len() >= batch {
                on_batch(std::mem::replace(&mut buf, Vec::with_capacity(batch)));
            }
        }
    }
    if !buf.is_empty() {
        on_batch(buf);
    }
    Ok(total)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn scans_in_batches_and_skips_hidden() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::create_dir_all(root.join(".obsidian")).unwrap();
        fs::create_dir_all(root.join("读书/小说")).unwrap();
        fs::write(root.join(".obsidian/app.json"), "{}").unwrap();
        fs::write(root.join(".hidden.md"), "").unwrap();
        for i in 0..25 {
            fs::write(root.join(format!("读书/小说/第{i}章.md")), "正文").unwrap();
        }
        fs::write(root.join("资料.pdf"), b"%PDF").unwrap();
        fs::write(root.join("todo.txt"), "x").unwrap();
        fs::write(root.join("报告.DOCX"), b"PK").unwrap();
        let v = Vault::open(root).unwrap();
        let mut batches = vec![];
        let total = scan(&v, 10, |b| batches.push(b)).unwrap();
        assert_eq!(total, 28);
        assert_eq!(batches.iter().map(|b| b.len()).collect::<Vec<_>>(), vec![10, 10, 8]);
        let all: Vec<_> = batches.concat();
        assert!(all.iter().all(|e| !e.path.contains(".obsidian") && e.name != ".hidden.md"));
        let pdf = all.iter().find(|e| e.name == "资料.pdf").unwrap();
        assert_eq!(pdf.kind, FileKind::Other);
        assert_eq!(all.iter().find(|e| e.name == "todo.txt").unwrap().kind, FileKind::Text);
        assert_eq!(all.iter().find(|e| e.name == "报告.DOCX").unwrap().kind, FileKind::Word);
        assert!(all.iter().any(|e| e.path == "读书/小说/第3章.md" && e.kind == FileKind::Markdown));
    }

    #[cfg(unix)]
    #[test]
    fn skips_symlinks_outside_and_symlinked_dirs() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("v")).unwrap();
        fs::create_dir_all(dir.path().join("out")).unwrap();
        fs::write(dir.path().join("out/x.md"), "").unwrap();
        fs::write(dir.path().join("v/real.md"), "").unwrap();
        std::os::unix::fs::symlink(dir.path().join("out/x.md"), dir.path().join("v/ext.md")).unwrap();
        std::os::unix::fs::symlink(dir.path().join("out"), dir.path().join("v/extdir")).unwrap();
        std::os::unix::fs::symlink(dir.path().join("v/real.md"), dir.path().join("v/alias.md")).unwrap();
        let v = Vault::open(dir.path().join("v")).unwrap();
        let mut all = vec![];
        scan(&v, 100, |b| all.extend(b)).unwrap();
        let mut names: Vec<_> = all.iter().map(|e| e.path.clone()).collect();
        names.sort();
        assert_eq!(names, vec!["alias.md", "real.md"]);
    }
}
