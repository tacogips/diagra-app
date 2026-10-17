//! Document-relative, content-addressed attachments. No network access.
use nodetto_native::attachments::MAX_ATTACHMENT_BYTES;
use std::fs;
use std::path::PathBuf;

use sha2::{Digest, Sha256};

fn document_directory(document_path: &str) -> Result<PathBuf, String> {
    nodetto_native::attachments::document_directory(document_path)
        .map_err(|error| format!("could not open document directory: {error}"))
}

fn read_attachment_bytes(document_path: String, relative: String) -> Result<Vec<u8>, String> {
    nodetto_native::attachments::read(document_path, &relative).map_err(|error| error.to_string())
}

fn store_attachment_bytes(
    document_path: String,
    extension: String,
    contents: Vec<u8>,
) -> Result<String, String> {
    let extension = extension.to_ascii_lowercase();
    if ![
        "png", "jpeg", "jpg", "webp", "gif", "html", "css", "woff", "woff2", "ttf",
    ]
    .contains(&extension.as_str())
    {
        return Err("unsupported attachment extension".into());
    }
    if contents.is_empty() || contents.len() as u64 > MAX_ATTACHMENT_BYTES {
        return Err("attachment must contain between 1 byte and 32 MiB".into());
    }
    let root = document_directory(&document_path)?;
    let directory = root.join("artifacts");
    fs::create_dir_all(&directory)
        .map_err(|error| format!("could not create artifacts directory: {error}"))?;
    let canonical = directory
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if !canonical.starts_with(&root) {
        return Err("artifacts directory must stay inside the document directory".into());
    }
    let digest = format!("{:x}", Sha256::digest(&contents));
    let name = format!("{digest}.{extension}");
    let target = canonical.join(&name);
    // Inspect the directory entry, including dangling symlinks. The directory
    // writer follows links, so treating a dangling target as absent could write
    // outside the document directory.
    let exists = match fs::symlink_metadata(&target) {
        Ok(_) => true,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
        Err(error) => return Err(error.to_string()),
    };
    if exists {
        let existing = target.canonicalize().map_err(|error| error.to_string())?;
        if !existing.starts_with(&root) || !existing.is_file() {
            return Err("existing attachment escapes the document directory".into());
        }
        if fs::metadata(&existing)
            .map_err(|error| error.to_string())?
            .len()
            != contents.len() as u64
            || fs::read(&existing).map_err(|error| error.to_string())? != contents
        {
            return Err(
                "existing content-addressed attachment has different bytes; original preserved"
                    .into(),
            );
        }
    } else {
        crate::fs::write_bytes_atomic(&target, &contents)
            .map_err(|error| format!("could not save attachment: {error}"))?;
    }
    Ok(format!("artifacts/{name}"))
}

#[tauri::command]
pub async fn read_attachment(
    app: tauri::AppHandle,
    document_path: String,
    relative: String,
) -> Result<Vec<u8>, String> {
    #[cfg(target_os = "macos")]
    crate::dialogs::allow_attachment_directory(&app, &document_directory(&document_path)?).await?;
    #[cfg(not(target_os = "macos"))]
    let _ = app;
    read_attachment_bytes(document_path, relative)
}

#[tauri::command]
pub async fn store_attachment(
    app: tauri::AppHandle,
    document_path: String,
    extension: String,
    contents: Vec<u8>,
) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    crate::dialogs::allow_attachment_directory(&app, &document_directory(&document_path)?).await?;
    #[cfg(not(target_os = "macos"))]
    let _ = app;
    store_attachment_bytes(document_path, extension, contents)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn attachments_are_relative_deduplicated_and_readable_before_the_document_exists() {
        let directory = tempdir().expect("tempdir");
        let document = directory
            .path()
            .join("design.jsonl")
            .to_string_lossy()
            .into_owned();
        let bytes = b"example attachment".to_vec();
        let first =
            store_attachment_bytes(document.clone(), "html".into(), bytes.clone()).expect("store");
        let second = store_attachment_bytes(document.clone(), "html".into(), bytes.clone())
            .expect("deduplicate");
        assert_eq!(first, second);
        assert!(first.starts_with("artifacts/"));
        assert_eq!(read_attachment_bytes(document, first).expect("read"), bytes);
    }

    #[test]
    fn invalid_paths_and_extensions_never_read_or_write_outside_the_directory() {
        let directory = tempdir().expect("tempdir");
        let document = directory
            .path()
            .join("design.jsonl")
            .to_string_lossy()
            .into_owned();
        for path in [
            "../outside.png",
            "/outside.png",
            "C:\\outside.png",
            "artifacts/%2e%2e/x.png",
            "./image.png",
            "https://example.com/a.png",
            "artifacts//x.png",
        ] {
            assert!(
                read_attachment_bytes(document.clone(), path.into()).is_err(),
                "{path}"
            );
        }
        assert!(store_attachment_bytes(document, "../html".into(), vec![1]).is_err());
    }

    #[test]
    fn an_edited_attachment_is_not_overwritten() {
        let directory = tempdir().expect("tempdir");
        let document = directory
            .path()
            .join("design.jsonl")
            .to_string_lossy()
            .into_owned();
        let name = store_attachment_bytes(document.clone(), "css".into(), b"body{}".to_vec())
            .expect("store");
        fs::write(directory.path().join(&name), b"edited").expect("edit");
        assert!(store_attachment_bytes(document, "css".into(), b"body{}".to_vec()).is_err());
        assert_eq!(
            fs::read(directory.path().join(name)).expect("read"),
            b"edited"
        );
    }

    #[cfg(unix)]
    #[test]
    fn dangling_attachment_symlinks_never_create_files_outside_the_document() {
        let directory = tempdir().expect("tempdir");
        let outside = tempdir().expect("outside");
        let document = directory
            .path()
            .join("design.jsonl")
            .to_string_lossy()
            .into_owned();
        let bytes = b"attachment".to_vec();
        let digest = format!("{:x}", Sha256::digest(&bytes));
        let artifacts = directory.path().join("artifacts");
        fs::create_dir(&artifacts).expect("artifacts");
        let target = artifacts.join(format!("{digest}.png"));
        let escaped = outside.path().join("image.png");
        std::os::unix::fs::symlink(&escaped, &target).expect("symlink");

        assert!(store_attachment_bytes(document, "png".into(), bytes).is_err());
        assert!(!escaped.exists());
        assert!(fs::symlink_metadata(target)
            .expect("link preserved")
            .file_type()
            .is_symlink());
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_cannot_escape_the_document_directory() {
        let directory = tempdir().expect("tempdir");
        let outside = tempdir().expect("outside");
        fs::write(outside.path().join("image.png"), b"private").expect("write");
        std::os::unix::fs::symlink(outside.path(), directory.path().join("artifacts"))
            .expect("symlink");
        let document = directory
            .path()
            .join("design.jsonl")
            .to_string_lossy()
            .into_owned();
        assert!(read_attachment_bytes(document.clone(), "artifacts/image.png".into()).is_err());
        assert!(store_attachment_bytes(document, "png".into(), vec![1]).is_err());
    }
}
