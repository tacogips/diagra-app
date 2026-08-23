// Byte transport for document files.
//
// Nothing in this module understands JSONL. The frontend owns parsing and
// serialization (`@diagra/io`); Rust only moves the exact bytes it is
// handed, so the file format can change without a Rust release.

use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

/// Distinguishes concurrent writes to the same target within one process.
static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

fn missing_file_name(path: &Path) -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidInput,
        format!("{} has no file name", path.display()),
    )
}

/// The temp file a write goes through: hidden, in the target's own
/// directory so the final rename stays on one filesystem and is atomic.
fn temp_sibling(path: &Path) -> io::Result<PathBuf> {
    let name = path.file_name().ok_or_else(|| missing_file_name(path))?;
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos())
        .unwrap_or(0);
    let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let temp_name = format!(".{}.{nanos}-{counter}.tmp", name.to_string_lossy());
    let directory = path.parent().unwrap_or_else(|| Path::new("."));
    Ok(directory.join(temp_name))
}

fn write_then_rename(temp: &Path, target: &Path, contents: &str) -> io::Result<()> {
    let mut file = File::create(temp)?;
    file.write_all(contents.as_bytes())?;
    // Durability before visibility: the rename must never publish a name
    // that points at a half-written file.
    file.sync_all()?;
    drop(file);
    fs::rename(temp, target)
}

/// Replace `path` with `contents` atomically: write a sibling temp file,
/// flush it to disk, then rename over the target. A reader either sees the
/// previous file or the complete new one, never a partial write.
pub fn write_atomic(path: &Path, contents: &str) -> io::Result<()> {
    let temp = temp_sibling(path)?;
    match write_then_rename(&temp, path, contents) {
        Ok(()) => Ok(()),
        Err(error) => {
            // Best effort: a failed write must not leave litter next to the
            // user's document, but the original error is what matters.
            let _ = fs::remove_file(&temp);
            Err(error)
        }
    }
}

#[tauri::command]
pub fn read_document(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|error| format!("failed to read {path}: {error}"))
}

#[tauri::command]
pub fn write_document_atomic(path: String, contents: String) -> Result<(), String> {
    write_atomic(Path::new(&path), &contents)
        .map_err(|error| format!("failed to write {path}: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn temp_siblings(directory: &Path) -> Vec<PathBuf> {
        fs::read_dir(directory)
            .expect("directory is readable")
            .filter_map(|entry| entry.ok().map(|entry| entry.path()))
            .filter(|path| path.extension().is_some_and(|extension| extension == "tmp"))
            .collect()
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

        assert_eq!(temp_siblings(directory.path()), Vec::<PathBuf>::new());
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
        assert_eq!(temp_siblings(directory.path()), Vec::<PathBuf>::new());
    }

    #[test]
    fn temp_sibling_lives_next_to_the_target() {
        let target = Path::new("/tmp/diagra/document.jsonl");

        let temp = temp_sibling(target).expect("target has a file name");

        assert_eq!(temp.parent(), target.parent());
        assert!(
            temp.file_name()
                .expect("temp has a file name")
                .to_string_lossy()
                .starts_with(".document.jsonl."),
            "unexpected temp name: {}",
            temp.display()
        );
    }

    #[test]
    fn temp_sibling_rejects_a_path_without_a_file_name() {
        assert!(temp_sibling(Path::new("/")).is_err());
    }

    #[test]
    fn read_document_reports_a_missing_file() {
        let directory = tempdir().expect("temp dir");
        let missing = directory.path().join("absent.jsonl");

        let error = read_document(missing.to_string_lossy().into_owned())
            .expect_err("reading a missing file fails");

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
