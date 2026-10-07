mod ai;
mod commands;

use commands::AppState;
use tauri::Manager;
use vault_core::appdata::AppData;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dir = commands::app_data_dir(app.handle());
            // 留声机的音频在应用数据目录里，允许网页通过 asset 协议播放
            let _ = std::fs::create_dir_all(dir.join("audio"));
            let _ = app.asset_protocol_scope().allow_directory(dir.join("audio"), false);
            app.manage(AppState::new(AppData::new(dir)));
            app.manage(ai::AiState::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::vault_open,
            commands::vault_current,
            commands::vault_scan,
            commands::note_read,
            commands::note_save,
            commands::note_create,
            commands::file_read_bytes,
            commands::file_save_bytes,
            commands::file_create,
            commands::layout_load,
            commands::layout_save,
            commands::search,
            commands::file_import,
            commands::open_external,
            commands::open_url,
            commands::reveal_in_finder,
            commands::draft_write,
            commands::draft_clear,
            commands::draft_list,
            commands::recent_list,
            commands::recent_push,
            commands::link_index,
            commands::file_move,
            commands::file_import_drop,
            commands::read_external_image,
            commands::finder_beside,
            commands::audio_list,
            commands::audio_import,
            commands::audio_remove,
            commands::audio_rename,
            commands::audio_path,
            commands::backlink_counts,
            commands::obsidian_templates_folder,
            commands::vault_json_load,
            commands::vault_json_save,
            ai::ai_config_get,
            ai::ai_config_set,
            ai::ai_key_set,
            ai::ai_agent,
            ai::ai_chat,
            ai::ai_cancel,
            ai::weather_search,
            ai::weather_now,
        ])
        .run(tauri::generate_context!())
        .expect("启动像素书房失败");
}
