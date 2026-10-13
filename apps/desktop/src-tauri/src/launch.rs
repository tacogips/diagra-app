// Documents the OS asks the app to open.
//
// A path can arrive before the webview is listening: on the command line
// (`nodetto file.jsonl`) or, on macOS, as an open-documents event that
// launches the app (`open -a nodetto file.jsonl`, Finder "Open With"). Paths
// queue here until the frontend takes them; a request that arrives while the
// app runs also emits an event so the frontend takes it immediately.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, Runtime, State};

/// Emitted (without payload) when new paths are queued.
pub const OPEN_REQUESTED_EVENT: &str = "open-documents-requested";

#[derive(Default)]
pub struct LaunchState(Mutex<Vec<String>>);

impl LaunchState {
    /// Seed the queue from process arguments (the first is the executable).
    pub fn from_args(args: impl IntoIterator<Item = String>) -> Self {
        Self(Mutex::new(document_paths(
            args.into_iter().skip(1).map(PathBuf::from),
        )))
    }

    /// Queue `paths`; true when at least one usable path was added.
    pub fn push(&self, paths: impl IntoIterator<Item = PathBuf>) -> bool {
        let usable = document_paths(paths);
        if usable.is_empty() {
            return false;
        }
        match self.0.lock() {
            Ok(mut pending) => {
                pending.extend(usable);
                true
            }
            Err(_) => false,
        }
    }

    pub fn take(&self) -> Vec<String> {
        self.0
            .lock()
            .map(|mut pending| std::mem::take(&mut *pending))
            .unwrap_or_default()
    }
}

/// Keep existing regular files only, as absolute paths; flags such as
/// `-psn_...` that macOS may pass are not files and drop out here.
pub fn document_paths(paths: impl IntoIterator<Item = PathBuf>) -> Vec<String> {
    paths
        .into_iter()
        .filter(|path| !path.as_os_str().to_string_lossy().starts_with('-'))
        .filter(|path| path.is_file())
        .map(|path| absolute(&path).to_string_lossy().into_owned())
        .collect()
}

fn absolute(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

/// Queue paths from a running-app open request and notify the frontend.
pub fn request_open<R: Runtime>(app: &AppHandle<R>, paths: Vec<PathBuf>) {
    if app.state::<LaunchState>().push(paths) {
        let _ = app.emit(OPEN_REQUESTED_EVENT, ());
    }
}

#[tauri::command]
pub fn take_launch_paths(state: State<'_, LaunchState>) -> Vec<String> {
    state.take()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_existing_files_and_drops_flags_and_missing_paths() {
        let directory = tempfile::tempdir().unwrap();
        let document = directory.path().join("schema.jsonl");
        std::fs::write(&document, "").unwrap();
        let state = LaunchState::from_args([
            "nodetto".to_string(),
            "-psn_0_12345".to_string(),
            document.to_string_lossy().into_owned(),
            directory
                .path()
                .join("missing.jsonl")
                .to_string_lossy()
                .into_owned(),
            directory.path().to_string_lossy().into_owned(),
        ]);
        let taken = state.take();
        assert_eq!(taken.len(), 1);
        assert!(taken[0].ends_with("schema.jsonl"));
        assert!(Path::new(&taken[0]).is_absolute());
        assert!(state.take().is_empty());
    }

    #[test]
    fn push_reports_whether_anything_was_queued() {
        let directory = tempfile::tempdir().unwrap();
        let document = directory.path().join("a.jsonl");
        std::fs::write(&document, "").unwrap();
        let state = LaunchState::default();
        assert!(!state.push([directory.path().join("nope.jsonl")]));
        assert!(state.push([document]));
        assert_eq!(state.take().len(), 1);
    }
}
