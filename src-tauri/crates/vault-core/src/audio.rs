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
    /// 歌名（音频标签里的，没有时为空）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artist: Option<String>,
    /// 专辑：同一专辑的歌放进同一张唱片
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub album: Option<String>,
    /// 专辑里的曲序
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub track_no: Option<u32>,
    /// 唱片封面的随机种子（"换一张封面"时改变）
    #[serde(default)]
    pub cover: u32,
    /// 已经读过标签（老歌单第一次打开时补读一次）
    #[serde(default)]
    pub tagged: bool,
}

/// 修改唱片信息（整张专辑的几首歌一起改）
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TrackPatch {
    pub album: Option<String>,
    pub artist: Option<String>,
    pub title: Option<String>,
    pub cover: Option<u32>,
}

/// 从音频标签读歌名、歌手、专辑、曲序；读不到的字段为空。文件名形如「歌手 - 歌名」时也拆出来。
pub fn read_tags(path: &Path, stem: &str) -> (Option<String>, Option<String>, Option<String>, Option<u32>) {
    use lofty::prelude::*;
    let clean = |s: Option<std::borrow::Cow<'_, str>>| s.map(|v| v.trim().chars().take(80).collect::<String>()).filter(|v| !v.is_empty());
    let (mut title, mut artist, mut album, mut no) = (None, None, None, None);
    if let Ok(tagged) = lofty::read_from_path(path) {
        if let Some(tag) = tagged.primary_tag().or_else(|| tagged.first_tag()) {
            title = clean(tag.title());
            artist = clean(tag.artist());
            album = clean(tag.album());
            no = tag.track();
        }
    }
    // 文件名开头的曲序："03 歌名"、"03. 歌名"、"03 - 歌名"
    let digits: String = stem.chars().take_while(|c| c.is_ascii_digit()).collect();
    let mut stem = stem;
    // 只在后面跟着分隔符（"03."、"03 -"、"03_"）或以 0 开头（"03 歌名"）时才当曲序，"99 Luftballons" 不拆
    let after = &stem[digits.len()..];
    let sep = after.trim_start().starts_with(['.', '-', '_']);
    if !digits.is_empty() && digits.len() <= 3 && (sep || (digits.starts_with('0') && after.starts_with(' '))) {
        let rest = after.trim_start_matches([' ', '.', '-', '_']).trim();
        if !rest.is_empty() {
            no = no.or(digits.parse().ok());
            stem = rest;
        }
    }
    if title.is_none() && !stem.contains(" - ") {
        title = Some(stem.chars().take(80).collect());
    }
    if title.is_none() || artist.is_none() {
        if let Some((a, t)) = stem.split_once(" - ") {
            let (a, t) = (a.trim(), t.trim());
            if !a.is_empty() && !t.is_empty() {
                artist = artist.or_else(|| Some(a.chars().take(80).collect()));
                title = title.or_else(|| Some(t.chars().take(80).collect()));
            }
        }
    }
    (title, artist, album, no)
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
        // 老歌单：补读一次标签
        if v.iter().any(|t| !t.tagged) {
            for t in v.iter_mut().filter(|t| !t.tagged) {
                let (title, artist, album, no) = read_tags(&self.dir.join(&t.file), &t.name);
                t.title = t.title.take().or(title);
                t.artist = t.artist.take().or(artist);
                t.album = t.album.take().or(album);
                t.track_no = t.track_no.or(no);
                t.tagged = true;
            }
            let _ = self.save(&v);
        }
        v
    }

    /// 改唱片信息：专辑名、歌手、歌名、封面种子。空字符串表示清空。
    pub fn update(&self, ids: &[String], patch: &TrackPatch) -> Result<()> {
        let mut list = self.list();
        let norm = |s: &str| -> Option<String> {
            let t: String = s.trim().chars().take(80).collect();
            (!t.is_empty()).then_some(t)
        };
        let mut hit = false;
        for t in list.iter_mut().filter(|t| ids.contains(&t.id)) {
            hit = true;
            if let Some(a) = &patch.album {
                t.album = norm(a);
            }
            if let Some(a) = &patch.artist {
                t.artist = norm(a);
            }
            if let Some(a) = &patch.title {
                t.title = norm(a);
            }
            if let Some(c) = patch.cover {
                t.cover = c;
            }
        }
        if !hit {
            return Err(VaultError::NotFound(ids.join(",")));
        }
        self.save(&list)
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
        // 拖进来的是文件夹（一张专辑）：取里面的音频文件，按文件名排序；其他文件不报错
        // (文件, 所在专辑文件夹的名字)：没有专辑标签的歌用文件夹名当专辑
        let mut files: Vec<(PathBuf, Option<String>)> = vec![];
        for src in sources {
            if src.is_dir() {
                let folder = src.file_name().map(|n| n.to_string_lossy().trim().chars().take(80).collect::<String>()).filter(|n| !n.is_empty());
                let mut found: Vec<PathBuf> = walkdir::WalkDir::new(src)
                    .max_depth(3)
                    .into_iter()
                    .flatten()
                    .filter(|e| e.file_type().is_file() && !e.file_name().to_string_lossy().starts_with('.'))
                    .map(|e| e.into_path())
                    .filter(|p| p.extension().is_some_and(|x| AUDIO_EXTS.contains(&x.to_string_lossy().to_ascii_lowercase().as_str())))
                    .take(500)
                    .collect();
                found.sort();
                files.extend(found.into_iter().map(|f| (f, folder.clone())));
            } else {
                files.push((src.clone(), None));
            }
        }
        for (src, folder) in &files {
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
            let (title, artist, album, track_no) = read_tags(&self.dir.join(&file), &stem);
            let album = album.or_else(|| folder.clone());
            let t = Track { id, name: stem, file, size: meta.map(|m| m.len()).unwrap_or(0), title, artist, album, track_no, cover: 0, tagged: true };
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

    #[test]
    fn names_without_tags_and_album_updates() {
        let d = tempfile::tempdir().unwrap();
        let ext = d.path().join("外部");
        fs::create_dir_all(&ext).unwrap();
        fs::write(ext.join("陈绮贞 - 旅行的意义.mp3"), b"not really mp3").unwrap();
        fs::write(ext.join("雨声.mp3"), b"x").unwrap();
        let lib = AudioLibrary::new(d.path().join("audio"));
        lib.import(&[ext.join("陈绮贞 - 旅行的意义.mp3"), ext.join("雨声.mp3")]).unwrap();
        let l = lib.list();
        assert_eq!(l[0].artist.as_deref(), Some("陈绮贞"));
        assert_eq!(l[0].title.as_deref(), Some("旅行的意义"));
        assert_eq!(l[1].artist, None);
        assert_eq!(l[1].title.as_deref(), Some("雨声"));
        let ids: Vec<String> = l.iter().map(|t| t.id.clone()).collect();
        lib.update(&ids, &TrackPatch { album: Some(" 夏天 ".into()), cover: Some(7), ..Default::default() }).unwrap();
        assert!(lib.list().iter().all(|t| t.album.as_deref() == Some("夏天") && t.cover == 7));
        lib.update(&ids[..1], &TrackPatch { album: Some("".into()), ..Default::default() }).unwrap();
        assert_eq!(lib.list()[0].album, None);
        assert!(lib.update(&["nope".into()], &TrackPatch::default()).is_err());
    }

    #[test]
    fn importing_a_folder_takes_its_audio_files() {
        let d = tempfile::tempdir().unwrap();
        let album = d.path().join("专辑");
        fs::create_dir_all(album.join("CD2")).unwrap();
        fs::write(album.join("02 b.mp3"), b"x").unwrap();
        fs::write(album.join("01 a.mp3"), b"x").unwrap();
        fs::write(album.join("CD2/03 c.flac"), b"x").unwrap();
        fs::write(album.join("cover.jpg"), b"x").unwrap();
        let lib = AudioLibrary::new(d.path().join("audio"));
        let r = lib.import(&[album]).unwrap();
        assert_eq!(r.added.iter().map(|t| t.name.as_str()).collect::<Vec<_>>(), vec!["01 a", "02 b", "03 c"]);
        assert_eq!(r.added[1].title.as_deref(), Some("b"));
        assert_eq!(r.added[1].track_no, Some(2));
        assert!(r.added.iter().all(|t| t.album.as_deref() == Some("专辑")), "没有专辑标签时用文件夹名");
        assert_eq!(read_tags(Path::new("/nope"), "99 Luftballons").0.as_deref(), Some("99 Luftballons"));
        assert_eq!(read_tags(Path::new("/nope"), "7. 七里香").0.as_deref(), Some("七里香"));
        assert!(r.rejected.is_empty());
    }

    #[test]
    fn old_playlists_are_backfilled_once() {
        let d = tempfile::tempdir().unwrap();
        let dir = d.path().join("audio");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("a.mp3"), b"x").unwrap();
        fs::write(dir.join("playlist.json"), r#"[{"id":"a","name":"Beatles - Yesterday","file":"a.mp3","size":1}]"#).unwrap();
        let lib = AudioLibrary::new(&dir);
        let l = lib.list();
        assert!(l[0].tagged);
        assert_eq!(l[0].title.as_deref(), Some("Yesterday"));
        assert!(fs::read_to_string(dir.join("playlist.json")).unwrap().contains("\"tagged\": true"));
    }
}
