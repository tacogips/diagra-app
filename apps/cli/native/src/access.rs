//! The Store CLI is a standalone sandboxed entrypoint, not a GUI child helper.
//! Only explicit folder-picker grants are persisted. MCP never reads its stdin
//! for authorization and can request the same picker through nodetto_authorize.
#[cfg(target_os = "macos")]
mod mac {
    use objc2::{rc::Retained, MainThreadMarker};
    use objc2_app_kit::{NSApplication, NSApplicationActivationPolicy, NSOpenPanel};
    use objc2_foundation::{
        NSData, NSHomeDirectory, NSString, NSURLBookmarkCreationOptions,
        NSURLBookmarkResolutionOptions, NSURL,
    };
    use std::{collections::BTreeMap, path::PathBuf};

    pub struct Access(Retained<NSURL>);
    impl Drop for Access {
        fn drop(&mut self) {
            unsafe { self.0.stopAccessingSecurityScopedResource() };
        }
    }
    fn store() -> PathBuf {
        PathBuf::from(NSHomeDirectory().to_string())
            .join("Library/Application Support/me.tacogips.nodetto.cli/security-bookmarks.json")
    }
    fn load() -> BTreeMap<String, Vec<u8>> {
        std::fs::read(store())
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    }
    pub fn restore() -> Vec<Access> {
        load().into_values().filter_map(|bytes| {
            // Foundation validates the stored opaque bookmark. Resolving never
            // displays UI; missing grants produce ordinary permission errors.
            let url = unsafe { NSURL::URLByResolvingBookmarkData_options_relativeToURL_bookmarkDataIsStale_error(
                &NSData::with_bytes(&bytes), NSURLBookmarkResolutionOptions::WithSecurityScope | NSURLBookmarkResolutionOptions::WithoutUI, None, std::ptr::null_mut(),
            ) }.ok()?;
            if unsafe { url.startAccessingSecurityScopedResource() } { Some(Access(url)) } else { None }
        }).collect()
    }
    pub fn authorize(folder: Option<&str>) -> Result<String, String> {
        let mtm =
            MainThreadMarker::new().ok_or("Folder authorization must run on the main thread")?;
        let app = NSApplication::sharedApplication(mtm);
        app.setActivationPolicy(NSApplicationActivationPolicy::Regular);
        app.finishLaunching();
        #[allow(deprecated)]
        app.activateIgnoringOtherApps(true);
        let panel = NSOpenPanel::openPanel(mtm);
        panel.setCanChooseFiles(false);
        panel.setCanChooseDirectories(true);
        panel.setAllowsMultipleSelection(false);
        panel.setTitle(Some(&NSString::from_str(
            "Allow Nodetto CLI to access a project folder",
        )));
        panel.setMessage(Some(&NSString::from_str("Select the folder containing your diagrams and exports. The CLI and MCP server will remember access to this folder.")));
        if let Some(folder) = folder {
            let path = std::path::absolute(folder).map_err(|e| e.to_string())?;
            panel.setDirectoryURL(Some(&NSURL::fileURLWithPath(&NSString::from_str(
                &path.to_string_lossy(),
            ))));
        }
        if panel.runModal() != 1 {
            return Err("Folder authorization cancelled; no access was changed.".into());
        }
        let url = panel.URL().ok_or("No folder was selected")?;
        let path = url
            .path()
            .ok_or("Selected folder has no filesystem path")?
            .to_string();
        let data = url
            .bookmarkDataWithOptions_includingResourceValuesForKeys_relativeToURL_error(
                NSURLBookmarkCreationOptions::WithSecurityScope,
                None,
                None,
            )
            .map_err(|e| format!("Cannot remember folder access: {e}"))?;
        let mut bookmarks = load();
        bookmarks.insert(path.clone(), data.to_vec());
        let store = store();
        std::fs::create_dir_all(store.parent().ok_or("Missing bookmark directory")?)
            .map_err(|e| e.to_string())?;
        crate::files::write_atomic(
            store.to_str().ok_or("Invalid bookmark path")?,
            &serde_json::to_vec(&bookmarks).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(store, std::fs::Permissions::from_mode(0o600))
            .map_err(|e| e.to_string())?;
        Ok(format!("Authorized project folder: {path}\nRestart any running MCP server to use this new grant.\n"))
    }
}
#[cfg(target_os = "macos")]
pub use mac::{authorize, restore};
#[cfg(not(target_os = "macos"))]
pub fn restore() {}
#[cfg(not(target_os = "macos"))]
pub fn authorize(folder: Option<&str>) -> Result<String, String> {
    let path = std::path::Path::new(folder.unwrap_or("."));
    if !path.is_dir() {
        return Err("The project folder must exist".into());
    }
    Ok("This platform does not require App Store folder authorization.\n".into())
}

pub fn command(args: &[String]) -> Option<crate::engine::CommandResult> {
    if args.first().is_none_or(|arg| arg != "authorize")
        || args.iter().any(|arg| arg == "--help" || arg == "-h")
    {
        return None;
    }
    let result = if args.len() > 2 || args.get(1).is_some_and(|arg| arg.starts_with('-')) {
        Err("Usage: nodetto-cli authorize [project-folder]".into())
    } else {
        authorize(args.get(1).map(String::as_str))
    };
    Some(match result {
        Ok(stdout) => crate::engine::CommandResult {
            exit_code: 0,
            stdout,
            stderr: String::new(),
        },
        Err(error) => crate::engine::CommandResult::error(error),
    })
}
