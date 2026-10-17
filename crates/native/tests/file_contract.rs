use nodetto_native::{
    attachments,
    fs::{write_atomic, write_selected_file_atomic},
};
use std::{fs, io, path::Path};

type Writer = fn(&Path, &[u8]) -> io::Result<()>;

#[test]
fn both_access_modes_replace_bytes_and_leave_no_partial_files() {
    let writers: [Writer; 2] = [
        |p, b| write_atomic(p, b),
        |p, b| write_selected_file_atomic(p, b),
    ];
    for write in writers {
        let folder = tempfile::tempdir().unwrap();
        let file = folder.path().join("doc.jsonl");
        write(&file, b"before").unwrap();
        write(&file, &[0, 128, 255, 10]).unwrap();
        assert_eq!(fs::read(&file).unwrap(), [0, 128, 255, 10]);
        assert_eq!(fs::read_dir(folder.path()).unwrap().count(), 1);
        assert!(write(&folder.path().join("missing/doc"), b"no").is_err());
        assert!(!folder.path().join("missing").exists());
        assert!(write(folder.path(), b"no").is_err());
        assert_eq!(fs::read(&file).unwrap(), [0, 128, 255, 10]);
        assert_eq!(fs::read_dir(folder.path()).unwrap().count(), 1);
    }
}

#[cfg(unix)]
#[test]
fn directory_access_preserves_modes_and_symbolic_links() {
    use std::os::unix::fs::{symlink, PermissionsExt};
    let folder = tempfile::tempdir().unwrap();
    let target = folder.path().join("target");
    fs::write(&target, b"before").unwrap();
    fs::set_permissions(&target, fs::Permissions::from_mode(0o640)).unwrap();
    let link = folder.path().join("link");
    symlink("target", &link).unwrap();
    write_atomic(&link, b"after").unwrap();
    assert!(fs::symlink_metadata(&link)
        .unwrap()
        .file_type()
        .is_symlink());
    assert_eq!(fs::read(&target).unwrap(), b"after");
    assert_eq!(
        fs::metadata(&target).unwrap().permissions().mode() & 0o777,
        0o640
    );
    let dangling = folder.path().join("dangling");
    symlink("new", &dangling).unwrap();
    write_atomic(&dangling, b"created").unwrap();
    assert_eq!(fs::read(folder.path().join("new")).unwrap(), b"created");
    symlink("cycle", folder.path().join("cycle")).unwrap();
    assert!(write_atomic(folder.path().join("cycle"), b"no").is_err());
}

#[test]
fn portable_attachment_paths_match_browser_contract_and_utf8_limits() {
    let cases: serde_json::Value =
        serde_json::from_str(include_str!("../../../test-fixtures/attachment-paths.json")).unwrap();
    for value in cases["valid"].as_array().unwrap() {
        assert!(attachments::relative_path(value.as_str().unwrap()).is_ok());
    }
    for value in cases["invalid"].as_array().unwrap() {
        assert!(attachments::relative_path(value.as_str().unwrap()).is_err());
    }
    assert!(attachments::relative_path(&"a".repeat(1024)).is_ok());
    assert!(attachments::relative_path(&"a".repeat(1025)).is_err());
    assert!(attachments::relative_path(&"図".repeat(341)).is_ok());
    assert!(attachments::relative_path(&"図".repeat(342)).is_err());
}

#[test]
fn attachments_are_document_relative_bounded_and_regular_files() {
    let folder = tempfile::tempdir().unwrap();
    let document = folder.path().join("unsaved.jsonl");
    fs::create_dir(folder.path().join("assets")).unwrap();
    let image = folder.path().join("assets/image.png");
    fs::write(&image, [0, 128, 255]).unwrap();
    assert_eq!(
        attachments::read(&document, "assets/image.png").unwrap(),
        [0, 128, 255]
    );
    assert!(attachments::read(&document, "assets").is_err());
    let file = fs::OpenOptions::new().write(true).open(&image).unwrap();
    file.set_len(attachments::MAX_ATTACHMENT_BYTES).unwrap();
    assert_eq!(
        attachments::read(&document, "assets/image.png")
            .unwrap()
            .len() as u64,
        attachments::MAX_ATTACHMENT_BYTES
    );
    file.set_len(attachments::MAX_ATTACHMENT_BYTES + 1).unwrap();
    assert_eq!(
        attachments::read(&document, "assets/image.png")
            .unwrap_err()
            .kind(),
        io::ErrorKind::InvalidData
    );
    #[cfg(unix)]
    {
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("private"), b"no").unwrap();
        std::os::unix::fs::symlink(outside.path(), folder.path().join("escape")).unwrap();
        assert!(attachments::read(&document, "escape/private").is_err());
    }
}
