//! Document-relative, content-addressed attachments. No network access.
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};

use sha2::{Digest, Sha256};

const MAX_ATTACHMENT_BYTES: u64 = 32 * 1024 * 1024;

fn document_directory(document_path: &str) -> Result<PathBuf, String> {
    let document = Path::new(document_path);
    let parent = document
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    parent
        .canonicalize()
        .map_err(|error| format!("could not open document directory: {error}"))
}

fn relative_path(value: &str) -> Result<&Path, String> {
    if value.is_empty()
        || value.len() > 1024
        || value
            .chars()
            .any(|c| c.is_control() || "\\:%?#".contains(c))
        || value
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == ".." || part.trim() != part)
    {
        return Err("attachment path must be a normalized document-relative path".into());
    }
    let path = Path::new(value);
    if path
        .components()
        .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err("attachment path must stay inside the document directory".into());
    }
    Ok(path)
}

fn resolve_existing(document_path: &str, relative: &str) -> Result<PathBuf, String> {
    let root = document_directory(document_path)?;
    let path = root
        .join(relative_path(relative)?)
        .canonicalize()
        .map_err(|error| format!("could not read attachment {relative}: {error}"))?;
    if !path.starts_with(&root) || !path.is_file() {
        return Err("attachment must be a file inside the document directory".into());
    }
    Ok(path)
}

fn read_attachment_bytes(document_path: String, relative: String) -> Result<Vec<u8>, String> {
    let path = resolve_existing(&document_path, &relative)?;
    let size = fs::metadata(&path)
        .map_err(|error| error.to_string())?
        .len();
    if size > MAX_ATTACHMENT_BYTES {
        return Err("attachment exceeds the 32 MiB limit".into());
    }
    let mut bytes = Vec::new();
    fs::File::open(&path)
        .map_err(|error| error.to_string())?
        .take(MAX_ATTACHMENT_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("could not read attachment: {error}"))?;
    if bytes.len() as u64 > MAX_ATTACHMENT_BYTES {
        return Err("attachment exceeds the 32 MiB limit".into());
    }
    Ok(bytes)
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
    if target.exists() {
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
