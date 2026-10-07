//! 库边界（风险 7）：所有读写路径都经过这里校验，必须落在用户选择的库内。

use crate::error::{Result, VaultError};
use sha2::{Digest, Sha256};
use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone)]
pub struct Vault {
    root: PathBuf,
}

impl Vault {
    /// 打开库：规范化为真实路径，必须是已存在的目录。
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let p = path.as_ref();
        let root = p
            .canonicalize()
            .map_err(|_| VaultError::NotFound(p.display().to_string()))?;
        if !root.is_dir() {
            return Err(VaultError::InvalidPath(format!("不是文件夹：{}", root.display())));
        }
        Ok(Self { root })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// 库名称（文件夹名）。
    pub fn name(&self) -> String {
        self.root
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| self.root.display().to_string())
    }

    /// 库的稳定 ID：真实路径哈希的前 16 位，用于在应用数据目录中隔离每个库的布局和草稿。
    pub fn id(&self) -> String {
        let h = Sha256::digest(self.root.to_string_lossy().as_bytes());
        hex::encode(&h[..8])
    }

    /// 把库内相对路径解析为真实绝对路径，并校验不越界。
    ///
    /// - 拒绝绝对路径、`..`、空路径；
    /// - 已存在的路径会跟随符号链接后再校验，指向库外即拒绝；
    /// - 不存在的路径（新建文件）校验最近的已存在祖先目录，再拼接其余部分。
    pub fn resolve(&self, rel: &str) -> Result<PathBuf> {
        let rel_path = Path::new(rel);
        if rel.is_empty() {
            return Ok(self.root.clone());
        }
        let mut parts: Vec<&std::ffi::OsStr> = Vec::new();
        for c in rel_path.components() {
            match c {
                Component::Normal(s) => parts.push(s),
                Component::CurDir => {}
                _ => return Err(VaultError::InvalidPath(rel.to_string())),
            }
        }
        let joined = parts.iter().fold(self.root.clone(), |acc, s| acc.join(s));

        // 找到最近的已存在祖先（包括自身）
        let mut existing = joined.clone();
        let mut rest: Vec<std::ffi::OsString> = Vec::new();
        while existing.symlink_metadata().is_err() {
            match (existing.file_name(), existing.parent()) {
                (Some(name), Some(parent)) => {
                    rest.push(name.to_os_string());
                    existing = parent.to_path_buf();
                }
                _ => return Err(VaultError::InvalidPath(rel.to_string())),
            }
        }
        let real = existing
            .canonicalize()
            .map_err(|_| VaultError::OutsideVault(rel.to_string()))?;
        if !real.starts_with(&self.root) {
            return Err(VaultError::OutsideVault(rel.to_string()));
        }
        let mut out = real;
        for name in rest.iter().rev() {
            out.push(name);
        }
        Ok(out)
    }

    /// 绝对路径转库内相对路径（统一使用 `/` 分隔）。不在库内返回 None。
    pub fn rel_of(&self, abs: &Path) -> Option<String> {
        let stripped = abs.strip_prefix(&self.root).ok()?;
        let parts: Vec<String> = stripped
            .components()
            .filter_map(|c| match c {
                Component::Normal(s) => Some(s.to_string_lossy().into_owned()),
                _ => None,
            })
            .collect();
        Some(parts.join("/"))
    }
}

/// 路径中任一段以 `.` 开头即视为隐藏（`.obsidian`、`.git`、`.trash`、我们自己的临时文件）。
pub fn is_hidden_rel(rel: &str) -> bool {
    rel.split('/').any(|seg| seg.starts_with('.'))
}

/// 校验用户输入的文件名：不允许路径分隔符和 Obsidian 禁止的字符。
pub fn validate_file_name(name: &str) -> Result<()> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
        return Err(VaultError::InvalidPath("文件名不能为空".into()));
    }
    if trimmed.starts_with('.') {
        return Err(VaultError::InvalidPath("文件名不能以 . 开头".into()));
    }
    const BAD: &[char] = &['/', '\\', ':', '*', '?', '"', '<', '>', '|', '#', '^', '[', ']'];
    if let Some(c) = trimmed.chars().find(|c| BAD.contains(c) || c.is_control()) {
        return Err(VaultError::InvalidPath(format!("文件名不能包含字符 {c:?}")));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn setup() -> (tempfile::TempDir, Vault) {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("vault/笔记")).unwrap();
        fs::write(dir.path().join("vault/笔记/a.md"), "hi").unwrap();
        fs::write(dir.path().join("outside.md"), "secret").unwrap();
        let v = Vault::open(dir.path().join("vault")).unwrap();
        (dir, v)
    }

    #[test]
    fn resolves_existing_and_new_paths() {
        let (_d, v) = setup();
        assert_eq!(v.resolve("笔记/a.md").unwrap(), v.root().join("笔记/a.md"));
        // 新文件、新目录都允许
        assert_eq!(
            v.resolve("Notes/子目录/新笔记.md").unwrap(),
            v.root().join("Notes/子目录/新笔记.md")
        );
        assert_eq!(v.rel_of(&v.root().join("笔记/a.md")).unwrap(), "笔记/a.md");
    }

    #[test]
    fn rejects_traversal_and_absolute() {
        let (_d, v) = setup();
        for bad in ["../outside.md", "笔记/../../outside.md", "/etc/passwd"] {
            assert!(v.resolve(bad).is_err(), "{bad} 应被拒绝");
        }
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_pointing_outside() {
        let (d, v) = setup();
        std::os::unix::fs::symlink(d.path().join("outside.md"), v.root().join("link.md")).unwrap();
        std::os::unix::fs::symlink(d.path(), v.root().join("outdir")).unwrap();
        assert!(matches!(v.resolve("link.md"), Err(VaultError::OutsideVault(_))));
        assert!(matches!(v.resolve("outdir/new.md"), Err(VaultError::OutsideVault(_))));
        // 指向库内的链接允许，并解析到真实目标
        std::os::unix::fs::symlink(v.root().join("笔记/a.md"), v.root().join("inner.md")).unwrap();
        assert_eq!(v.resolve("inner.md").unwrap(), v.root().join("笔记/a.md"));
    }

    #[test]
    fn file_name_validation() {
        assert!(validate_file_name("读书笔记 2026").is_ok());
        for bad in ["", " ", "a/b", "a:b", ".hidden", "x[1]"] {
            assert!(validate_file_name(bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn hidden_detection() {
        assert!(is_hidden_rel(".obsidian/app.json"));
        assert!(is_hidden_rel("笔记/.a.md.tmp-1"));
        assert!(!is_hidden_rel("笔记/a.md"));
    }
}
