//! Files referenced by portable document-relative attachment paths.
use std::{
    fs,
    io::{self, Read},
    path::{Component, Path, PathBuf},
};

pub const MAX_ATTACHMENT_BYTES: u64 = 32 * 1024 * 1024;

pub fn relative_path(value: &str) -> io::Result<&Path> {
    if value.is_empty()
        || value.len() > 1024
        || value
            .chars()
            .any(|c| c.is_control() || "\\:%?#".contains(c))
        || value.split('/').any(|part| {
            part.is_empty()
                || part == "."
                || part == ".."
                || part.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}') != part
        })
        || Path::new(value)
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Invalid document-relative attachment path.",
        ));
    }
    Ok(Path::new(value))
}

pub fn document_directory(document: impl AsRef<Path>) -> io::Result<PathBuf> {
    document
        .as_ref()
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."))
        .canonicalize()
}

pub fn read(document: impl AsRef<Path>, relative: &str) -> io::Result<Vec<u8>> {
    let relative = relative_path(relative)?;
    let root = document_directory(document)?;
    let path = root.join(relative).canonicalize()?;
    if !path.starts_with(&root) || !path.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Attachment must be a file inside the document directory.",
        ));
    }
    let file = fs::File::open(path)?;
    if file.metadata()?.len() > MAX_ATTACHMENT_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Attachment exceeds 32 MiB.",
        ));
    }
    let mut bytes = Vec::new();
    file.take(MAX_ATTACHMENT_BYTES + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_ATTACHMENT_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Attachment exceeds 32 MiB.",
        ));
    }
    Ok(bytes)
}
