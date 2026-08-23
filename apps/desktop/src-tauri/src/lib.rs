// Tauri backend for the desktop client.
//
// Every command here is byte transport or OS integration: dialogs, reads,
// atomic writes, the recent-files list, and the file watch. Document
// structure lives in the TypeScript packages, so nothing in this crate
// parses or interprets JSONL.

mod dialogs;
mod fs;
mod recent;
mod watch;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(recent::RecentState::default())
        .manage(watch::WatchState::default())
        .invoke_handler(tauri::generate_handler![
            dialogs::pick_open_path,
            dialogs::pick_save_path,
            fs::read_document,
            fs::write_document_atomic,
            recent::recent_files_list,
            recent::recent_files_add,
            recent::recent_files_remove,
            watch::watch_document,
            watch::unwatch_document,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Tauri application");
}
