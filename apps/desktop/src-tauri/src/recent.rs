// The recent-files list.
//
// It outlives any one window, so it is owned by Rust and stored as JSON in
// the app config directory. Entries are paths and timestamps only: nothing
// here reads the documents they point at.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

/// How many entries the list keeps. Older ones fall off the end.
pub const RECENT_LIMIT: usize = 10;

const STORE_FILE: &str = "recent-files.json";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentEntry {
    pub path: String,
    pub opened_at_ms: u64,
}

/// Serializes the read-modify-write cycle of the store file.
#[derive(Default)]
pub struct RecentState(Mutex<()>);

fn store_path(directory: &Path) -> PathBuf {
    directory.join(STORE_FILE)
}

/// Read the stored list. A missing or unreadable store is an empty list:
/// recent files are a convenience, never a reason to fail an operation.
pub fn load(directory: &Path) -> Vec<RecentEntry> {
    let Ok(text) = fs::read_to_string(store_path(directory)) else {
        return Vec::new();
    };
    serde_json::from_str(&text).unwrap_or_default()
}

pub fn save(directory: &Path, entries: &[RecentEntry]) -> Result<(), String> {
    fs::create_dir_all(directory)
        .map_err(|error| format!("failed to create {}: {error}", directory.display()))?;
    let text = serde_json::to_string_pretty(entries)
        .map_err(|error| format!("failed to encode the recent files list: {error}"))?;
    crate::fs::write_atomic(&store_path(directory), &text)
        .map_err(|error| format!("failed to write the recent files list: {error}"))
}

/// Put `path` at the front, dropping any earlier entry for it so reopening
/// a file moves it up instead of duplicating it.
pub fn add(entries: Vec<RecentEntry>, path: &str, now_ms: u64) -> Vec<RecentEntry> {
    let mut next = vec![RecentEntry {
        path: path.to_string(),
        opened_at_ms: now_ms,
    }];
    next.extend(entries.into_iter().filter(|entry| entry.path != path));
    next.truncate(RECENT_LIMIT);
    next
}

pub fn remove(entries: Vec<RecentEntry>, path: &str) -> Vec<RecentEntry> {
    entries
        .into_iter()
        .filter(|entry| entry.path != path)
        .collect()
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

fn config_directory(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map_err(|error| format!("failed to resolve the app config directory: {error}"))
}

#[tauri::command]
pub fn recent_files_list(
    app: AppHandle,
    state: State<'_, RecentState>,
) -> Result<Vec<RecentEntry>, String> {
    let _guard = state.0.lock().map_err(|_| "recent files lock poisoned")?;
    Ok(load(&config_directory(&app)?))
}

#[tauri::command]
pub fn recent_files_add(
    app: AppHandle,
    state: State<'_, RecentState>,
    path: String,
) -> Result<Vec<RecentEntry>, String> {
    let _guard = state.0.lock().map_err(|_| "recent files lock poisoned")?;
    let directory = config_directory(&app)?;
    let entries = add(load(&directory), &path, now_ms());
    save(&directory, &entries)?;
    Ok(entries)
}

#[tauri::command]
pub fn recent_files_remove(
    app: AppHandle,
    state: State<'_, RecentState>,
    path: String,
) -> Result<Vec<RecentEntry>, String> {
    let _guard = state.0.lock().map_err(|_| "recent files lock poisoned")?;
    let directory = config_directory(&app)?;
    let entries = remove(load(&directory), &path);
    save(&directory, &entries)?;
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn entry(path: &str, opened_at_ms: u64) -> RecentEntry {
        RecentEntry {
            path: path.to_string(),
            opened_at_ms,
        }
    }

    fn paths(entries: &[RecentEntry]) -> Vec<&str> {
        entries.iter().map(|entry| entry.path.as_str()).collect()
    }

    #[test]
    fn add_puts_the_newest_entry_first() {
        let entries = add(vec![entry("/a.jsonl", 1)], "/b.jsonl", 2);

        assert_eq!(paths(&entries), vec!["/b.jsonl", "/a.jsonl"]);
        assert_eq!(entries[0].opened_at_ms, 2);
    }

    #[test]
    fn add_deduplicates_by_path() {
        let entries = add(
            vec![entry("/a.jsonl", 1), entry("/b.jsonl", 2)],
            "/a.jsonl",
            3,
        );

        assert_eq!(paths(&entries), vec!["/a.jsonl", "/b.jsonl"]);
        assert_eq!(entries[0].opened_at_ms, 3);
    }

    #[test]
    fn add_caps_the_list() {
        let mut entries = Vec::new();
        for index in 0..(RECENT_LIMIT + 5) {
            entries = add(entries, &format!("/{index}.jsonl"), index as u64);
        }

        assert_eq!(entries.len(), RECENT_LIMIT);
        assert_eq!(entries[0].path, format!("/{}.jsonl", RECENT_LIMIT + 4));
    }

    #[test]
    fn remove_drops_only_the_named_path() {
        let entries = remove(vec![entry("/a.jsonl", 1), entry("/b.jsonl", 2)], "/a.jsonl");

        assert_eq!(paths(&entries), vec!["/b.jsonl"]);
    }

    #[test]
    fn save_and_load_round_trip() {
        let directory = tempdir().expect("temp dir");
        let entries = vec![entry("/a.jsonl", 1), entry("/b.jsonl", 2)];

        save(directory.path(), &entries).expect("save succeeds");

        assert_eq!(load(directory.path()), entries);
    }

    #[test]
    fn save_creates_a_missing_directory() {
        let directory = tempdir().expect("temp dir");
        let nested = directory.path().join("config").join("diagra");

        save(&nested, &[entry("/a.jsonl", 1)]).expect("save succeeds");

        assert_eq!(paths(&load(&nested)), vec!["/a.jsonl"]);
    }

    #[test]
    fn load_of_a_missing_store_is_empty() {
        let directory = tempdir().expect("temp dir");

        assert_eq!(load(directory.path()), Vec::new());
    }

    #[test]
    fn load_of_a_corrupt_store_is_empty() {
        let directory = tempdir().expect("temp dir");
        fs::write(store_path(directory.path()), "{not json").expect("seed store");

        assert_eq!(load(directory.path()), Vec::new());
    }

    #[test]
    fn stored_json_uses_camel_case_keys() {
        let directory = tempdir().expect("temp dir");
        save(directory.path(), &[entry("/a.jsonl", 7)]).expect("save succeeds");

        let text = fs::read_to_string(store_path(directory.path())).expect("read store");

        assert!(
            text.contains("\"openedAtMs\""),
            "unexpected store text: {text}"
        );
    }
}
