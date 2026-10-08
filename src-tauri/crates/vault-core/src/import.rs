//! 导入：复制外部文件到库内，绝不移动或修改原文件。同名时先报告，由用户选择保留两份或取消。

use crate::error::{Result, VaultError};
use crate::io::write_atomic;
use crate::scope::Vault;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ImportOutcome {
    /// 全部导入完成，返回新文件的相对路径
    Done { imported: Vec<String> },
    /// 存在同名文件，什么都没有复制；`names` 为冲突的文件名
    Conflicts { names: Vec<String> },
}

/// 同名时生成 "名称 (1).ext"、"名称 (2).ext"…
fn keep_both_name(dir: &Path, name: &str) -> String {
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s.to_string(), format!(".{e}")),
        _ => (name.to_string(), String::new()),
    };
    (1..)
        .map(|i| format!("{stem} ({i}){ext}"))
        .find(|n| !dir.join(n).exists())
        .expect("无限序列")
}

/// 把同目录下的临时文件以"不覆盖"的方式落到 `name`（被占用则依次尝试"名称 (n)"）。
/// 用硬链接实现原子的"不存在才创建"；文件系统不支持硬链接时退回到先检查再改名。
fn commit_no_clobber(tmp: &Path, parent: &Path, name: &str) -> Result<PathBuf> {
    let mut candidate = parent.join(name);
    for _ in 0..10_000 {
        match fs::hard_link(tmp, &candidate) {
            Ok(()) => {
                let _ = fs::remove_file(tmp);
                return Ok(candidate);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                candidate = parent.join(keep_both_name(parent, name));
            }
            Err(_) => {
                if candidate.symlink_metadata().is_ok() {
                    candidate = parent.join(keep_both_name(parent, name));
                    continue;
                }
                fs::rename(tmp, &candidate)?;
                return Ok(candidate);
            }
        }
    }
    let _ = fs::remove_file(tmp);
    Err(VaultError::InvalidPath(format!("同名文件太多：{name}")))
}

fn tmp_name(name: &str) -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static SEQ: AtomicU64 = AtomicU64::new(0);
    format!(".{}.import-{}-{}", name, std::process::id(), SEQ.fetch_add(1, Ordering::Relaxed))
}

/// `sources` 为外部绝对路径；`target_dir` 为库内相对目录（空字符串为库根）。
/// `keep_both = false` 时只要有同名就整体返回 Conflicts，不复制任何文件。
pub fn import_files(vault: &Vault, sources: &[PathBuf], target_dir: &str, keep_both: bool) -> Result<ImportOutcome> {
    let dir_abs = vault.resolve(target_dir)?;
    let mut plan = vec![];
    let mut conflicts = vec![];
    for src in sources {
        let meta = fs::metadata(src).map_err(|_| VaultError::NotFound(src.display().to_string()))?;
        if !meta.is_file() {
            return Err(VaultError::InvalidPath(format!("只能导入文件：{}", src.display())));
        }
        let name = src
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .ok_or_else(|| VaultError::InvalidPath(src.display().to_string()))?;
        let name = name.trim_start_matches('.').to_string();
        let in_plan = plan.iter().any(|(_, n): &(PathBuf, String)| n == &name);
        if dir_abs.join(&name).exists() || in_plan {
            conflicts.push(name.clone());
        }
        plan.push((src.clone(), name));
    }
    if !conflicts.is_empty() && !keep_both {
        return Ok(ImportOutcome::Conflicts { names: conflicts });
    }
    fs::create_dir_all(&dir_abs)?;
    let mut imported = vec![];
    for (src, name) in plan {
        let tmp = dir_abs.join(tmp_name(&name));
        let bytes = fs::read(&src)?;
        write_atomic(&tmp, &bytes, |_| {})?;
        let target = commit_no_clobber(&tmp, &dir_abs, &name)?;
        let rel = vault.rel_of(&target).ok_or_else(|| VaultError::OutsideVault(name.clone()))?;
        imported.push(rel);
    }
    Ok(ImportOutcome::Done { imported })
}

/// 一次拖放最多导入的文件数（防止误拖整个磁盘）
pub const MAX_DROP_FILES: usize = 2000;

#[derive(Debug, Clone, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    /// 新复制进库的文件（库内相对路径）
    pub imported: Vec<String>,
    /// 本来就在库里的文件：不复制，原样返回相对路径（前端可以只加书架引用）
    pub in_vault: Vec<String>,
    /// 因同名而改名保留两份的数量
    pub renamed: usize,
    /// 跳过的隐藏文件、符号链接等
    pub skipped: usize,
}

fn is_hidden_name(p: &Path) -> bool {
    p.file_name().is_some_and(|n| n.to_string_lossy().starts_with('.'))
}

/// 拖放导入：文件与文件夹都可以（文件夹保留子目录结构）。从不覆盖，同名自动保留两份；
/// 原文件只复制、不移动。库里已有的文件不复制。
pub fn import_tree(vault: &Vault, sources: &[PathBuf], target_dir: &str) -> Result<ImportReport> {
    let dir_abs = vault.resolve(target_dir)?;
    let root = vault.root();
    let mut report = ImportReport::default();
    // (源文件, 相对于目标目录的路径)
    let mut plan: Vec<(PathBuf, PathBuf)> = vec![];
    for src in sources {
        let real = fs::canonicalize(src).map_err(|_| VaultError::NotFound(src.display().to_string()))?;
        let meta = fs::metadata(&real)?;
        let inside = real.starts_with(root);
        if meta.is_file() {
            if inside {
                if let Some(rel) = vault.rel_of(&real) {
                    report.in_vault.push(rel);
                }
            } else if is_hidden_name(&real) {
                report.skipped += 1;
            } else {
                plan.push((real.clone(), PathBuf::from(real.file_name().unwrap_or_default())));
            }
            continue;
        }
        if !meta.is_dir() {
            report.skipped += 1;
            continue;
        }
        // 拖入的是库的上级目录：会把库复制进自己，拒绝
        if !inside && root.starts_with(&real) {
            return Err(VaultError::InvalidPath(format!("不能导入包含书房本身的文件夹：{}", real.display())));
        }
        // 文件夹：目标里已有同名文件夹时整个改名，不与已有内容混在一起
        let folder = real.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "导入".into());
        let folder = if !inside && dir_abs.join(&folder).exists() { keep_both_name(&dir_abs, &folder) } else { folder };
        for e in walkdir::WalkDir::new(&real)
            .follow_links(false)
            .min_depth(1)
            .into_iter()
            .filter_entry(|e| !e.file_name().to_string_lossy().starts_with('.'))
        {
            let Ok(e) = e else {
                report.skipped += 1;
                continue;
            };
            if e.file_type().is_dir() {
                continue;
            }
            if !e.file_type().is_file() {
                report.skipped += 1;
                continue;
            }
            if inside {
                if let Some(rel) = vault.rel_of(e.path()) {
                    report.in_vault.push(rel);
                }
                continue;
            }
            let sub = e.path().strip_prefix(&real).unwrap_or(e.path());
            plan.push((e.path().to_path_buf(), Path::new(&folder).join(sub)));
            if plan.len() > MAX_DROP_FILES {
                return Err(VaultError::InvalidPath(format!("一次最多导入 {MAX_DROP_FILES} 个文件，请分批拖入")));
            }
        }
    }
    if plan.len() > MAX_DROP_FILES {
        return Err(VaultError::InvalidPath(format!("一次最多导入 {MAX_DROP_FILES} 个文件，请分批拖入")));
    }
    for (src, rel) in plan {
        let mut target = dir_abs.join(&rel);
        let parent = target.parent().map(Path::to_path_buf).unwrap_or_else(|| dir_abs.clone());
        // 再次确认目标在库内（防止奇怪的文件名）
        let parent_rel = vault.rel_of(&parent).ok_or_else(|| VaultError::OutsideVault(rel.display().to_string()))?;
        let parent = vault.resolve(&parent_rel)?;
        fs::create_dir_all(&parent)?;
        let name = target.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        // 复制到同目录的隐藏临时文件，再以不覆盖的方式落盘：不会留下写了一半的文件，也不会盖掉别人刚写的文件
        let tmp = parent.join(tmp_name(&name));
        if let Err(e) = fs::copy(&src, &tmp) {
            let _ = fs::remove_file(&tmp);
            return Err(e.into());
        }
        let final_path = commit_no_clobber(&tmp, &parent, &name)?;
        if final_path != target {
            report.renamed += 1;
        }
        target = final_path;
        if let Some(r) = vault.rel_of(&target) {
            report.imported.push(r);
        }
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copies_without_touching_source_and_handles_conflicts() {
        let d = tempfile::tempdir().unwrap();
        fs::create_dir_all(d.path().join("v/资料")).unwrap();
        fs::create_dir_all(d.path().join("ext")).unwrap();
        let src = d.path().join("ext/报告.pdf");
        fs::write(&src, b"%PDF-1.7 data").unwrap();
        let before = fs::metadata(&src).unwrap().modified().unwrap();
        let v = Vault::open(d.path().join("v")).unwrap();

        let out = import_files(&v, std::slice::from_ref(&src), "资料", false).unwrap();
        assert_eq!(out, ImportOutcome::Done { imported: vec!["资料/报告.pdf".into()] });
        assert_eq!(fs::read(d.path().join("v/资料/报告.pdf")).unwrap(), b"%PDF-1.7 data");
        assert!(src.exists());
        assert_eq!(fs::metadata(&src).unwrap().modified().unwrap(), before);

        // 再导入一次：报告冲突，不复制
        let out = import_files(&v, std::slice::from_ref(&src), "资料", false).unwrap();
        assert_eq!(out, ImportOutcome::Conflicts { names: vec!["报告.pdf".into()] });
        assert_eq!(fs::read_dir(d.path().join("v/资料")).unwrap().count(), 1);

        // 选择保留两份
        let out = import_files(&v, std::slice::from_ref(&src), "资料", true).unwrap();
        assert_eq!(out, ImportOutcome::Done { imported: vec!["资料/报告 (1).pdf".into()] });
    }

    #[test]
    fn drop_import_files_folders_and_vault_files() {
        let d = tempfile::tempdir().unwrap();
        let v_root = d.path().join("v");
        fs::create_dir_all(v_root.join("读书")).unwrap();
        fs::write(v_root.join("读书/已有.md"), "库里的").unwrap();
        fs::write(v_root.join("读书/a.pdf"), "旧").unwrap();
        let ext = d.path().join("ext");
        fs::create_dir_all(ext.join("论文/子")).unwrap();
        fs::write(ext.join("a.pdf"), "新").unwrap();
        fs::write(ext.join("论文/1.md"), "一").unwrap();
        fs::write(ext.join("论文/子/2.txt"), "二").unwrap();
        fs::write(ext.join("论文/.DS_Store"), "x").unwrap();
        fs::write(ext.join(".hidden"), "x").unwrap();
        let v = Vault::open(&v_root).unwrap();

        let r = import_tree(&v, &[ext.join("a.pdf"), ext.join("论文"), ext.join(".hidden"), v_root.join("读书/已有.md")], "读书").unwrap();
        let mut imported = r.imported.clone();
        imported.sort();
        assert_eq!(imported, vec!["读书/a (1).pdf", "读书/论文/1.md", "读书/论文/子/2.txt"]);
        assert_eq!(r.in_vault, vec!["读书/已有.md"]);
        assert_eq!(r.renamed, 1);
        assert_eq!(r.skipped, 1);
        assert_eq!(fs::read_to_string(v_root.join("读书/a.pdf")).unwrap(), "旧", "不覆盖");
        assert!(ext.join("论文/1.md").exists(), "原文件不动");
        assert!(!v_root.join("读书/论文/.DS_Store").exists());
        // 没有残留临时文件
        let leftovers: Vec<_> = walkdir::WalkDir::new(&v_root).into_iter().flatten().filter(|e| e.file_name().to_string_lossy().contains(".import-")).collect();
        assert!(leftovers.is_empty());

        // 再拖一次同一个文件夹：整个文件夹改名，不混进已有的
        let r = import_tree(&v, &[ext.join("论文")], "读书").unwrap();
        assert!(r.imported.iter().all(|p| p.starts_with("读书/论文 (1)/")), "{:?}", r.imported);

        // 库内的文件夹：只返回其中的文件
        let r = import_tree(&v, &[v_root.join("读书/论文")], "").unwrap();
        assert!(r.imported.is_empty());
        assert_eq!(r.in_vault.len(), 2);
    }

    #[test]
    fn refuses_folder_that_contains_the_vault() {
        let d = tempfile::tempdir().unwrap();
        fs::create_dir_all(d.path().join("家/书房")).unwrap();
        fs::write(d.path().join("家/a.txt"), "a").unwrap();
        let v = Vault::open(d.path().join("家/书房")).unwrap();
        assert!(import_tree(&v, &[d.path().join("家")], "").is_err());
        assert_eq!(fs::read_dir(d.path().join("家/书房")).unwrap().count(), 0);
    }

    #[test]
    fn commit_never_overwrites() {
        let d = tempfile::tempdir().unwrap();
        fs::write(d.path().join("a.md"), "旧").unwrap();
        fs::write(d.path().join(".tmp"), "新").unwrap();
        let p = commit_no_clobber(&d.path().join(".tmp"), d.path(), "a.md").unwrap();
        assert_eq!(p.file_name().unwrap(), "a (1).md");
        assert_eq!(fs::read_to_string(d.path().join("a.md")).unwrap(), "旧");
        assert!(!d.path().join(".tmp").exists());
    }

    #[test]
    fn rejects_target_outside_vault() {
        let d = tempfile::tempdir().unwrap();
        fs::create_dir_all(d.path().join("v")).unwrap();
        fs::write(d.path().join("a.txt"), "a").unwrap();
        let v = Vault::open(d.path().join("v")).unwrap();
        assert!(import_files(&v, &[d.path().join("a.txt")], "../", false).is_err());
    }
}
