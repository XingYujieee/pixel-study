//! 读写（风险 4）：内容哈希、写前校验、同目录临时文件 + fsync + rename 的原子替换。

use crate::error::{Result, VaultError};
use crate::scope::{validate_file_name, Vault};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

pub fn hash_bytes(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NoteContent {
    pub content: String,
    pub hash: String,
}

/// 读取文本笔记。原样返回（保留 BOM、换行符），不是 UTF-8 时报错而不是替换字符。
pub fn read_note(vault: &Vault, rel: &str) -> Result<NoteContent> {
    let path = vault.resolve(rel)?;
    let bytes = fs::read(&path).map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => VaultError::NotFound(rel.to_string()),
        _ => VaultError::Io(e),
    })?;
    let hash = hash_bytes(&bytes);
    let content = String::from_utf8(bytes).map_err(|_| VaultError::NotUtf8(rel.to_string()))?;
    Ok(NoteContent { content, hash })
}

/// 计算磁盘文件当前哈希；文件不存在返回 None。
pub fn disk_hash(path: &Path) -> Result<Option<String>> {
    match fs::read(path) {
        Ok(b) => Ok(Some(hash_bytes(&b))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum SaveOutcome {
    /// 已写入，返回新内容哈希
    Saved { hash: String },
    /// 磁盘内容与编辑器的基准不一致：没有写入，交给用户比较
    #[serde(rename_all = "camelCase")]
    Conflict { disk_content: String, disk_hash: String },
    /// 文件已被外部删除：没有写入，也不自动重新创建
    Missing,
}

static TMP_COUNTER: AtomicU64 = AtomicU64::new(0);

fn tmp_path_for(target: &Path) -> PathBuf {
    let name = target.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let n = TMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    // 以 . 开头：Obsidian、扫描器、监听器都会忽略
    target.with_file_name(format!(".{name}.tmp-{}-{n}", std::process::id()))
}

/// 原子写入：同目录临时文件 → fsync → 保留原权限 → rename 覆盖 → fsync 目录（尽力）。
/// `before_commit` 在 rename 之前以新哈希调用，用于登记"自己写的"以便监听器过滤。
pub fn write_atomic(target: &Path, bytes: &[u8], before_commit: impl FnOnce(&str)) -> Result<String> {
    let tmp = tmp_path_for(target);
    let hash = hash_bytes(bytes);
    let result = (|| -> Result<()> {
        {
            let mut f = OpenOptions::new().write(true).create_new(true).open(&tmp)?;
            f.write_all(bytes)?;
            f.sync_all()?;
        }
        if let Ok(meta) = fs::metadata(target) {
            let _ = fs::set_permissions(&tmp, meta.permissions());
        }
        before_commit(&hash);
        fs::rename(&tmp, target)?;
        if let Some(dir) = target.parent() {
            if let Ok(d) = File::open(dir) {
                let _ = d.sync_all();
            }
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result.map(|_| hash)
}

/// 保存笔记。`base_hash` 是编辑器最后一次加载或保存时的内容哈希：
/// - 磁盘哈希与之不同 → Conflict（漏掉的外部修改），不写入；
/// - 文件已不存在 → Missing，不写入；
/// - `base_hash` 为 None 表示"明确要创建/覆盖"（例如用户选择重新创建）。
pub fn save_note(
    vault: &Vault,
    rel: &str,
    content: &str,
    base_hash: Option<&str>,
    before_commit: impl FnOnce(&str),
) -> Result<SaveOutcome> {
    let path = vault.resolve(rel)?;
    if let Some(base) = base_hash {
        match disk_hash(&path)? {
            None => return Ok(SaveOutcome::Missing),
            Some(h) if h != base => {
                let disk = read_note(vault, rel)?;
                return Ok(SaveOutcome::Conflict { disk_content: disk.content, disk_hash: disk.hash });
            }
            Some(_) => {}
        }
    } else if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let hash = write_atomic(&path, content.as_bytes(), before_commit)?;
    Ok(SaveOutcome::Saved { hash })
}

/// 新建笔记：目录默认 `Notes`，无扩展名时补 `.md`，同名时自动追加序号。返回相对路径。
pub fn create_note(vault: &Vault, dir: Option<&str>, name: &str, content: &str) -> Result<String> {
    create_file(vault, dir, name, "md", content.as_bytes())
}

/// 新建文件（Markdown / TXT / Word）。`default_ext` 在名称不带支持的扩展名时使用。
pub fn create_file(vault: &Vault, dir: Option<&str>, name: &str, default_ext: &str, bytes: &[u8]) -> Result<String> {
    validate_file_name(name)?;
    // None 表示默认 Notes，显式空串表示目录书架绑定的库根目录。
    let dir = dir.map(|d| d.trim_matches('/')).unwrap_or("Notes");
    let name = name.trim();
    // 名字里带的扩展名只有和要建的类型一致时才用（"报告.docx" 建 Markdown 时仍是 报告.docx.md，不会写出打不开的 Word）
    let same_kind = |e: &str| {
        let e = e.to_ascii_lowercase();
        let d = default_ext.to_ascii_lowercase();
        let text = |x: &str| matches!(x, "md" | "markdown" | "txt");
        e == d || (text(&e) && text(&d))
    };
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() && same_kind(e) => (s.to_string(), e.to_string()),
        _ => (name.to_string(), default_ext.to_string()),
    };
    let dir_abs = vault.resolve(dir)?;
    fs::create_dir_all(&dir_abs)?;
    for i in 0..1000 {
        let file = if i == 0 { format!("{stem}.{ext}") } else { format!("{stem} {i}.{ext}") };
        let rel = if dir.is_empty() { file } else { format!("{dir}/{file}") };
        let abs = vault.resolve(&rel)?;
        match OpenOptions::new().write(true).create_new(true).open(&abs) {
            Ok(mut f) => {
                f.write_all(bytes)?;
                f.sync_all()?;
                return Ok(rel);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.into()),
        }
    }
    Err(VaultError::AlreadyExists(format!("{dir}/{stem}.{ext}")))
}

/// 把文件移到库内另一个目录（`to_dir` 为空表示库根目录），不覆盖：同名时追加序号。
/// 用于灵感归档与"放生"到 `.trash/`（Obsidian 的回收站目录，随时可以找回）。返回新的相对路径。
pub fn move_file(vault: &Vault, from: &str, to_dir: &str) -> Result<String> {
    // 只解析所在文件夹，文件名保持原样：移动符号链接时移的是链接本身，不是它指向的文件
    let (parent_rel, file_name) = match from.trim_matches('/').rsplit_once('/') {
        Some((p, n)) => (p, n),
        None => ("", from.trim_matches('/')),
    };
    if file_name.is_empty() || file_name == "." || file_name == ".." {
        return Err(VaultError::InvalidPath(from.to_string()));
    }
    let src = vault.resolve(parent_rel)?.join(file_name);
    let meta = fs::symlink_metadata(&src).map_err(|_| VaultError::NotFound(from.to_string()))?;
    if !meta.is_file() && !meta.file_type().is_symlink() {
        return Err(VaultError::InvalidPath(format!("不是普通文件：{from}")));
    }
    let to_dir = to_dir.trim_matches('/');
    let name = from.rsplit('/').next().unwrap_or(from);
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s.to_string(), format!(".{e}")),
        _ => (name.to_string(), String::new()),
    };
    let from_dir = from.rfind('/').map(|i| &from[..i]).unwrap_or("");
    if from_dir == to_dir {
        return Ok(from.to_string());
    }
    let dir_abs = vault.resolve(to_dir)?;
    fs::create_dir_all(&dir_abs)?;
    for i in 0..1000 {
        let file = if i == 0 { format!("{stem}{ext}") } else { format!("{stem} {i}{ext}") };
        let rel = if to_dir.is_empty() { file } else { format!("{to_dir}/{file}") };
        let dst = vault.resolve(&rel)?;
        // 符号链接：直接改名（硬链接在有的系统上会跟随链接，变成移动目标文件）
        if meta.file_type().is_symlink() {
            if dst.symlink_metadata().is_ok() {
                continue;
            }
            fs::rename(&src, &dst)?;
            return Ok(rel);
        }
        // 硬链接 + 删除原文件：目标已存在时原子失败，不会覆盖
        match fs::hard_link(&src, &dst) {
            Ok(()) => {
                fs::remove_file(&src)?;
                return Ok(rel);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => {
                // 文件系统不支持硬链接：先检查再改名
                if dst.symlink_metadata().is_ok() {
                    continue;
                }
                fs::rename(&src, &dst)?;
                return Ok(rel);
            }
        }
    }
    Err(VaultError::AlreadyExists(format!("{to_dir}/{name}")))
}

/// 读取任意文件的原始字节及哈希。
pub fn read_bytes(vault: &Vault, rel: &str) -> Result<(Vec<u8>, String)> {
    let path = vault.resolve(rel)?;
    let bytes = fs::read(&path).map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => VaultError::NotFound(rel.to_string()),
        _ => VaultError::Io(e),
    })?;
    let hash = hash_bytes(&bytes);
    Ok((bytes, hash))
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum BytesSaveOutcome {
    Saved { hash: String },
    /// 磁盘内容与基准不一致：没有写入
    #[serde(rename_all = "camelCase")]
    Conflict { disk_hash: String },
    Missing,
}

/// 保存二进制文件（Word），语义与 `save_note` 相同，冲突时不返回磁盘内容（由前端重新读取）。
pub fn save_bytes(
    vault: &Vault,
    rel: &str,
    bytes: &[u8],
    base_hash: Option<&str>,
    before_commit: impl FnOnce(&str),
) -> Result<BytesSaveOutcome> {
    let path = vault.resolve(rel)?;
    if let Some(base) = base_hash {
        match disk_hash(&path)? {
            None => return Ok(BytesSaveOutcome::Missing),
            Some(h) if h != base => return Ok(BytesSaveOutcome::Conflict { disk_hash: h }),
            Some(_) => {}
        }
    } else if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let hash = write_atomic(&path, bytes, before_commit)?;
    Ok(BytesSaveOutcome::Saved { hash })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vault() -> (tempfile::TempDir, Vault) {
        let d = tempfile::tempdir().unwrap();
        let v = Vault::open(d.path()).unwrap();
        (d, v)
    }

    #[test]
    fn roundtrip_preserves_bytes_exactly() {
        let (_d, v) = vault();
        let original = "\u{feff}---\ntags: [读书]\n---\r\n# 标题\r\n\r\n- [ ] 任务 [[链接|别名]] ^block\r\n";
        fs::write(v.root().join("a.md"), original).unwrap();
        let n = read_note(&v, "a.md").unwrap();
        assert_eq!(n.content, original);
        let out = save_note(&v, "a.md", &n.content, Some(&n.hash), |_| {}).unwrap();
        assert_eq!(out, SaveOutcome::Saved { hash: n.hash.clone() });
        assert_eq!(fs::read(v.root().join("a.md")).unwrap(), original.as_bytes());
    }

    #[test]
    fn detects_missed_external_change() {
        let (_d, v) = vault();
        fs::write(v.root().join("a.md"), "v1").unwrap();
        let n = read_note(&v, "a.md").unwrap();
        fs::write(v.root().join("a.md"), "外部修改").unwrap();
        let out = save_note(&v, "a.md", "我的修改", Some(&n.hash), |_| {}).unwrap();
        match out {
            SaveOutcome::Conflict { disk_content, .. } => assert_eq!(disk_content, "外部修改"),
            o => panic!("{o:?}"),
        }
        // 没有覆盖
        assert_eq!(fs::read_to_string(v.root().join("a.md")).unwrap(), "外部修改");
    }

    #[test]
    fn missing_file_is_not_recreated() {
        let (_d, v) = vault();
        fs::write(v.root().join("a.md"), "v1").unwrap();
        let n = read_note(&v, "a.md").unwrap();
        fs::remove_file(v.root().join("a.md")).unwrap();
        assert_eq!(save_note(&v, "a.md", "x", Some(&n.hash), |_| {}).unwrap(), SaveOutcome::Missing);
        assert!(!v.root().join("a.md").exists());
        // 明确重新创建
        assert!(matches!(save_note(&v, "a.md", "x", None, |_| {}).unwrap(), SaveOutcome::Saved { .. }));
    }

    #[test]
    fn leaves_no_temp_files_and_calls_hook_before_rename() {
        let (_d, v) = vault();
        fs::write(v.root().join("a.md"), "v1").unwrap();
        let mut seen = None;
        let target = v.root().join("a.md");
        write_atomic(&target, "v2".as_bytes(), |h| {
            // 回调时仍是旧内容
            assert_eq!(fs::read_to_string(&target).unwrap(), "v1");
            seen = Some(h.to_string());
        })
        .unwrap();
        assert_eq!(seen.unwrap(), hash_bytes(b"v2"));
        let names: Vec<_> = fs::read_dir(v.root()).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(names, vec![std::ffi::OsString::from("a.md")]);
    }

    #[cfg(unix)]
    #[test]
    fn preserves_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let (_d, v) = vault();
        let p = v.root().join("a.md");
        fs::write(&p, "v1").unwrap();
        fs::set_permissions(&p, fs::Permissions::from_mode(0o640)).unwrap();
        write_atomic(&p, b"v2", |_| {}).unwrap();
        assert_eq!(fs::metadata(&p).unwrap().permissions().mode() & 0o777, 0o640);
    }

    #[test]
    fn non_utf8_is_rejected_not_mangled() {
        let (_d, v) = vault();
        fs::write(v.root().join("gbk.txt"), [0xC4, 0xE3, 0xBA, 0xC3]).unwrap();
        assert!(matches!(read_note(&v, "gbk.txt"), Err(VaultError::NotUtf8(_))));
    }

    #[test]
    fn bytes_save_checks_base() {
        let (_d, v) = vault();
        let rel = create_file(&v, Some("文档"), "报告", "docx", b"PK v1").unwrap();
        assert_eq!(rel, "文档/报告.docx");
        let (b, h) = read_bytes(&v, &rel).unwrap();
        assert_eq!(b, b"PK v1");
        assert!(matches!(save_bytes(&v, &rel, b"PK v2", Some(&h), |_| {}).unwrap(), BytesSaveOutcome::Saved { .. }));
        assert!(matches!(save_bytes(&v, &rel, b"PK v3", Some(&h), |_| {}).unwrap(), BytesSaveOutcome::Conflict { .. }));
        assert_eq!(fs::read(v.root().join(&rel)).unwrap(), b"PK v2");
    }

    #[test]
    fn move_file_never_overwrites() {
        let (_d, v) = vault();
        fs::create_dir_all(v.root().join("Inbox")).unwrap();
        fs::create_dir_all(v.root().join("读书")).unwrap();
        fs::write(v.root().join("Inbox/点子.md"), "新").unwrap();
        fs::write(v.root().join("读书/点子.md"), "旧").unwrap();
        let rel = move_file(&v, "Inbox/点子.md", "读书").unwrap();
        assert_eq!(rel, "读书/点子 1.md");
        assert_eq!(fs::read_to_string(v.root().join("读书/点子.md")).unwrap(), "旧");
        assert_eq!(fs::read_to_string(v.root().join(&rel)).unwrap(), "新");
        assert!(!v.root().join("Inbox/点子.md").exists());
        // 移到隐藏的回收站目录、库根目录
        let t = move_file(&v, &rel, ".trash").unwrap();
        assert_eq!(t, ".trash/点子 1.md");
        assert_eq!(move_file(&v, &t, "").unwrap(), "点子 1.md");
        assert!(move_file(&v, "../外面.md", "").is_err());
        assert!(move_file(&v, "不存在.md", "读书").is_err());
    }

    #[test]
    fn create_note_defaults_and_dedupes() {
        let (_d, v) = vault();
        assert_eq!(create_note(&v, None, "今天", "").unwrap(), "Notes/今天.md");
        assert_eq!(create_note(&v, None, "今天", "").unwrap(), "Notes/今天 1.md");
        assert_eq!(create_note(&v, Some("读书/"), "清单.txt", "a").unwrap(), "读书/清单.txt");
        assert_eq!(create_note(&v, Some("x"), "v1.2 计划", "").unwrap(), "x/v1.2 计划.md");
        assert!(create_note(&v, Some("../out"), "a", "").is_err());
        assert!(create_note(&v, None, "a/b", "").is_err());
    }

    #[test]
    fn explicit_root_shelf_creates_in_root() {
        let (_d, v) = vault();
        assert_eq!(create_note(&v, Some(""), "根目录笔记", "正文").unwrap(), "根目录笔记.md");
        assert_eq!(create_file(&v, Some(""), "根目录文档", "docx", b"PK").unwrap(), "根目录文档.docx");
        assert_eq!(fs::read_to_string(v.root().join("根目录笔记.md")).unwrap(), "正文");
    }

    #[test]
    fn name_extension_must_match_kind() {
        let (_d, v) = vault();
        assert_eq!(create_file(&v, Some(""), "报告.docx", "md", b"# x").unwrap(), "报告.docx.md");
        assert_eq!(create_file(&v, Some(""), "周报.markdown", "md", b"").unwrap(), "周报.markdown");
        assert_eq!(create_file(&v, Some(""), "表.docx", "docx", b"PK").unwrap(), "表.docx");
    }

    #[cfg(unix)]
    #[test]
    fn moving_a_symlink_moves_the_link_not_the_target() {
        let (d, v) = vault();
        fs::create_dir_all(d.path().join("Real")).unwrap();
        fs::write(d.path().join("Real/a.md"), "正文").unwrap();
        std::os::unix::fs::symlink(d.path().join("Real/a.md"), d.path().join("alias.md")).unwrap();
        let to = move_file(&v, "alias.md", ".trash").unwrap();
        assert_eq!(to, ".trash/alias.md");
        assert_eq!(fs::read_to_string(d.path().join("Real/a.md")).unwrap(), "正文");
        assert!(fs::symlink_metadata(d.path().join(".trash/alias.md")).unwrap().file_type().is_symlink());
    }
}
