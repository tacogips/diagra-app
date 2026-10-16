// Native close/quit must wait for the frontend's pending document write.
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager};

#[derive(Default)]
pub struct CloseState {
    enabled: AtomicBool,
    allowed: AtomicBool,
}

#[tauri::command]
pub fn enable_close_guard(state: tauri::State<'_, CloseState>) {
    state.enabled.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub fn finish_document_close(app: tauri::AppHandle, state: tauri::State<'_, CloseState>) {
    state.allowed.store(true, Ordering::SeqCst);
    app.exit(0);
}

pub fn intercept(app: &tauri::AppHandle, event: &tauri::RunEvent) {
    let state = app.state::<CloseState>();
    if !state.enabled.load(Ordering::SeqCst) || state.allowed.load(Ordering::SeqCst) {
        return;
    }
    match event {
        tauri::RunEvent::WindowEvent {
            event: tauri::WindowEvent::CloseRequested { api, .. },
            ..
        } => api.prevent_close(),
        tauri::RunEvent::ExitRequested { api, .. } => api.prevent_exit(),
        _ => return,
    }
    let _ = app.emit("document-close-requested", ());
}

// macOS's predefined Quit item calls NSApplication.terminate directly,
// bypassing Tauri's preventable ExitRequested event.
#[cfg(target_os = "macos")]
pub fn menu(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{Menu, MenuItem, MenuItemKind};
    let menu = Menu::default(app)?;
    if let Some(MenuItemKind::Submenu(application)) = menu.items()?.first() {
        // The default application menu ends with its predefined Quit item.
        let position = application.items()?.len().saturating_sub(1);
        application.remove_at(position)?;
        application.insert(
            &MenuItem::with_id(
                app,
                "document-quit",
                "Quit Nodetto",
                true,
                Some("CmdOrCtrl+Q"),
            )?,
            position,
        )?;
    }
    Ok(menu)
}
