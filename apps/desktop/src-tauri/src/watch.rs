// External-change watching for the open document.
//
// The watch is on the parent directory, not the file: an atomic save
// replaces the file by rename, and a watch bound to the old inode would go
// deaf after the first save. Events are coalesced, because one save can
// produce several, and the frontend decides whether the new bytes actually
// differ from what it last wrote.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

/// How long a burst of filesystem events is folded into one notification.
pub const COALESCE_WINDOW: Duration = Duration::from_millis(300);

const CHANGED_EVENT: &str = "document-file-changed";
const MAIN_WINDOW: &str = "main";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChangedPayload {
    path: String,
}

/// The watcher plus the flag that retires its coalescing thread.
pub struct ActiveWatch {
    _watcher: RecommendedWatcher,
    stopped: Arc<AtomicBool>,
}

impl Drop for ActiveWatch {
    fn drop(&mut self) {
        // Events already in flight when a watch is replaced belong to the
        // previous document; the thread checks this before emitting.
        self.stopped.store(true, Ordering::Relaxed);
    }
}

/// At most one document is watched at a time — the app has one window and
/// one open document.
#[derive(Default)]
pub struct WatchState(Mutex<Option<ActiveWatch>>);

/// Does an event path refer to the watched document?
///
/// The comparison falls back to the file name because macOS reports
/// canonical paths (`/private/var/...`) for what the caller opened as
/// `/var/...`. That is safe here: the watch covers exactly one directory,
/// non-recursively, so a matching file name is the file.
pub fn path_matches(event_path: &Path, target: &Path, canonical_target: Option<&Path>) -> bool {
    if event_path == target {
        return true;
    }
    if canonical_target.is_some_and(|canonical| event_path == canonical) {
        return true;
    }
    match (event_path.file_name(), target.file_name()) {
        (Some(seen), Some(wanted)) => seen == wanted,
        _ => false,
    }
}

fn watched_directory(target: &Path) -> PathBuf {
    match target.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent.to_path_buf(),
        _ => PathBuf::from("."),
    }
}

#[tauri::command]
pub fn watch_document(
    app: AppHandle,
    state: State<'_, WatchState>,
    path: String,
) -> Result<(), String> {
    let target = PathBuf::from(&path);
    let directory = watched_directory(&target);
    let canonical_target = std::fs::canonicalize(&target).ok();

    let (sender, receiver) = mpsc::channel::<()>();
    let event_target = target.clone();
    let event_canonical = canonical_target.clone();
    let mut watcher = notify::recommended_watcher(move |result: notify::Result<Event>| {
        let Ok(event) = result else {
            return;
        };
        // Any event kind counts. Deciding what a rename, a truncate or a
        // metadata touch means is the frontend's job, and it has the bytes.
        if event
            .paths
            .iter()
            .any(|seen| path_matches(seen, &event_target, event_canonical.as_deref()))
        {
            let _ = sender.send(());
        }
    })
    .map_err(|error| format!("failed to create a watcher for {path}: {error}"))?;

    watcher
        .watch(&directory, RecursiveMode::NonRecursive)
        .map_err(|error| format!("failed to watch {}: {error}", directory.display()))?;

    let stopped = Arc::new(AtomicBool::new(false));
    let thread_stopped = Arc::clone(&stopped);
    let thread_app = app.clone();
    let thread_path = path.clone();
    thread::spawn(move || {
        // The sender lives in the watcher closure, so dropping the watcher
        // ends this loop.
        while receiver.recv().is_ok() {
            while receiver.recv_timeout(COALESCE_WINDOW).is_ok() {}
            if thread_stopped.load(Ordering::Relaxed) {
                break;
            }
            let _ = thread_app.emit_to(
                MAIN_WINDOW,
                CHANGED_EVENT,
                ChangedPayload {
                    path: thread_path.clone(),
                },
            );
        }
    });

    let mut active = state.0.lock().map_err(|_| "watch lock poisoned")?;
    // Assigning drops the previous watch, which stops its thread.
    *active = Some(ActiveWatch {
        _watcher: watcher,
        stopped,
    });
    Ok(())
}

#[tauri::command]
pub fn unwatch_document(state: State<'_, WatchState>) -> Result<(), String> {
    let mut active = state.0.lock().map_err(|_| "watch lock poisoned")?;
    *active = None;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_the_exact_path() {
        assert!(path_matches(
            Path::new("/tmp/diagra/a.jsonl"),
            Path::new("/tmp/diagra/a.jsonl"),
            None
        ));
    }

    #[test]
    fn matches_the_canonical_path() {
        assert!(path_matches(
            Path::new("/private/tmp/diagra/a.jsonl"),
            Path::new("/tmp/diagra/a.jsonl"),
            Some(Path::new("/private/tmp/diagra/a.jsonl"))
        ));
    }

    #[test]
    fn matches_the_file_name_within_the_watched_directory() {
        assert!(path_matches(
            Path::new("/private/tmp/diagra/a.jsonl"),
            Path::new("/tmp/diagra/a.jsonl"),
            None
        ));
    }

    #[test]
    fn ignores_a_sibling_file() {
        assert!(!path_matches(
            Path::new("/tmp/diagra/b.jsonl"),
            Path::new("/tmp/diagra/a.jsonl"),
            None
        ));
    }

    #[test]
    fn ignores_the_write_temp_file() {
        // Atomic writes land on `.a.jsonl.<nanos>-<n>.tmp` first; only the
        // rename onto the target should reach the frontend.
        assert!(!path_matches(
            Path::new("/tmp/diagra/.a.jsonl.17-0.tmp"),
            Path::new("/tmp/diagra/a.jsonl"),
            None
        ));
    }

    #[test]
    fn watched_directory_is_the_parent() {
        assert_eq!(
            watched_directory(Path::new("/tmp/diagra/a.jsonl")),
            PathBuf::from("/tmp/diagra")
        );
    }

    #[test]
    fn watched_directory_falls_back_to_the_working_directory() {
        assert_eq!(watched_directory(Path::new("a.jsonl")), PathBuf::from("."));
    }
}
