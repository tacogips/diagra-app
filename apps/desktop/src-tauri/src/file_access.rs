//! Persistent access only to files and folders chosen by the user.
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Mutex;

use objc2::rc::Retained;
use objc2_foundation::{
    NSData, NSString, NSURLBookmarkCreationOptions, NSURLBookmarkResolutionOptions, NSURL,
};
use tauri::{AppHandle, Manager};

struct Access(Retained<NSURL>);

impl Drop for Access {
    fn drop(&mut self) {
        // SAFETY: Each retained URL entered this map after a successful start.
        unsafe { self.0.stopAccessingSecurityScopedResource() };
    }
}

#[derive(Default)]
pub struct FileAccess(Mutex<BTreeMap<String, Access>>);

fn store_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("security-bookmarks.json"))
}

fn load(app: &AppHandle) -> BTreeMap<String, Vec<u8>> {
    store_path(app)
        .ok()
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

pub fn restore(app: &AppHandle) {
    let state = app.state::<FileAccess>();
    let Ok(mut active) = state.0.lock() else {
        return;
    };
    for (path, bytes) in load(app) {
        // SAFETY: We don't request a stale-result pointer. Foundation validates
        // the opaque bookmark and enforces its original sandbox grant.
        let resolved = unsafe {
            NSURL::URLByResolvingBookmarkData_options_relativeToURL_bookmarkDataIsStale_error(
                &NSData::with_bytes(&bytes),
                NSURLBookmarkResolutionOptions::WithSecurityScope
                    | NSURLBookmarkResolutionOptions::WithoutUI,
                None,
                std::ptr::null_mut(),
            )
        };
        if let Ok(url) = resolved {
            // SAFETY: This is a security-scoped URL returned by Foundation.
            if unsafe { url.startAccessingSecurityScopedResource() } {
                active.insert(path, Access(url));
            }
        }
    }
}

/// Called only after the document was opened/saved through a native user grant.
pub fn remember(app: &AppHandle, path: &str) -> Result<(), String> {
    let state = app.state::<FileAccess>();
    let _active = state.0.lock().map_err(|_| "file access lock poisoned")?;
    let url = NSURL::fileURLWithPath(&NSString::from_str(path));
    let bookmark = url
        .bookmarkDataWithOptions_includingResourceValuesForKeys_relativeToURL_error(
            NSURLBookmarkCreationOptions::WithSecurityScope,
            None,
            None,
        )
        .map_err(|e| format!("could not remember document access: {e}"))?;
    let mut bookmarks = load(app);
    bookmarks.insert(path.to_string(), bookmark.to_vec());
    let target = store_path(app)?;
    std::fs::create_dir_all(target.parent().ok_or("missing bookmark directory")?)
        .map_err(|e| e.to_string())?;
    crate::fs::write_bytes_atomic(
        &target,
        &serde_json::to_vec(&bookmarks).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(target, std::fs::Permissions::from_mode(0o600))
        .map_err(|e| e.to_string())
}
