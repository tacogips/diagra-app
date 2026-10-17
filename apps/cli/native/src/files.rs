use std::{
    fs,
    io::{self, Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

/// A sibling temp file, fsync and rename preserve a user's file on failure.
/// Resolve links (including dangling links) without replacing the links.
pub fn write_atomic(path: &str, bytes: &[u8]) -> io::Result<()> {
    let original = Path::new(path);
    let mut target = original.to_path_buf();
    let mut resolved = false;
    for _ in 0..40 {
        match fs::symlink_metadata(&target) {
            Ok(meta) if meta.file_type().is_symlink() => {
                let link = fs::read_link(&target)?;
                target = target.parent().unwrap_or(Path::new(".")).join(link);
            }
            _ => {
                resolved = true;
                break;
            }
        }
    }
    if !resolved {
        return Err(io::Error::other("Too many symbolic links"));
    }
    let parent = target
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let mut builder = tempfile::Builder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        builder.permissions(fs::Permissions::from_mode(0o666));
    }
    let mut temporary = builder.tempfile_in(parent)?;
    if let Ok(metadata) = fs::metadata(&target) {
        temporary
            .as_file()
            .set_permissions(metadata.permissions())?;
    }
    temporary.write_all(bytes)?;
    temporary.as_file().sync_all()?;
    temporary.persist(&target).map_err(|error| error.error)?;
    if let Ok(directory) = fs::File::open(parent) {
        let _ = directory.sync_all();
    }
    Ok(())
}

pub fn attachment(document: &str, relative: &str) -> io::Result<Vec<u8>> {
    if relative.is_empty()
        || relative.len() > 1024
        || relative
            .chars()
            .any(|c| c.is_control() || "\\:%?#".contains(c))
        || relative
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == ".." || part.trim() != part)
    {
        return Err(io::Error::other(
            "Invalid document-relative attachment path.",
        ));
    }
    let folder = Path::new(document)
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."))
        .canonicalize()?;
    let file = folder.join(relative).canonicalize()?;
    if file == folder || !file.starts_with(&folder) {
        return Err(io::Error::other(
            "Attachment escapes the document directory.",
        ));
    }
    let mut bytes = Vec::new();
    fs::File::open(file)?
        .take(32 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() > 32 * 1024 * 1024 {
        return Err(io::Error::other("Attachment exceeds 32 MiB."));
    }
    Ok(bytes)
}

pub fn open_document(path: &str, app: Option<String>) -> io::Result<()> {
    if !fs::metadata(path)?.is_file() {
        return Err(io::Error::other("The path must be a regular file."));
    }
    let absolute = std::path::absolute(PathBuf::from(path))?;
    #[cfg(target_os = "macos")]
    {
        let status = Command::new("/usr/bin/open")
            .args(["-a", app.as_deref().unwrap_or("nodetto"), "--"])
            .arg(absolute)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()?;
        if !status.success() {
            return Err(io::Error::other(format!(
                "macOS could not open the app (exit {}). Use --app to specify its name or path.",
                status.code().unwrap_or(-1)
            )));
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        Command::new(app.unwrap_or_else(|| {
            if cfg!(windows) {
                "nodetto.exe"
            } else {
                "nodetto"
            }
            .into()
        }))
        .arg(absolute)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn atomic_writes_and_attachment_confinement() {
        let folder = tempfile::tempdir().unwrap();
        let file = folder.path().join("doc.jsonl");
        write_atomic(file.to_str().unwrap(), b"before").unwrap();
        write_atomic(file.to_str().unwrap(), b"after").unwrap();
        assert_eq!(fs::read(&file).unwrap(), b"after");
        assert!(attachment(file.to_str().unwrap(), "../outside.png").is_err());
        assert!(attachment(file.to_str().unwrap(), "/etc/passwd").is_err());
        #[cfg(unix)]
        {
            use std::os::unix::fs::{symlink, PermissionsExt};
            fs::set_permissions(&file, fs::Permissions::from_mode(0o640)).unwrap();
            let link = folder.path().join("link");
            symlink(&file, &link).unwrap();
            write_atomic(link.to_str().unwrap(), b"linked").unwrap();
            assert!(fs::symlink_metadata(link).unwrap().file_type().is_symlink());
            assert_eq!(
                fs::metadata(&file).unwrap().permissions().mode() & 0o777,
                0o640
            );
            let dangling = folder.path().join("dangling");
            symlink("new.jsonl", &dangling).unwrap();
            write_atomic(dangling.to_str().unwrap(), b"new").unwrap();
            assert_eq!(fs::read(folder.path().join("new.jsonl")).unwrap(), b"new");
        }
    }
}
