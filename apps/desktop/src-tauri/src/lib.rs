// Tauri backend for the desktop client.
//
// Every command here is byte transport or OS integration: dialogs, reads,
// atomic writes, the recent-files list, and the file watch. Document
// structure lives in the TypeScript packages, so nothing in this crate
// parses or interprets JSONL.

mod close;
mod dialogs;
mod fs;
mod launch;
mod recent;
mod watch;

pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(target_os = "macos")]
    let builder = builder.menu(close::menu).on_menu_event(|app, event| {
        if event.id().as_ref() == "document-quit" {
            app.exit(0);
        }
    });
    builder
        .plugin(tauri_plugin_dialog::init())
        .manage(close::CloseState::default())
        .manage(recent::RecentState::default())
        .manage(watch::WatchState::default())
        .manage(launch::LaunchState::from_args(std::env::args()))
        .invoke_handler(tauri::generate_handler![
            close::enable_close_guard,
            close::finish_document_close,
            dialogs::pick_open_path,
            dialogs::pick_save_path,
            dialogs::pick_export_path,
            fs::autosave_document_path,
            fs::read_document,
            fs::write_document_atomic,
            fs::write_export_atomic,
            recent::recent_files_list,
            recent::recent_files_add,
            recent::recent_files_remove,
            watch::watch_document,
            watch::unwatch_document,
            launch::take_launch_paths,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build Tauri application")
        .run(|_app, _event| {
            close::intercept(_app, &_event);
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = _event {
                launch::request_open(
                    _app,
                    urls.into_iter()
                        .filter_map(|url| url.to_file_path().ok())
                        .collect(),
                );
            }
        });
}
