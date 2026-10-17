//! Security-scoped bookmark mechanics; callers supply their own container store.
use objc2::rc::Retained;
use objc2_foundation::{
    NSData, NSString, NSURLBookmarkCreationOptions, NSURLBookmarkResolutionOptions, NSURL,
};
use std::{collections::BTreeMap, fs, path::Path};

type Bookmarks = BTreeMap<String, Vec<u8>>;

pub struct SecurityScope(Retained<NSURL>);
impl Drop for SecurityScope {
    fn drop(&mut self) {
        // SAFETY: Constructed only after successful startAccessing below.
        unsafe { self.0.stopAccessingSecurityScopedResource() };
    }
}

fn load(store: &Path) -> Bookmarks {
    fs::read(store)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn save(store: &Path, bookmarks: &Bookmarks) -> Result<(), String> {
    let parent = store.parent().ok_or("Missing bookmark directory")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    use std::os::unix::fs::PermissionsExt;
    crate::fs::write_with_permissions(
        store,
        &serde_json::to_vec(bookmarks).map_err(|e| e.to_string())?,
        Some(fs::Permissions::from_mode(0o600)),
    )
    .map_err(|e| e.to_string())
}

pub fn restore(store: &Path) -> BTreeMap<String, SecurityScope> {
    load(store)
        .into_iter()
        .filter_map(|(path, bytes)| {
            // SAFETY: Foundation validates the opaque bookmark. No stale-result pointer
            // is supplied and WithoutUI prevents authorization prompts during restore.
            let url = unsafe {
                NSURL::URLByResolvingBookmarkData_options_relativeToURL_bookmarkDataIsStale_error(
                    &NSData::with_bytes(&bytes),
                    NSURLBookmarkResolutionOptions::WithSecurityScope
                        | NSURLBookmarkResolutionOptions::WithoutUI,
                    None,
                    std::ptr::null_mut(),
                )
            }
            .ok()?;
            // SAFETY: URL came from Foundation's security-scoped bookmark resolver.
            if unsafe { url.startAccessingSecurityScopedResource() } {
                Some((path, SecurityScope(url)))
            } else {
                None
            }
        })
        .collect()
}

pub fn remember_url(store: &Path, url: &NSURL) -> Result<String, String> {
    let path = url
        .path()
        .ok_or("Selected URL has no filesystem path")?
        .to_string();
    let data = url
        .bookmarkDataWithOptions_includingResourceValuesForKeys_relativeToURL_error(
            NSURLBookmarkCreationOptions::WithSecurityScope,
            None,
            None,
        )
        .map_err(|e| e.to_string())?;
    let mut bookmarks = load(store);
    bookmarks.insert(path.clone(), data.to_vec());
    save(store, &bookmarks)?;
    Ok(path)
}

pub fn remember_path(store: &Path, path: &str) -> Result<(), String> {
    remember_url(store, &NSURL::fileURLWithPath(&NSString::from_str(path))).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn opaque_bookmarks_round_trip_with_private_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let store = dir.path().join("security-bookmarks.json");
        fs::write(&store, b"{}").unwrap();
        fs::set_permissions(&store, fs::Permissions::from_mode(0o644)).unwrap();
        let bookmarks = Bookmarks::from([("/project".into(), vec![0, 128, 255])]);
        save(&store, &bookmarks).unwrap();
        assert_eq!(load(&store), bookmarks);
        assert_eq!(
            fs::metadata(&store).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }
    #[test]
    fn missing_or_corrupt_stores_restore_no_permissions() {
        let dir = tempfile::tempdir().unwrap();
        let store = dir.path().join("bookmarks.json");
        assert!(load(&store).is_empty());
        fs::write(&store, b"corrupt").unwrap();
        assert!(load(&store).is_empty());
        assert!(restore(&store).is_empty());
    }
}
