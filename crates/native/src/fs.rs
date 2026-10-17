use std::{
    fs,
    io::{self, Write},
    path::Path,
};

/// A sibling temp file, fsync and rename preserve a user's file on failure.
/// Resolve links (including dangling links) without replacing the links.
pub fn write_atomic(path: impl AsRef<Path>, bytes: &[u8]) -> io::Result<()> {
    write_with_permissions(path.as_ref(), bytes, None)
}

pub(crate) fn write_with_permissions(
    original: &Path,
    bytes: &[u8],
    permissions: Option<fs::Permissions>,
) -> io::Result<()> {
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
    if let Some(permissions) =
        permissions.or_else(|| fs::metadata(&target).ok().map(|m| m.permissions()))
    {
        temporary.as_file().set_permissions(permissions)?;
    }
    temporary.write_all(bytes)?;
    temporary.as_file().sync_all()?;
    temporary.persist(&target).map_err(|error| error.error)?;
    if let Ok(directory) = fs::File::open(parent) {
        let _ = directory.sync_all();
    }
    Ok(())
}

// Foundation's atomic writer uses the system's replacement-file mechanism.
// A sandbox grant for an individual document does not permit us to create
// an arbitrary sibling in its parent directory.
#[cfg(target_os = "macos")]
pub fn write_selected_file_atomic(path: impl AsRef<Path>, contents: &[u8]) -> io::Result<()> {
    use objc2_foundation::{NSData, NSDataWritingOptions, NSString, NSURL};

    let path = path.as_ref().to_str().ok_or_else(|| {
        io::Error::new(io::ErrorKind::InvalidInput, "file path is not valid UTF-8")
    })?;
    let url = NSURL::fileURLWithPath(&NSString::from_str(path));
    NSData::with_bytes(contents)
        .writeToURL_options_error(&url, NSDataWritingOptions::Atomic)
        .map_err(|error| io::Error::other(error.to_string()))
}

#[cfg(not(target_os = "macos"))]
pub use write_atomic as write_selected_file_atomic;
