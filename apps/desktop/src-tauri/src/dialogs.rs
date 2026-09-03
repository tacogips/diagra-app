// Native open and save dialogs.
//
// The plugin answers through a callback on the main thread, so the commands
// bridge that callback to a channel and wait for it on a blocking pool
// thread. Blocking the dialog's own thread would deadlock the event loop.

use std::path::PathBuf;
use std::sync::mpsc;

use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, FilePath};

const FILTER_NAME: &str = "diagra document";
const FILTER_EXTENSIONS: &[&str] = &["jsonl"];
const DEFAULT_FILE_NAME: &str = "untitled.jsonl";

/// Save dialogs on some platforms return the typed name without the filter's
/// extension. Only a name with no extension at all gets one appended: a user
/// who typed `notes.txt` meant `notes.txt`.
pub fn ensure_extension(path: PathBuf, extension: &str) -> PathBuf {
    if path.extension().is_some() {
        path
    } else {
        path.with_extension(extension)
    }
}

pub fn ensure_jsonl_extension(path: PathBuf) -> PathBuf {
    ensure_extension(path, FILTER_EXTENSIONS[0])
}

/// An export extension as the frontend hands it over: `svg`, `.SVG` and
/// ` svg ` all mean the same filter. Anything that is not a plain
/// alphanumeric token is refused rather than turned into a surprising file
/// name.
pub fn normalize_extension(extension: &str) -> Result<String, String> {
    let trimmed = extension
        .trim()
        .trim_start_matches('.')
        .to_ascii_lowercase();
    if trimmed.is_empty() || !trimmed.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(format!("unsupported export extension: {extension:?}"));
    }
    Ok(trimmed)
}

/// Filter label for an export dialog, e.g. `SVG file`.
fn export_filter_name(extension: &str) -> String {
    format!("{} file", extension.to_ascii_uppercase())
}

fn default_export_name(extension: &str) -> String {
    format!("export.{extension}")
}

/// Wait for the dialog callback without holding up the thread it runs on.
async fn receive(receiver: mpsc::Receiver<Option<FilePath>>) -> Result<Option<PathBuf>, String> {
    let picked = tauri::async_runtime::spawn_blocking(move || receiver.recv())
        .await
        .map_err(|error| format!("dialog task failed: {error}"))?
        .map_err(|error| format!("dialog closed without a result: {error}"))?;
    match picked {
        None => Ok(None),
        Some(file_path) => file_path
            .into_path()
            .map(Some)
            .map_err(|error| format!("unsupported file location: {error}")),
    }
}

fn to_string(path: PathBuf) -> String {
    path.to_string_lossy().into_owned()
}

#[tauri::command]
pub async fn pick_open_path(app: AppHandle) -> Result<Option<String>, String> {
    let (sender, receiver) = mpsc::channel();
    app.dialog()
        .file()
        .add_filter(FILTER_NAME, FILTER_EXTENSIONS)
        .pick_file(move |picked| {
            let _ = sender.send(picked);
        });
    Ok(receive(receiver).await?.map(to_string))
}

#[tauri::command]
pub async fn pick_save_path(
    app: AppHandle,
    default_name: Option<String>,
) -> Result<Option<String>, String> {
    let (sender, receiver) = mpsc::channel();
    app.dialog()
        .file()
        .add_filter(FILTER_NAME, FILTER_EXTENSIONS)
        .set_file_name(default_name.unwrap_or_else(|| DEFAULT_FILE_NAME.to_string()))
        .save_file(move |picked| {
            let _ = sender.send(picked);
        });
    Ok(receive(receiver)
        .await?
        .map(ensure_jsonl_extension)
        .map(to_string))
}

/// Save dialog for an export (design editor-ux 10): the filter and the
/// appended extension both follow `extension`, so the same command serves
/// SVG now and PNG later.
#[tauri::command]
pub async fn pick_export_path(
    app: AppHandle,
    default_name: Option<String>,
    extension: String,
) -> Result<Option<String>, String> {
    let extension = normalize_extension(&extension)?;
    let filter_name = export_filter_name(&extension);
    let extensions = [extension.as_str()];
    let (sender, receiver) = mpsc::channel();
    app.dialog()
        .file()
        .add_filter(filter_name, &extensions)
        .set_file_name(default_name.unwrap_or_else(|| default_export_name(&extension)))
        .save_file(move |picked| {
            let _ = sender.send(picked);
        });
    Ok(receive(receiver)
        .await?
        .map(|path| ensure_extension(path, &extension))
        .map(to_string))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn appends_the_extension_when_none_was_typed() {
        assert_eq!(
            ensure_jsonl_extension(PathBuf::from("/tmp/diagram")),
            PathBuf::from("/tmp/diagram.jsonl")
        );
    }

    #[test]
    fn keeps_an_existing_jsonl_extension() {
        assert_eq!(
            ensure_jsonl_extension(PathBuf::from("/tmp/diagram.jsonl")),
            PathBuf::from("/tmp/diagram.jsonl")
        );
    }

    #[test]
    fn keeps_a_foreign_extension() {
        assert_eq!(
            ensure_jsonl_extension(PathBuf::from("/tmp/diagram.txt")),
            PathBuf::from("/tmp/diagram.txt")
        );
    }

    #[test]
    fn keeps_a_dotted_name_as_its_own_extension() {
        // `notes.2026` reads as an extension to the filesystem, and second
        // guessing the user's dot is worse than leaving the name alone.
        assert_eq!(
            ensure_jsonl_extension(PathBuf::from("/tmp/notes.2026")),
            PathBuf::from("/tmp/notes.2026")
        );
    }

    #[test]
    fn export_appends_the_requested_extension() {
        assert_eq!(
            ensure_extension(PathBuf::from("/tmp/diagram"), "svg"),
            PathBuf::from("/tmp/diagram.svg")
        );
        assert_eq!(
            ensure_extension(PathBuf::from("/tmp/diagram.svg"), "svg"),
            PathBuf::from("/tmp/diagram.svg")
        );
        assert_eq!(
            ensure_extension(PathBuf::from("/tmp/diagram.txt"), "svg"),
            PathBuf::from("/tmp/diagram.txt")
        );
    }

    #[test]
    fn normalizes_an_extension_token() {
        assert_eq!(normalize_extension("svg").as_deref(), Ok("svg"));
        assert_eq!(normalize_extension(".SVG").as_deref(), Ok("svg"));
        assert_eq!(normalize_extension(" png ").as_deref(), Ok("png"));
    }

    #[test]
    fn refuses_an_extension_that_is_not_a_token() {
        assert!(normalize_extension("").is_err());
        assert!(normalize_extension(".").is_err());
        assert!(normalize_extension("sv g").is_err());
        assert!(normalize_extension("../x").is_err());
    }

    #[test]
    fn export_defaults_follow_the_extension() {
        assert_eq!(export_filter_name("svg"), "SVG file");
        assert_eq!(default_export_name("svg"), "export.svg");
    }
}
