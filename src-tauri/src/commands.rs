//! Tauri 命令：对 vault-core 的薄封装。前端只通过 `src/ipc/` 调用这里。
//! 路径一律为库内相对路径，由 vault-core 校验边界。

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;
use vault_core::appdata::{AppData, Draft};
use vault_core::import::{import_files, ImportOutcome};
use base64::Engine;
use vault_core::io::{BytesSaveOutcome, NoteContent, SaveOutcome};
use vault_core::scan::FileEntry;
use vault_core::search::{load_paths, SearchHit};
use vault_core::watch::{start_watch, WatchHandle};
use vault_core::{Vault, VaultError, VaultEvent, VaultSession};

type Res<T> = Result<T, VaultError>;

pub struct AppState {
    pub data: AppData,
    session: Mutex<Option<Arc<Mutex<VaultSession>>>>,
    watch: Mutex<Option<WatchHandle>>,
}

impl AppState {
    pub fn new(data: AppData) -> Self {
        Self { data, session: Mutex::new(None), watch: Mutex::new(None) }
    }

    fn session(&self) -> Res<Arc<Mutex<VaultSession>>> {
        self.session.lock().map_err(|_| VaultError::NoVault)?.clone().ok_or(VaultError::NoVault)
    }

    fn vault_id(&self) -> Res<String> {
        let s = self.session()?;
        let g = s.lock().map_err(|_| VaultError::NoVault)?;
        Ok(g.vault.id())
    }
}

fn lock(s: &Arc<Mutex<VaultSession>>) -> Res<std::sync::MutexGuard<'_, VaultSession>> {
    s.lock().map_err(|_| VaultError::Watch("状态锁失效，请重新打开笔记库".into()))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultInfo {
    pub id: String,
    pub name: String,
    pub root: String,
}

fn open_vault(app: &AppHandle, state: &AppState, path: &str) -> Res<VaultInfo> {
    let vault = Vault::open(path)?;
    let info = VaultInfo { id: vault.id(), name: vault.name(), root: vault.root().display().to_string() };

    // 停止旧库的监听
    *state.watch.lock().map_err(|_| VaultError::NoVault)? = None;

    // 让预览可以显示库内图片
    let _ = app.asset_protocol_scope().allow_directory(vault.root(), true);

    let session = Arc::new(Mutex::new(VaultSession::new(vault)));
    let emitter = app.clone();
    let data = state.data.clone();
    let vid = info.id.clone();
    let handle = start_watch(session.clone(), move |events: Vec<VaultEvent>| {
        for e in &events {
            match e {
                VaultEvent::Removed { path } => {
                    let _ = data.rename_recent(&vid, path, None);
                }
                VaultEvent::Renamed { from, entry } => {
                    let _ = data.rename_recent(&vid, from, Some(&entry.path));
                }
                _ => {}
            }
        }
        let _ = emitter.emit("vault://changed", events);
    })?;
    *state.session.lock().map_err(|_| VaultError::NoVault)? = Some(session);
    *state.watch.lock().map_err(|_| VaultError::NoVault)? = Some(handle);
    state.data.set_last_vault(&info.root)?;
    Ok(info)
}

#[tauri::command]
pub fn vault_open(app: AppHandle, state: State<'_, AppState>, path: String) -> Res<VaultInfo> {
    open_vault(&app, &state, &path)
}

/// 上次打开的库；不存在或已失效时返回 None。
#[tauri::command]
pub fn vault_current(app: AppHandle, state: State<'_, AppState>) -> Res<Option<VaultInfo>> {
    if let Ok(s) = state.session() {
        let g = lock(&s)?;
        let v = &g.vault;
        return Ok(Some(VaultInfo { id: v.id(), name: v.name(), root: v.root().display().to_string() }));
    }
    match state.data.config().last_vault {
        Some(p) => Ok(open_vault(&app, &state, &p).ok()),
        None => Ok(None),
    }
}

/// 扫描整个库，每 200 条通过 Channel 推送一批。完成后在后台预读正文供全文搜索。
#[tauri::command]
pub async fn vault_scan(state: State<'_, AppState>, on_batch: Channel<Vec<FileEntry>>) -> Res<usize> {
    let session = state.session()?;
    let s2 = session.clone();
    let total = tauri::async_runtime::spawn_blocking(move || -> Res<usize> {
        let mut g = lock(&s2)?;
        g.rescan(200, |b| {
            let _ = on_batch.send(b.to_vec());
        })
    })
    .await
    .map_err(|e| VaultError::Watch(e.to_string()))??;

    // 后台预读：读文件时不持锁，避免阻塞保存与监听
    std::thread::spawn(move || {
        let (vault, stale) = match session.lock() {
            Ok(g) => (g.vault.clone(), g.cache.stale_paths(&g.index)),
            Err(_) => return,
        };
        for chunk in stale.chunks(100) {
            let loaded = load_paths(&vault, chunk.to_vec());
            let Ok(mut g) = session.lock() else { return };
            for (p, m, s, t) in loaded {
                g.cache.put(p, m, s, t);
            }
        }
    });
    Ok(total)
}

#[tauri::command]
pub fn note_read(state: State<'_, AppState>, path: String) -> Res<NoteContent> {
    let s = state.session()?;
    let mut g = lock(&s)?;
    g.read(&path)
}

#[tauri::command]
pub fn note_save(state: State<'_, AppState>, path: String, content: String, base_hash: Option<String>) -> Res<SaveOutcome> {
    let s = state.session()?;
    let mut g = lock(&s)?;
    g.save(&path, &content, base_hash.as_deref())
}

/// 读取原始字节（Word）。以二进制响应返回，前端得到 ArrayBuffer；哈希放在响应头不方便，单独命令返回。
#[tauri::command]
pub fn file_read_bytes(state: State<'_, AppState>, path: String) -> Res<tauri::ipc::Response> {
    let s = state.session()?;
    let (bytes, hash) = lock(&s)?.read_bytes(&path)?;
    // 前 64 字节为 ASCII 哈希，其后为文件内容
    let mut out = hash.into_bytes();
    out.extend_from_slice(&bytes);
    Ok(tauri::ipc::Response::new(out))
}

fn decode_b64(data: &str) -> Res<Vec<u8>> {
    base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|e| VaultError::InvalidPath(format!("数据编码错误：{e}")))
}

/// 保存 Word。`backup` 为 true 时先把磁盘上的原文件备份到应用数据目录。
#[tauri::command]
pub fn file_save_bytes(
    state: State<'_, AppState>,
    path: String,
    data: String,
    base_hash: Option<String>,
    backup: bool,
) -> Res<BytesSaveOutcome> {
    let bytes = decode_b64(&data)?;
    let s = state.session()?;
    let mut g = lock(&s)?;
    if backup {
        if let Ok(abs) = g.vault.resolve(&path) {
            if let Ok(orig) = std::fs::read(abs) {
                state.data.backup(&g.vault.id(), &path, &orig)?;
            }
        }
    }
    g.save_bytes(&path, &bytes, base_hash.as_deref())
}

/// 新建文件：`ext` 为 md / txt / docx；Word 的初始内容由前端生成后以 base64 传入。
#[tauri::command]
pub fn file_create(
    state: State<'_, AppState>,
    dir: Option<String>,
    name: String,
    ext: String,
    data: Option<String>,
) -> Res<FileEntry> {
    let bytes = match data {
        Some(d) => decode_b64(&d)?,
        None => Vec::new(),
    };
    let s = state.session()?;
    let mut g = lock(&s)?;
    g.create_file(dir.as_deref(), &name, &ext, &bytes)
}

/// 书房布局（按库保存在应用数据目录，不写入笔记库）。
#[tauri::command]
pub fn layout_load(state: State<'_, AppState>) -> Res<Option<serde_json::Value>> {
    Ok(state.data.read_vault_file(&state.vault_id()?, "layout.json"))
}

#[tauri::command]
pub fn layout_save(state: State<'_, AppState>, layout: serde_json::Value) -> Res<()> {
    state.data.write_vault_file(&state.vault_id()?, "layout.json", &layout)
}

#[tauri::command]
pub fn note_create(state: State<'_, AppState>, dir: Option<String>, name: String) -> Res<FileEntry> {
    let s = state.session()?;
    let mut g = lock(&s)?;
    g.create(dir.as_deref(), &name, "")
}

#[tauri::command]
pub async fn search(state: State<'_, AppState>, query: String, limit: Option<usize>) -> Res<Vec<SearchHit>> {
    let s = state.session()?;
    tauri::async_runtime::spawn_blocking(move || -> Res<Vec<SearchHit>> {
        let mut g = lock(&s)?;
        Ok(g.search(&query, limit.unwrap_or(60)))
    })
    .await
    .map_err(|e| VaultError::Watch(e.to_string()))?
}

#[tauri::command]
pub async fn file_import(
    state: State<'_, AppState>,
    sources: Vec<String>,
    target_dir: String,
    keep_both: bool,
) -> Res<ImportOutcome> {
    let s = state.session()?;
    let vault = lock(&s)?.vault.clone();
    let sources: Vec<PathBuf> = sources.into_iter().map(PathBuf::from).collect();
    let out = tauri::async_runtime::spawn_blocking(move || import_files(&vault, &sources, &target_dir, keep_both))
        .await
        .map_err(|e| VaultError::Watch(e.to_string()))??;
    // 导入的文件由监听器登记索引并通知前端
    Ok(out)
}

#[tauri::command]
pub fn open_external(app: AppHandle, state: State<'_, AppState>, path: String) -> Res<()> {
    let s = state.session()?;
    let abs = lock(&s)?.vault.resolve(&path)?;
    if !abs.exists() {
        return Err(VaultError::NotFound(path));
    }
    app.opener()
        .open_path(abs.to_string_lossy(), None::<&str>)
        .map_err(|e| VaultError::Io(std::io::Error::other(e.to_string())))
}

/// 在系统浏览器中打开网址，只允许 http / https / mailto。
#[tauri::command]
pub fn open_url(app: AppHandle, url: String) -> Res<()> {
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("mailto:")) {
        return Err(VaultError::InvalidPath(url));
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| VaultError::Io(std::io::Error::other(e.to_string())))
}

#[tauri::command]
pub fn reveal_in_finder(app: AppHandle, state: State<'_, AppState>, path: String) -> Res<()> {
    let s = state.session()?;
    let abs = lock(&s)?.vault.resolve(&path)?;
    app.opener().reveal_item_in_dir(abs).map_err(|e| VaultError::Io(std::io::Error::other(e.to_string())))
}

#[tauri::command]
pub fn draft_write(state: State<'_, AppState>, path: String, content: String, base_hash: Option<String>) -> Res<()> {
    state.data.write_draft(&state.vault_id()?, &path, &content, base_hash.as_deref())
}

#[tauri::command]
pub fn draft_clear(state: State<'_, AppState>, path: String) -> Res<()> {
    state.data.clear_draft(&state.vault_id()?, &path)
}

#[tauri::command]
pub fn draft_list(state: State<'_, AppState>) -> Res<Vec<Draft>> {
    Ok(state.data.list_drafts(&state.vault_id()?))
}

#[tauri::command]
pub fn recent_list(state: State<'_, AppState>) -> Res<Vec<String>> {
    Ok(state.data.vault_state(&state.vault_id()?).recent)
}

#[tauri::command]
pub fn recent_push(state: State<'_, AppState>, path: String) -> Res<Vec<String>> {
    state.data.push_recent(&state.vault_id()?, &path)
}

/// 规范化文件名 → 路径列表（链接解析用，M4）。
#[tauri::command]
pub fn link_index(state: State<'_, AppState>) -> Res<std::collections::HashMap<String, Vec<String>>> {
    let s = state.session()?;
    let g = lock(&s)?;
    Ok(g.index.link_map())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveResult {
    pub from: String,
    /// 新的相对路径（包括 `.trash/…`，用于撤销）
    pub to: String,
    /// None：移到了隐藏目录（`.trash`），不再显示
    pub entry: Option<FileEntry>,
}

/// 移动文件到库内另一个目录（不覆盖，同名加序号）。灵感归档、放生到 `.trash/` 用。
#[tauri::command]
pub fn file_move(state: State<'_, AppState>, path: String, to_dir: String) -> Res<MoveResult> {
    let s = state.session()?;
    let mut g = lock(&s)?;
    let (to, entry) = g.move_file(&path, &to_dir)?;
    Ok(MoveResult { from: path, to, entry })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DropImport {
    pub entries: Vec<FileEntry>,
    pub in_vault: Vec<String>,
    pub renamed: usize,
    pub skipped: usize,
}

/// 拖放导入：文件或文件夹（保留子目录），同名自动保留两份，原文件不动；库里已有的文件不复制。
#[tauri::command]
pub async fn file_import_drop(state: State<'_, AppState>, sources: Vec<String>, target_dir: String) -> Res<DropImport> {
    let s = state.session()?;
    let sources: Vec<PathBuf> = sources.into_iter().map(PathBuf::from).collect();
    tauri::async_runtime::spawn_blocking(move || -> Res<DropImport> {
        let mut g = lock(&s)?;
        let (entries, r) = g.import_tree(&sources, &target_dir)?;
        Ok(DropImport { entries, in_vault: r.in_vault, renamed: r.renamed, skipped: r.skipped })
    })
    .await
    .map_err(|e| VaultError::Watch(e.to_string()))?
}

/// 读取从访达拖到窗户上的图片（只允许常见图片格式，最大 30 MB），用来做像素窗景。
#[tauri::command]
pub fn read_external_image(path: String) -> Res<tauri::ipc::Response> {
    let p = PathBuf::from(&path);
    let ext = p.extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
    if !matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "webp" | "gif" | "bmp" | "heic" | "heif" | "tif" | "tiff") {
        return Err(VaultError::InvalidPath(format!("不是图片：{path}")));
    }
    let meta = std::fs::metadata(&p).map_err(|_| VaultError::NotFound(path.clone()))?;
    if !meta.is_file() || meta.len() > 30 * 1024 * 1024 {
        return Err(VaultError::InvalidPath("图片太大（超过 30 MB）".into()));
    }
    Ok(tauri::ipc::Response::new(std::fs::read(&p)?))
}

/// 与访达并排：在访达里打开库文件夹，并（macOS 上）把访达窗口放到给定的屏幕区域。
/// 放窗口要用 AppleScript 控制访达，系统第一次会询问是否允许；不允许时只打开文件夹。
#[tauri::command]
pub fn finder_beside(app: AppHandle, state: State<'_, AppState>, left: i32, top: i32, right: i32, bottom: i32) -> Res<bool> {
    let s = state.session()?;
    let root = lock(&s)?.vault.root().to_path_buf();
    #[cfg(target_os = "macos")]
    {
        let script = r#"on run argv
  set p to POSIX file (item 1 of argv)
  tell application "Finder"
    open p
    set bounds of front window to {(item 2 of argv) as integer, (item 3 of argv) as integer, (item 4 of argv) as integer, (item 5 of argv) as integer}
  end tell
end run"#;
        let ok = std::process::Command::new("osascript")
            .arg("-e")
            .arg(script)
            .arg(root.as_os_str())
            .args([left.to_string(), top.to_string(), right.to_string(), bottom.to_string()])
            .status()
            .map(|st| st.success())
            .unwrap_or(false);
        if ok {
            return Ok(true);
        }
    }
    let _ = (left, top, right, bottom);
    app.opener()
        .open_path(root.to_string_lossy(), None::<&str>)
        .map_err(|e| VaultError::Io(std::io::Error::other(e.to_string())))?;
    Ok(false)
}

// ───────────── 留声机歌单（应用数据目录，不在笔记库里） ─────────────

fn audio_lib(app: &AppHandle) -> vault_core::audio::AudioLibrary {
    vault_core::audio::AudioLibrary::new(app_data_dir(app).join("audio"))
}

#[tauri::command]
pub fn audio_list(app: AppHandle) -> Vec<vault_core::audio::Track> {
    audio_lib(&app).list()
}

#[tauri::command]
pub async fn audio_import(app: AppHandle, sources: Vec<String>) -> Res<vault_core::audio::AudioImport> {
    let lib = audio_lib(&app);
    let sources: Vec<PathBuf> = sources.into_iter().map(PathBuf::from).collect();
    tauri::async_runtime::spawn_blocking(move || lib.import(&sources))
        .await
        .map_err(|e| VaultError::Watch(e.to_string()))?
}

#[tauri::command]
pub fn audio_remove(app: AppHandle, id: String) -> Res<()> {
    audio_lib(&app).remove(&id)
}

#[tauri::command]
pub fn audio_rename(app: AppHandle, id: String, name: String) -> Res<()> {
    audio_lib(&app).rename(&id, &name)
}

#[tauri::command]
pub fn audio_update(app: AppHandle, ids: Vec<String>, patch: vault_core::audio::TrackPatch) -> Res<()> {
    audio_lib(&app).update(&ids, &patch)
}

/// 播放用的绝对路径（前端转成 asset 地址）
#[tauri::command]
pub fn audio_path(app: AppHandle, id: String) -> Res<String> {
    audio_lib(&app).path_of(&id).map(|p| p.display().to_string()).ok_or(VaultError::NotFound(id))
}

/// 每个文件被多少篇其他笔记链接（书房里书脊发亮用）。
#[tauri::command]
pub async fn backlink_counts(state: State<'_, AppState>) -> Res<std::collections::HashMap<String, u32>> {
    let s = state.session()?;
    tauri::async_runtime::spawn_blocking(move || -> Res<_> { Ok(lock(&s)?.backlink_counts()) })
        .await
        .map_err(|e| VaultError::Watch(e.to_string()))?
}

/// Obsidian「模板」核心插件设置的模板文件夹（`.obsidian/templates.json`），没有设置时返回 None。
#[tauri::command]
pub fn obsidian_templates_folder(state: State<'_, AppState>) -> Res<Option<String>> {
    let s = state.session()?;
    let root = lock(&s)?.vault.root().to_path_buf();
    let Ok(text) = std::fs::read_to_string(root.join(".obsidian").join("templates.json")) else { return Ok(None) };
    let v: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
    Ok(v.get("folder").and_then(|f| f.as_str()).map(|f| f.trim_matches('/').to_string()).filter(|f| !f.is_empty()))
}

/// 按库保存的书房附加数据（打开记录、布局预设）。只允许固定的几个文件名。
const VAULT_JSON: &[&str] = &["meta.json", "presets.json"];

#[tauri::command]
pub fn vault_json_load(state: State<'_, AppState>, name: String) -> Res<Option<serde_json::Value>> {
    if !VAULT_JSON.contains(&name.as_str()) {
        return Err(VaultError::InvalidPath(name));
    }
    Ok(state.data.read_vault_file(&state.vault_id()?, &name))
}

#[tauri::command]
pub fn vault_json_save(state: State<'_, AppState>, name: String, value: serde_json::Value) -> Res<()> {
    if !VAULT_JSON.contains(&name.as_str()) {
        return Err(VaultError::InvalidPath(name));
    }
    state.data.write_vault_file(&state.vault_id()?, &name, &value)
}

pub fn app_data_dir(app: &AppHandle) -> PathBuf {
    app.path().app_data_dir().unwrap_or_else(|_| std::env::temp_dir().join("pixel-study"))
}
