//! The Store CLI is a standalone sandboxed entrypoint, not a GUI child helper.
//! Only explicit folder-picker grants are persisted. MCP never reads its stdin
//! for authorization and can request the same picker through nodetto_authorize.
#[cfg(target_os = "macos")]
mod mac {
    use nodetto_native::bookmarks::{self, SecurityScope};
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSApplication, NSApplicationActivationPolicy, NSOpenPanel};
    use objc2_foundation::{NSHomeDirectory, NSString, NSURL};
    use std::path::PathBuf;

    fn store() -> PathBuf {
        PathBuf::from(NSHomeDirectory().to_string())
            .join("Library/Application Support/me.tacogips.nodetto.cli/security-bookmarks.json")
    }
    pub fn restore() -> Vec<SecurityScope> {
        bookmarks::restore(&store()).into_values().collect()
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
        let path = bookmarks::remember_url(&store(), &url)
            .map_err(|e| format!("Cannot remember folder access: {e}"))?;
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
