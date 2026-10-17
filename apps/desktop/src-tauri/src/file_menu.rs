use std::sync::Mutex;
#[cfg(target_os = "macos")]
use tauri::{Emitter, Manager};

#[derive(Default)]
pub struct FileMenuState(Mutex<Vec<String>>);

impl FileMenuState {
    #[cfg(any(target_os = "macos", test))]
    fn push(&self, action: &str) -> bool {
        if !matches!(
            action,
            "new" | "templates" | "open" | "save" | "save-as" | "export" | "reload"
        ) {
            return false;
        }
        self.0
            .lock()
            .map(|mut pending| pending.push(action.to_string()))
            .is_ok()
    }

    fn take(&self) -> Vec<String> {
        self.0
            .lock()
            .map(|mut pending| std::mem::take(&mut *pending))
            .unwrap_or_default()
    }
}

#[cfg(target_os = "macos")]
pub fn request(app: &tauri::AppHandle, action: &str) {
    if app.state::<FileMenuState>().push(action) {
        let _ = app.emit("file-menu-requested", ());
    }
}

#[tauri::command]
pub fn take_file_menu_actions(state: tauri::State<'_, FileMenuState>) -> Vec<String> {
    state.take()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn startup_commands_are_ordered_and_consumed_once() {
        let state = FileMenuState::default();
        assert!(state.push("open"));
        assert!(!state.push("unknown"));
        assert!(state.push("save-as"));
        assert!(state.push("reload"));
        assert!(state.push("templates"));
        assert_eq!(state.take(), vec!["open", "save-as", "reload", "templates"]);
        assert!(state.take().is_empty());
    }
}
