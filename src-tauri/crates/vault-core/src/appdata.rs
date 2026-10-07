//! 应用数据目录中的内容：全局配置、按库隔离的状态（最近打开）和恢复草稿。
//! 这些都不是正文的唯一存储；笔记正文只存在于库中。

use crate::error::Result;
use crate::io::{hash_bytes, write_atomic};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const RECENT_LIMIT: usize = 30;

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn read_json<T: for<'de> Deserialize<'de> + Default>(path: &Path) -> T {
    fs::read(path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

fn write_json<T: Serialize>(path: &Path, v: &T) -> Result<()> {
    if let Some(p) = path.parent() {
        fs::create_dir_all(p)?;
    }
    write_atomic(path, &serde_json::to_vec_pretty(v)?, |_| {})?;
    Ok(())
}

#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GlobalConfig {
    pub version: u32,
    pub last_vault: Option<String>,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VaultState {
    pub version: u32,
    pub recent: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Draft {
    pub path: String,
    pub content: String,
    /// 草稿基于的磁盘内容哈希；恢复时与当前磁盘比较，判断是否已被外部修改
    pub base_hash: Option<String>,
    pub saved_at: u64,
}

#[derive(Debug, Clone)]
pub struct AppData {
    dir: PathBuf,
}

impl AppData {
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        Self { dir: dir.into() }
    }

    fn config_path(&self) -> PathBuf {
        self.dir.join("config.json")
    }

    fn vault_dir(&self, vault_id: &str) -> PathBuf {
        self.dir.join("vaults").join(vault_id)
    }

    pub fn config(&self) -> GlobalConfig {
        read_json(&self.config_path())
    }

    pub fn set_last_vault(&self, root: &str) -> Result<()> {
        let mut c = self.config();
        c.version = 1;
        c.last_vault = Some(root.to_string());
        write_json(&self.config_path(), &c)
    }

    pub fn vault_state(&self, vault_id: &str) -> VaultState {
        read_json(&self.vault_dir(vault_id).join("state.json"))
    }

    pub fn push_recent(&self, vault_id: &str, path: &str) -> Result<Vec<String>> {
        let mut s = self.vault_state(vault_id);
        s.version = 1;
        s.recent.retain(|p| p != path);
        s.recent.insert(0, path.to_string());
        s.recent.truncate(RECENT_LIMIT);
        write_json(&self.vault_dir(vault_id).join("state.json"), &s)?;
        Ok(s.recent)
    }

    /// 文件被删除或改名后，从最近列表中移除或替换。
    pub fn rename_recent(&self, vault_id: &str, from: &str, to: Option<&str>) -> Result<()> {
        let mut s = self.vault_state(vault_id);
        if !s.recent.iter().any(|p| p == from) {
            return Ok(());
        }
        match to {
            Some(t) => s.recent.iter_mut().filter(|p| *p == from).for_each(|p| *p = t.to_string()),
            None => s.recent.retain(|p| p != from),
        }
        write_json(&self.vault_dir(vault_id).join("state.json"), &s)
    }

    fn draft_path(&self, vault_id: &str, path: &str) -> PathBuf {
        let name = &hash_bytes(path.as_bytes())[..24];
        self.vault_dir(vault_id).join("drafts").join(format!("{name}.json"))
    }

    pub fn write_draft(&self, vault_id: &str, path: &str, content: &str, base_hash: Option<&str>) -> Result<()> {
        let d = Draft {
            path: path.to_string(),
            content: content.to_string(),
            base_hash: base_hash.map(str::to_string),
            saved_at: now_ms(),
        };
        write_json(&self.draft_path(vault_id, path), &d)
    }

    pub fn clear_draft(&self, vault_id: &str, path: &str) -> Result<()> {
        match fs::remove_file(self.draft_path(vault_id, path)) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.into()),
            _ => Ok(()),
        }
    }

    pub fn list_drafts(&self, vault_id: &str) -> Vec<Draft> {
        let dir = self.vault_dir(vault_id).join("drafts");
        let Ok(rd) = fs::read_dir(dir) else { return vec![] };
        let mut out: Vec<Draft> = rd
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
            .filter_map(|e| fs::read(e.path()).ok())
            .filter_map(|b| serde_json::from_slice(&b).ok())
            .collect();
        out.sort_by_key(|d| std::cmp::Reverse(d.saved_at));
        out
    }

    /// 覆盖写入前备份原文件（Word 首次在应用内保存前）。保留每个文件最近 5 份。
    pub fn backup(&self, vault_id: &str, rel: &str, bytes: &[u8]) -> Result<PathBuf> {
        let dir = self.vault_dir(vault_id).join("backups").join(&hash_bytes(rel.as_bytes())[..16]);
        fs::create_dir_all(&dir)?;
        let name = rel.rsplit('/').next().unwrap_or(rel);
        let target = dir.join(format!("{}-{name}", now_ms()));
        write_atomic(&target, bytes, |_| {})?;
        let mut all: Vec<PathBuf> = fs::read_dir(&dir)?.filter_map(|e| e.ok()).map(|e| e.path()).collect();
        all.sort();
        while all.len() > 5 {
            let _ = fs::remove_file(all.remove(0));
        }
        Ok(target)
    }

    /// 全局 JSON 文件（与库无关的设置，例如 AI 工作台）
    pub fn read_global(&self, name: &str) -> Option<serde_json::Value> {
        let b = fs::read(self.dir.join(name)).ok()?;
        serde_json::from_slice(&b).ok()
    }

    pub fn write_global(&self, name: &str, value: &serde_json::Value) -> Result<()> {
        write_json(&self.dir.join(name), value)
    }

    /// 视图用的布局等数据：M3 使用。这里提供通用的按库 JSON 读写。
    pub fn read_vault_file(&self, vault_id: &str, name: &str) -> Option<serde_json::Value> {
        let b = fs::read(self.vault_dir(vault_id).join(name)).ok()?;
        serde_json::from_slice(&b).ok()
    }

    pub fn write_vault_file(&self, vault_id: &str, name: &str, value: &serde_json::Value) -> Result<()> {
        write_json(&self.vault_dir(vault_id).join(name), value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_recent_and_drafts() {
        let d = tempfile::tempdir().unwrap();
        let a = AppData::new(d.path());
        assert_eq!(a.config().last_vault, None);
        a.set_last_vault("/Users/me/库").unwrap();
        assert_eq!(a.config().last_vault.as_deref(), Some("/Users/me/库"));

        a.push_recent("v1", "a.md").unwrap();
        a.push_recent("v1", "b.md").unwrap();
        assert_eq!(a.push_recent("v1", "a.md").unwrap(), vec!["a.md", "b.md"]);
        a.rename_recent("v1", "b.md", Some("c.md")).unwrap();
        a.rename_recent("v1", "a.md", None).unwrap();
        assert_eq!(a.vault_state("v1").recent, vec!["c.md"]);
        assert!(a.vault_state("v2").recent.is_empty());

        a.write_draft("v1", "笔记/草稿.md", "未保存内容", Some("abc")).unwrap();
        a.write_draft("v1", "笔记/草稿.md", "更新的未保存内容", Some("abc")).unwrap();
        let drafts = a.list_drafts("v1");
        assert_eq!(drafts.len(), 1);
        assert_eq!(drafts[0].content, "更新的未保存内容");
        a.clear_draft("v1", "笔记/草稿.md").unwrap();
        a.clear_draft("v1", "笔记/草稿.md").unwrap();
        assert!(a.list_drafts("v1").is_empty());

        for i in 0..7 {
            a.backup("v1", "文档/报告.docx", format!("v{i}").as_bytes()).unwrap();
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
        let dir = d.path().join("vaults/v1/backups");
        let sub = fs::read_dir(&dir).unwrap().next().unwrap().unwrap().path();
        assert_eq!(fs::read_dir(sub).unwrap().count(), 5);
    }
}
