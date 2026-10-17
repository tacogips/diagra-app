// Byte transport for document files.
//
// Nothing in this module understands JSONL. The frontend owns parsing and
// serialization (`@nodetto/io`); Rust only moves the exact bytes it is
// handed, so the file format can change without a Rust release.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

/// Distinguishes concurrent writes to the same target within one process.
static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Persist document text using the platform's selected-file grant mechanism.
pub fn write_atomic(path: &Path, contents: &str) -> io::Result<()> {
    write_bytes_atomic(path, contents.as_bytes())
}

pub use nodetto_native::fs::write_selected_file_atomic as write_bytes_atomic;

/// Marks "this file is not there" in a read error, so the frontend can drop
/// a dead recent-files entry without also dropping one that merely lives on
/// a share that happens to be offline. The wording is a contract: it is
/// matched in `apps/desktop/src/file/session.ts`.
pub const MISSING_FILE_MESSAGE: &str = "file not found";

/// Allocate a managed document name without creating an empty file.
fn autosave_path(directory: &Path) -> io::Result<PathBuf> {
    fs::create_dir_all(directory)?;
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    Ok(directory.join(format!("Untitled-{nanos}-{counter}.jsonl")))
}

#[tauri::command]
pub fn autosave_document_path(app: tauri::AppHandle) -> Result<String, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("documents");
    autosave_path(&directory)
        .map(|path| path.to_string_lossy().into_owned())
        .map_err(|error| format!("could not allocate autosave path: {error}"))
}

#[tauri::command]
pub fn read_document(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|error| match error.kind() {
        io::ErrorKind::NotFound => format!("{MISSING_FILE_MESSAGE}: {path}"),
        _ => format!("failed to read {path}: {error}"),
    })
}

#[tauri::command]
pub fn write_document_atomic(path: String, contents: String) -> Result<(), String> {
    write_atomic(Path::new(&path), &contents)
        .map_err(|error| format!("failed to write {path}: {error}"))
}

#[tauri::command]
pub fn write_export_atomic(path: String, contents: Vec<u8>) -> Result<(), String> {
    write_bytes_atomic(Path::new(&path), &contents)
        .map_err(|error| format!("failed to write {path}: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn autosave_names_are_unique_and_do_not_create_empty_files() {
        let directory = tempdir().expect("temp dir");
        let documents = directory.path().join("documents");
        let first = autosave_path(&documents).expect("first path");
        let second = autosave_path(&documents).expect("second path");
        assert_ne!(first, second);
        assert_eq!(first.parent(), Some(documents.as_path()));
        assert_eq!(fs::read_dir(&documents).expect("directory").count(), 0);
        write_atomic(&first, "shape\n").expect("first actual save");
        assert_eq!(fs::read_to_string(first).expect("read"), "shape\n");
    }

    #[test]
    fn binary_exports_preserve_bytes_and_replace_atomically() {
        let directory = tempdir().expect("temp dir");
        let target = directory.path().join("diagram.pdf");
        write_atomic(&target, "old").expect("old file");
        let bytes = [0, 255, 128, 37, 80, 68, 70, 10];
        write_export_atomic(target.to_string_lossy().into_owned(), bytes.to_vec()).expect("export");
        assert_eq!(fs::read(&target).expect("read"), bytes);
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[test]
    fn creates_a_new_file() {
        let directory = tempdir().expect("temp dir");
        let target = directory.path().join("document.jsonl");

        write_atomic(&target, "one\ntwo\n").expect("write succeeds");

        assert_eq!(
            fs::read_to_string(&target).expect("read back"),
            "one\ntwo\n"
        );
    }

    #[test]
    fn replaces_existing_content() {
        let directory = tempdir().expect("temp dir");
        let target = directory.path().join("document.jsonl");
        fs::write(&target, "stale contents that are longer\n").expect("seed file");

        write_atomic(&target, "fresh\n").expect("write succeeds");

        assert_eq!(fs::read_to_string(&target).expect("read back"), "fresh\n");
    }

    #[test]
    fn leaves_no_temp_file_behind_on_success() {
        let directory = tempdir().expect("temp dir");
        let target = directory.path().join("document.jsonl");

        write_atomic(&target, "one\n").expect("first write");
        write_atomic(&target, "two\n").expect("second write");

        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[test]
    fn leaves_no_temp_file_behind_on_failure() {
        let directory = tempdir().expect("temp dir");
        let missing_parent = directory.path().join("nope");
        let target = missing_parent.join("document.jsonl");

        let result = write_atomic(&target, "one\n");

        assert!(
            result.is_err(),
            "writing into a missing directory must fail"
        );
        assert!(
            !missing_parent.exists(),
            "the write must not create the directory"
        );
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 0);
    }

    #[test]
    fn read_document_reports_a_missing_file() {
        let directory = tempdir().expect("temp dir");
        let missing = directory.path().join("absent.jsonl");

        let error = read_document(missing.to_string_lossy().into_owned())
            .expect_err("reading a missing file fails");

        // The frontend matches this wording to tell a dead recent-files
        // entry from a temporarily unreachable one.
        assert!(
            error.starts_with(MISSING_FILE_MESSAGE),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn read_document_reports_other_failures_differently() {
        let directory = tempdir().expect("temp dir");

        // A directory exists but is not readable as a document; that is not
        // a missing file and must not be reported as one.
        let error = read_document(directory.path().to_string_lossy().into_owned())
            .expect_err("reading a directory fails");

        assert!(
            !error.starts_with(MISSING_FILE_MESSAGE),
            "unexpected error: {error}"
        );
        assert!(
            error.contains("failed to read"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn commands_round_trip_text_verbatim() {
        let directory = tempdir().expect("temp dir");
        let target = directory.path().join("document.jsonl");
        let path = target.to_string_lossy().into_owned();
        // Trailing newline, unicode and an empty line: the transport must
        // not normalize any of it.
        let contents = "{\"kind\":\"document\"}\n\n{\"note\":\"ラベル\"}\n";

        write_document_atomic(path.clone(), contents.to_string()).expect("write succeeds");

        assert_eq!(read_document(path).expect("read succeeds"), contents);
    }
}
