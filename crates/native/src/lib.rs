//! Native mechanisms shared by the CLI and desktop adapters.
//! App identities, grant pickers and document semantics belong to their callers.
pub mod attachments;
#[cfg(target_os = "macos")]
pub mod bookmarks;
pub mod fs;
