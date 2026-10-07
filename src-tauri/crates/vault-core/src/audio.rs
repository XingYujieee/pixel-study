//! 留声机的歌单：用户导入的音频复制到应用数据目录（不放进笔记库，避免同步时库变大）。
//! 原文件只复制、不移动。

use crate::error::{Result, VaultError};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

/// 网页内核能直接播放的格式
pub const AUDIO_EXTS: &[&str] = &["mp3", "m4a", "aac", "wav", "aif", "aiff", "flac", "caf", "mp4"];
const MAX_BYTES: u64 = 300 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: String,
    /// 显示名（原文件名去掉扩展名）
    pub name: String,
    /// 应用数据目录里的文件名
    pub file: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct AudioImport {
    pub added: Vec<Track>,
    /// 不支持的格式或太大的文件（原文件名）
    pub rejected: Vec<String>,
}

pub struct AudioLibrary {
    dir: PathBuf,
}

static COUNTER: AtomicU64 = AtomicU64::new(0);

fn new_id() -> String {
    let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!("{:x}{:x}", t, COUNTER.fetch_add(1, Ordering::Relaxed))
}

impl AudioLibrary {
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        Self { dir: dir.into() }
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    fn list_path(&self) -> PathBuf {
        self.dir.join("playlist.json")
    }

    pub fn list(&self) -> Vec<Track> {
        let Ok(text) = fs::read_to_string(self.list_path()) else { return vec![] };
        let mut v: Vec<Track> = serde_json::from_str(&text).unwrap_or_default();
        // 文件被手动删掉的条目不显示
        v.retain(|t| self.dir.join(&t.file).is_file());
        v
    }

    fn save(&self, list: &[Track]) -> Result<()> {
        fs::create_dir_all(&self.dir)?;
        let tmp = self.dir.join(".playlist.json.tmp");
        fs::write(&tmp, serde_json::to_vec_pretty(list)?)?;
        fs::rename(tmp, self.list_path())?;
        Ok(())
    }

    /// 导入：支持的格式复制进来，其他的报告出来
    pub fn import(&self, sources: &[PathBuf]) -> Result<AudioImport> {
        fs::create_dir_all(&self.dir)?;
        let mut list = self.list();
        let mut out = AudioImport::default();
        for src in sources {
            let name = src.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            let ext = src.extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
            let meta = fs::metadata(src).ok();
            let ok = AUDIO_EXTS.contains(&ext.as_str()) && meta.as_ref().is_some_and(|m| m.is_file() && m.len() <= MAX_BYTES);
            if !ok {
                out.rejected.push(name);
                continue;
            }
            let id = new_id();
            let file = format!("{id}.{ext}");
            let tmp = self.dir.join(format!(".{file}.tmp"));
            fs::copy(src, &tmp)?;
            fs::rename(&tmp, self.dir.join(&file))?;
            let stem = src.file_stem().map(|n| n.to_string_lossy().into_owned()).unwrap_or(name);
            let t = Track { id, name: stem, file, size: meta.map(|m| m.len()).unwrap_or(0) };
            list.push(t.clone());
            out.added.push(t);
        }
        self.save(&list)?;
        Ok(out)
    }

    /// 移出歌单：删除应用数据目录里的副本（原文件不受影响）
    pub fn remove(&self, id: &str) -> Result<()> {
        let mut list = self.list();
        let Some(i) = list.iter().position(|t| t.id == id) else { return Err(VaultError::NotFound(id.to_string())) };
        let t = list.remove(i);
        let _ = fs::remove_file(self.dir.join(&t.file));
        self.save(&list)
    }

    pub fn rename(&self, id: &str, name: &str) -> Result<()> {
        let mut list = self.list();
        let t = list.iter_mut().find(|t| t.id == id).ok_or_else(|| VaultError::NotFound(id.to_string()))?;
        let n = name.trim();
        if !n.is_empty() {
            t.name = n.chars().take(80).collect();
        }
        self.save(&list)
    }

    /// 某首歌文件的绝对路径（播放用）
    pub fn path_of(&self, id: &str) -> Option<PathBuf> {
        self.list().into_iter().find(|t| t.id == id).map(|t| self.dir.join(t.file))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn import_list_rename_remove() {
        let d = tempfile::tempdir().unwrap();
        let ext = d.path().join("外部");
        fs::create_dir_all(&ext).unwrap();
        fs::write(ext.join("雨声.mp3"), b"ID3....").unwrap();
        fs::write(ext.join("钢琴.m4a"), b"....").unwrap();
        fs::write(ext.join("说明.txt"), b"x").unwrap();
        let lib = AudioLibrary::new(d.path().join("audio"));
        let r = lib.import(&[ext.join("雨声.mp3"), ext.join("钢琴.m4a"), ext.join("说明.txt"), ext.join("不存在.mp3")]).unwrap();
        assert_eq!(r.added.len(), 2);
        assert_eq!(r.rejected, vec!["说明.txt", "不存在.mp3"]);
        assert!(ext.join("雨声.mp3").exists(), "原文件不动");
        let list = lib.list();
        assert_eq!(list.iter().map(|t| t.name.as_str()).collect::<Vec<_>>(), vec!["雨声", "钢琴"]);
        assert!(lib.path_of(&list[0].id).unwrap().is_file());
        lib.rename(&list[1].id, "  睡前钢琴 ").unwrap();
        assert_eq!(lib.list()[1].name, "睡前钢琴");
        lib.remove(&list[0].id).unwrap();
        assert_eq!(lib.list().len(), 1);
        assert!(!lib.dir().join(&list[0].file).exists());
        assert!(lib.remove("nope").is_err());
        // 手动删掉文件的条目自动消失
        fs::remove_file(lib.dir().join(&lib.list()[0].file)).unwrap();
        assert!(lib.list().is_empty());
    }
}
