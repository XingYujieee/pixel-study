//! AI 工作台的 Tauri 命令。设置保存在应用数据目录 ai.json，API 密钥保存在系统钥匙串，
//! 网络请求在 Rust 侧发出，密钥不会回到网页里。

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use ai_core::{stream_chat, AiConfig, AiEvent, ChatMessage};
use serde::Serialize;
use tauri::ipc::Channel;
use tauri::State;
use vault_core::VaultError;

use crate::commands::AppState;

const KEYCHAIN_SERVICE: &str = "app.pixelstudy.notes.ai";

#[derive(Default)]
pub struct AiState {
    running: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

fn err(msg: impl Into<String>) -> VaultError {
    VaultError::Io(std::io::Error::other(msg.into()))
}

fn load_config(state: &AppState) -> AiConfig {
    state.data.read_global("ai.json").and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default()
}

fn entry(cfg: &AiConfig) -> Result<keyring::Entry, VaultError> {
    keyring::Entry::new(KEYCHAIN_SERVICE, &cfg.key_account()).map_err(|e| err(format!("钥匙串不可用：{e}")))
}

fn read_key(cfg: &AiConfig) -> String {
    entry(cfg).ok().and_then(|e| e.get_password().ok()).unwrap_or_default()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfigView {
    config: AiConfig,
    has_key: bool,
}

#[tauri::command]
pub fn ai_config_get(state: State<'_, AppState>) -> Result<AiConfigView, VaultError> {
    let config = load_config(&state);
    let has_key = !read_key(&config).is_empty();
    Ok(AiConfigView { config, has_key })
}

#[tauri::command]
pub fn ai_config_set(state: State<'_, AppState>, config: AiConfig) -> Result<AiConfigView, VaultError> {
    state.data.write_global("ai.json", &serde_json::to_value(&config)?)?;
    let has_key = !read_key(&config).is_empty();
    Ok(AiConfigView { config, has_key })
}

/// 保存或删除当前服务商的密钥（`key` 为空表示删除）
#[tauri::command]
pub fn ai_key_set(state: State<'_, AppState>, key: Option<String>) -> Result<bool, VaultError> {
    let cfg = load_config(&state);
    let e = entry(&cfg)?;
    match key.map(|k| k.trim().to_string()).filter(|k| !k.is_empty()) {
        Some(k) => e.set_password(&k).map_err(|x| err(format!("保存到钥匙串失败：{x}")))?,
        None => match e.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(x) => return Err(err(format!("从钥匙串删除失败：{x}"))),
        },
    }
    Ok(!read_key(&cfg).is_empty())
}

/// 流式问答：事件通过 Channel 推送；用 `request_id` 可以取消
#[tauri::command]
pub async fn ai_chat(
    state: State<'_, AppState>,
    ai: State<'_, AiState>,
    request_id: String,
    messages: Vec<ChatMessage>,
    on_event: Channel<AiEvent>,
) -> Result<(), VaultError> {
    let cfg = load_config(&state);
    let key = read_key(&cfg);
    let cancel = Arc::new(AtomicBool::new(false));
    ai.running.lock().map_err(|_| err("状态锁失效"))?.insert(request_id.clone(), cancel.clone());
    stream_chat(&cfg, &key, &messages, &cancel, |ev| {
        let _ = on_event.send(ev);
    })
    .await;
    ai.running.lock().map_err(|_| err("状态锁失效"))?.remove(&request_id);
    Ok(())
}

/// 书房管家：带工具的一轮对话（不流式）。工具由网页执行，结果作为 tool 消息再传回来。
#[tauri::command]
pub async fn ai_agent(
    state: State<'_, AppState>,
    system: String,
    messages: Vec<ai_core::agent::AgentMessage>,
    tools: Vec<ai_core::agent::ToolSpec>,
) -> Result<ai_core::agent::AgentReply, String> {
    let cfg = load_config(&state);
    let key = read_key(&cfg);
    ai_core::agent::agent_turn(&cfg, &key, &system, &messages, &tools).await
}

#[tauri::command]
pub fn ai_cancel(ai: State<'_, AiState>, request_id: String) -> Result<(), VaultError> {
    if let Some(c) = ai.running.lock().map_err(|_| err("状态锁失效"))?.get(&request_id) {
        c.store(true, Ordering::Relaxed);
    }
    Ok(())
}

/// 天气跟随现实：按城市名查地点（Open-Meteo 地理编码）
#[tauri::command]
pub async fn weather_search(query: String) -> Result<Vec<ai_core::weather::Place>, String> {
    ai_core::weather::search_places(&query).await
}

/// 天气跟随现实：某地的当前天气
#[tauri::command]
pub async fn weather_now(lat: f64, lon: f64) -> Result<ai_core::weather::Now, String> {
    ai_core::weather::current(lat, lon).await
}
