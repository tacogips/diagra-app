use std::{
    fs, io,
    path::PathBuf,
    process::{Command, Stdio},
};

pub use nodetto_native::{attachments::read as attachment, fs::write_atomic};

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
