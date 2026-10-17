//! Desktop container and lifetime adapter for shared security-scoped bookmarks.
use nodetto_native::bookmarks::{self, SecurityScope};
use std::{collections::BTreeMap, path::PathBuf, sync::Mutex};
use tauri::{AppHandle, Manager};

#[derive(Default)]
pub struct FileAccess(Mutex<BTreeMap<String, SecurityScope>>);

fn store_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("security-bookmarks.json"))
}

pub fn restore(app: &AppHandle) {
    let state = app.state::<FileAccess>();
    let Ok(mut active) = state.0.lock() else {
        return;
    };
    if let Ok(store) = store_path(app) {
        *active = bookmarks::restore(&store);
    }
}

/// Called only after the document was opened/saved through a native user grant.
pub fn remember(app: &AppHandle, path: &str) -> Result<(), String> {
    let state = app.state::<FileAccess>();
    let _active = state.0.lock().map_err(|_| "file access lock poisoned")?;
    bookmarks::remember_path(&store_path(app)?, path)
        .map_err(|error| format!("could not remember document access: {error}"))
}
