//! Installing a Plugin from a `.zip` (ADR 0020). A `.zip` is only how a folder
//! travels: extraction refuses absolute paths, `..`, backslashes, symlinks,
//! non-regular entries, duplicate paths after case folding, and archives that
//! break the size caps, then writes the folder the loader will hash. The
//! archive's own bytes, timestamps, and compression are discarded.

use std::io::{Read, Seek};
use std::path::{Component, Path, PathBuf};

use zip::ZipArchive;

/// OS litter a file manager may add inside a Plugin folder; it is not part of
/// the Plugin and never reaches the hashed file set (packaging decision #390).
pub const OS_LITTER: [&str; 3] = [".DS_Store", "Thumbs.db", "desktop.ini"];

/// Caps that bound a zip bomb while leaving room for Plugin assets.
#[derive(Debug, Clone, Copy)]
pub struct Limits {
    pub max_entries: usize,
    pub max_file_bytes: u64,
    pub max_total_bytes: u64,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            max_entries: 4096,
            max_file_bytes: 64 * 1024 * 1024,
            max_total_bytes: 256 * 1024 * 1024,
        }
    }
}

/// Why an archive was refused. The variants are stable so tests and callers
/// can name the rule that failed.
#[derive(Debug, PartialEq, Eq)]
pub enum ArchiveError {
    /// An entry name that would leave the extraction root.
    UnsafePath(String),
    /// An entry that is a symbolic link.
    Symlink(String),
    /// An entry that is neither a regular file nor a directory.
    NotRegular(String),
    /// Two entries that would land on the same path.
    DuplicatePath(String),
    /// An encrypted entry.
    Encrypted(String),
    /// More entries than the limit allows.
    TooManyEntries,
    /// One entry larger than the limit allows.
    FileTooLarge(String),
    /// The archive's total uncompressed size is over the limit.
    ArchiveTooLarge,
    /// The archive has no `manifest.json` at its root or under one folder.
    MissingManifest,
    /// The archive has several `manifest.json` files; it is not one Plugin.
    MultipleManifests,
    /// An entry that lives outside the folder holding the manifest.
    StrayEntry(String),
    /// The manifest does not name a usable Plugin id.
    InvalidId,
    Io(String),
    Zip(String),
}

impl std::fmt::Display for ArchiveError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ArchiveError::UnsafePath(path) => {
                write!(formatter, "PLUGIN_ARCHIVE_UNSAFE_PATH: {path}")
            }
            ArchiveError::Symlink(path) => write!(formatter, "PLUGIN_ARCHIVE_SYMLINK: {path}"),
            ArchiveError::NotRegular(path) => {
                write!(formatter, "PLUGIN_ARCHIVE_NOT_REGULAR: {path}")
            }
            ArchiveError::DuplicatePath(path) => {
                write!(formatter, "PLUGIN_ARCHIVE_DUPLICATE_PATH: {path}")
            }
            ArchiveError::Encrypted(path) => write!(formatter, "PLUGIN_ARCHIVE_ENCRYPTED: {path}"),
            ArchiveError::TooManyEntries => write!(formatter, "PLUGIN_ARCHIVE_TOO_MANY_ENTRIES"),
            ArchiveError::FileTooLarge(path) => {
                write!(formatter, "PLUGIN_ARCHIVE_FILE_TOO_LARGE: {path}")
            }
            ArchiveError::ArchiveTooLarge => write!(formatter, "PLUGIN_ARCHIVE_TOO_LARGE"),
            ArchiveError::MissingManifest => write!(formatter, "PLUGIN_ARCHIVE_MISSING_MANIFEST"),
            ArchiveError::MultipleManifests => {
                write!(formatter, "PLUGIN_ARCHIVE_MULTIPLE_MANIFESTS")
            }
            ArchiveError::StrayEntry(path) => {
                write!(formatter, "PLUGIN_ARCHIVE_STRAY_ENTRY: {path}")
            }
            ArchiveError::InvalidId => write!(formatter, "PLUGIN_ARCHIVE_INVALID_ID"),
            ArchiveError::Io(error) => write!(formatter, "PLUGIN_ARCHIVE_IO: {error}"),
            ArchiveError::Zip(error) => write!(formatter, "PLUGIN_ARCHIVE_ZIP: {error}"),
        }
    }
}

/// The folder a `.zip` carried, as the Plugin Directory will name it.
#[derive(Debug, PartialEq, Eq)]
pub struct Extracted {
    pub id: String,
}

/// Whether `path` is OS litter that is not part of a Plugin.
pub fn is_os_litter(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| OS_LITTER.contains(&name))
}

/// Extracts the Plugin the archive carries into `destination` (which must not
/// exist yet) and returns the id its manifest names.
pub fn extract<R: Read + Seek>(
    reader: R,
    destination: &Path,
    limits: &Limits,
) -> Result<Extracted, ArchiveError> {
    let mut archive = ZipArchive::new(reader).map_err(|e| ArchiveError::Zip(e.to_string()))?;
    if archive.len() > limits.max_entries {
        return Err(ArchiveError::TooManyEntries);
    }

    let entries = inspect(&mut archive)?;
    let prefix = manifest_prefix(&entries)?;
    let manifest = read_manifest(&mut archive, &entries, prefix.as_deref())?;
    let id = manifest_id(&manifest)?;

    std::fs::create_dir_all(destination).map_err(|e| ArchiveError::Io(e.to_string()))?;
    let mut total: u64 = 0;
    for entry in &entries {
        if entry.is_dir || is_os_litter(&entry.path) {
            continue;
        }
        let relative = match &prefix {
            Some(prefix) => entry
                .path
                .strip_prefix(prefix)
                .map_err(|_| ArchiveError::StrayEntry(entry.path.to_string_lossy().into_owned()))?,
            None => entry.path.as_path(),
        };
        if relative.as_os_str().is_empty() {
            continue;
        }
        let mut source = archive
            .by_index(entry.index)
            .map_err(|e| ArchiveError::Zip(e.to_string()))?;
        if source.size() > limits.max_file_bytes {
            return Err(ArchiveError::FileTooLarge(
                entry.path.to_string_lossy().into_owned(),
            ));
        }
        let target = destination.join(relative);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|e| ArchiveError::Io(e.to_string()))?;
        }
        let mut output =
            std::fs::File::create(&target).map_err(|e| ArchiveError::Io(e.to_string()))?;
        let mut limited = (&mut source).take(limits.max_file_bytes + 1);
        let copied = std::io::copy(&mut limited, &mut output)
            .map_err(|e| ArchiveError::Io(e.to_string()))?;
        if copied > limits.max_file_bytes {
            return Err(ArchiveError::FileTooLarge(
                entry.path.to_string_lossy().into_owned(),
            ));
        }
        total += copied;
        if total > limits.max_total_bytes {
            return Err(ArchiveError::ArchiveTooLarge);
        }
    }
    Ok(Extracted { id })
}

struct Entry {
    index: usize,
    path: PathBuf,
    is_dir: bool,
}

/// One pass over the central directory: every name is validated and the file
/// set is deduplicated before anything is written.
fn inspect<R: Read + Seek>(archive: &mut ZipArchive<R>) -> Result<Vec<Entry>, ArchiveError> {
    let mut entries = Vec::with_capacity(archive.len());
    let mut seen: Vec<String> = Vec::new();
    for index in 0..archive.len() {
        let file = archive
            .by_index(index)
            .map_err(|e| ArchiveError::Zip(e.to_string()))?;
        let name = file.name().map_err(|e| ArchiveError::Zip(e.to_string()))?;
        if file.encrypted() {
            return Err(ArchiveError::Encrypted(name.into_owned()));
        }
        // `enclosed_name` strips a leading root or drive prefix instead of
        // refusing it, so the raw name is checked first. Backslashes are not
        // separators on every platform; colons mean a drive or an alternate
        // data stream on Windows.
        if name.contains('\\') || name.contains(':') || name.starts_with('/') {
            return Err(ArchiveError::UnsafePath(name.into_owned()));
        }
        let name = name.into_owned();
        let path = file
            .enclosed_name()
            .ok_or_else(|| ArchiveError::UnsafePath(name.clone()))?;
        if !path
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
        {
            return Err(ArchiveError::UnsafePath(name.clone()));
        }
        let is_dir = file.is_dir();
        if file.is_symlink() {
            return Err(ArchiveError::Symlink(name.clone()));
        }
        if !is_dir && !file.is_file() {
            return Err(ArchiveError::NotRegular(name.clone()));
        }
        if let Some(mode) = file.unix_mode() {
            let kind = mode & 0o170000;
            if kind != 0 && kind != 0o100000 && kind != 0o040000 {
                return Err(ArchiveError::NotRegular(name.clone()));
            }
        }
        let folded = path.to_string_lossy().to_lowercase();
        if seen.iter().any(|current| current == &folded) {
            return Err(ArchiveError::DuplicatePath(name));
        }
        seen.push(folded);
        entries.push(Entry {
            index,
            path,
            is_dir,
        });
    }
    Ok(entries)
}

/// The folder holding `manifest.json`: none (archive root) or one component.
fn manifest_prefix(entries: &[Entry]) -> Result<Option<String>, ArchiveError> {
    let mut root = false;
    let mut folders: Vec<String> = Vec::new();
    for entry in entries {
        if entry.is_dir
            || entry.path.file_name().and_then(|name| name.to_str()) != Some("manifest.json")
        {
            continue;
        }
        let mut components = entry.path.components();
        match (components.next(), components.next()) {
            (Some(Component::Normal(_)), None) => root = true,
            (Some(Component::Normal(folder)), Some(Component::Normal(_)))
                if components.next().is_none() =>
            {
                folders.push(folder.to_string_lossy().into_owned());
            }
            _ => {
                return Err(ArchiveError::UnsafePath(
                    entry.path.to_string_lossy().into_owned(),
                ))
            }
        }
    }
    match (root, folders.len()) {
        (false, 0) => Err(ArchiveError::MissingManifest),
        (true, 0) => Ok(None),
        (false, 1) => Ok(Some(folders.remove(0))),
        _ => Err(ArchiveError::MultipleManifests),
    }
}

fn read_manifest<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    entries: &[Entry],
    prefix: Option<&str>,
) -> Result<String, ArchiveError> {
    let expected = match prefix {
        Some(prefix) => PathBuf::from(prefix).join("manifest.json"),
        None => PathBuf::from("manifest.json"),
    };
    let entry = entries
        .iter()
        .find(|entry| entry.path == expected)
        .ok_or(ArchiveError::MissingManifest)?;
    let mut file = archive
        .by_index(entry.index)
        .map_err(|e| ArchiveError::Zip(e.to_string()))?;
    let mut text = String::new();
    file.read_to_string(&mut text)
        .map_err(|e| ArchiveError::Io(e.to_string()))?;
    Ok(text)
}

/// The id a manifest names; it becomes the folder name an install writes to.
pub fn manifest_id(manifest: &str) -> Result<String, ArchiveError> {
    let value: serde_json::Value =
        serde_json::from_str(manifest).map_err(|_| ArchiveError::InvalidId)?;
    let id = value
        .get("id")
        .and_then(|id| id.as_str())
        .ok_or(ArchiveError::InvalidId)?;
    if !is_plugin_id(id) {
        return Err(ArchiveError::InvalidId);
    }
    Ok(id.to_string())
}

/// The Plugin id shape from `PLUGIN_ID_SOURCE` (`src/features/plugins/ids.ts`):
/// a lowercase slug, 3 to 64 characters. It becomes a folder name.
fn is_plugin_id(id: &str) -> bool {
    (3..=64).contains(&id.len())
        && id
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};
    use zip::write::SimpleFileOptions;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "maibuk-plugin-archive-{name}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_zip(dir: &Path, name: &str, files: &[(&str, &[u8])]) -> PathBuf {
        let path = dir.join(name);
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (entry, contents) in files {
            writer
                .start_file(*entry, SimpleFileOptions::default())
                .unwrap();
            writer.write_all(contents).unwrap();
        }
        let bytes = writer.finish().unwrap().into_inner();
        std::fs::write(&path, bytes).unwrap();
        path
    }

    fn write_symlink_zip(dir: &Path, name: &str) -> PathBuf {
        let path = dir.join(name);
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        writer
            .add_symlink("link.js", "/etc/passwd", SimpleFileOptions::default())
            .unwrap();
        writer
            .start_file("manifest.json", SimpleFileOptions::default())
            .unwrap();
        writer.write_all(br#"{"id":"tracer"}"#).unwrap();
        let bytes = writer.finish().unwrap().into_inner();
        std::fs::write(&path, bytes).unwrap();
        path
    }

    fn small_limits() -> Limits {
        Limits {
            max_entries: 8,
            max_file_bytes: 64,
            max_total_bytes: 128,
        }
    }

    fn extract_zip(
        zip: &Path,
        destination: &Path,
        limits: &Limits,
    ) -> Result<Extracted, ArchiveError> {
        extract(std::fs::File::open(zip).unwrap(), destination, limits)
    }

    #[test]
    fn extracts_a_root_folder_zip_and_names_the_manifest_id() {
        let dir = temp_dir("root");
        let zip = write_zip(
            &dir,
            "tracer.zip",
            &[
                ("manifest.json", br#"{"id":"tracer","name":"Tracer"}"#),
                ("index.js", b"export {}"),
                ("lib/util.js", b"export {}"),
            ],
        );
        let destination = dir.join("out");

        let extracted = extract_zip(&zip, &destination, &small_limits()).unwrap();

        assert_eq!(extracted.id, "tracer");
        assert_eq!(
            std::fs::read_to_string(destination.join("index.js")).unwrap(),
            "export {}"
        );
        assert!(destination.join("lib/util.js").exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn extracts_a_single_folder_zip_stripping_the_folder_name() {
        let dir = temp_dir("folder");
        let zip = write_zip(
            &dir,
            "tracer.zip",
            &[
                ("tracer/manifest.json", br#"{"id":"tracer"}"#),
                ("tracer/index.js", b"export {}"),
            ],
        );
        let destination = dir.join("out");

        let extracted = extract_zip(&zip, &destination, &small_limits()).unwrap();

        assert_eq!(extracted.id, "tracer");
        assert!(destination.join("manifest.json").exists());
        assert!(destination.join("index.js").exists());
        assert!(!destination.join("tracer").exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn refuses_zip_slip_paths_without_writing_outside_the_destination() {
        let dir = temp_dir("slip");
        for name in [
            "../evil.txt",
            "a/../../evil.txt",
            "/etc/passwd",
            "a\\..\\evil.txt",
        ] {
            let zip = write_zip(
                &dir,
                "evil.zip",
                &[("manifest.json", br#"{"id":"tracer"}"#), (name, b"evil")],
            );
            let destination = dir.join("out");

            let error = extract_zip(&zip, &destination, &small_limits())
                .expect_err(&format!("{name} was accepted"));

            assert!(
                matches!(error, ArchiveError::UnsafePath(_)),
                "{name}: {error:?}"
            );
            assert!(!dir.join("evil.txt").exists());
            assert!(!destination.exists() || !destination.join("evil.txt").exists());
        }
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn refuses_symbolic_link_entries() {
        let dir = temp_dir("symlink");
        let zip = write_symlink_zip(&dir, "link.zip");
        let destination = dir.join("out");

        let error = extract_zip(&zip, &destination, &small_limits()).unwrap_err();

        assert!(matches!(error, ArchiveError::Symlink(_)), "{error:?}");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn refuses_two_entries_that_differ_only_by_case() {
        let dir = temp_dir("case");
        let zip = write_zip(
            &dir,
            "case.zip",
            &[
                ("manifest.json", br#"{"id":"tracer"}"#),
                ("Index.js", b"a"),
                ("index.js", b"b"),
            ],
        );
        let destination = dir.join("out");

        let error = extract_zip(&zip, &destination, &small_limits()).unwrap_err();

        assert!(matches!(error, ArchiveError::DuplicatePath(_)), "{error:?}");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn refuses_a_zip_over_the_entry_limit() {
        let dir = temp_dir("entries");
        let zip = write_zip(
            &dir,
            "many.zip",
            &[
                ("manifest.json", br#"{"id":"tracer"}"#),
                ("a.js", b"a"),
                ("b.js", b"b"),
            ],
        );
        let limits = Limits {
            max_entries: 2,
            ..small_limits()
        };

        let error = extract_zip(&zip, &dir.join("out"), &limits).unwrap_err();

        assert_eq!(error, ArchiveError::TooManyEntries);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn refuses_a_file_over_the_size_limit() {
        let dir = temp_dir("file-size");
        let zip = write_zip(
            &dir,
            "big.zip",
            &[
                ("manifest.json", br#"{"id":"tracer"}"#),
                ("asset.bin", &[7u8; 80]),
            ],
        );
        let limits = Limits {
            max_file_bytes: 64,
            ..small_limits()
        };

        let error = extract_zip(&zip, &dir.join("out"), &limits).unwrap_err();

        assert!(matches!(error, ArchiveError::FileTooLarge(_)), "{error:?}");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn refuses_an_archive_over_the_total_size_limit() {
        let dir = temp_dir("total-size");
        let zip = write_zip(
            &dir,
            "total.zip",
            &[
                ("manifest.json", br#"{"id":"tracer"}"#),
                ("a.bin", &[7u8; 48]),
                ("b.bin", &[7u8; 48]),
            ],
        );
        let limits = Limits {
            max_file_bytes: 64,
            max_total_bytes: 80,
            ..small_limits()
        };

        let error = extract_zip(&zip, &dir.join("out"), &limits).unwrap_err();

        assert_eq!(error, ArchiveError::ArchiveTooLarge);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn refuses_an_archive_without_a_manifest() {
        let dir = temp_dir("no-manifest");
        let zip = write_zip(&dir, "empty.zip", &[("index.js", b"export {}")]);

        let error = extract_zip(&zip, &dir.join("out"), &small_limits()).unwrap_err();

        assert_eq!(error, ArchiveError::MissingManifest);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn refuses_an_archive_with_several_manifests() {
        let dir = temp_dir("many-manifests");
        let zip = write_zip(
            &dir,
            "two.zip",
            &[
                ("one/manifest.json", br#"{"id":"one"}"#),
                ("two/manifest.json", br#"{"id":"two"}"#),
            ],
        );

        let error = extract_zip(&zip, &dir.join("out"), &small_limits()).unwrap_err();

        assert_eq!(error, ArchiveError::MultipleManifests);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn refuses_entries_outside_the_folder_holding_the_manifest() {
        let dir = temp_dir("stray");
        let zip = write_zip(
            &dir,
            "stray.zip",
            &[
                ("tracer/manifest.json", br#"{"id":"tracer"}"#),
                ("README.md", b"# not part of the Plugin"),
            ],
        );

        let error = extract_zip(&zip, &dir.join("out"), &small_limits()).unwrap_err();

        assert!(matches!(error, ArchiveError::StrayEntry(_)), "{error:?}");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn refuses_a_manifest_without_a_usable_id() {
        let dir = temp_dir("bad-id");
        for manifest in [
            br#"{"name":"Tracer"}"#.as_slice(),
            br#"{"id":"Tracer"}"#.as_slice(),
            br#"{"id":"../evil"}"#.as_slice(),
            br#"{"id":"ab"}"#.as_slice(),
            b"not json".as_slice(),
        ] {
            let zip = write_zip(&dir, "bad.zip", &[("manifest.json", manifest)]);
            let error = extract_zip(&zip, &dir.join("out"), &small_limits()).unwrap_err();
            assert_eq!(error, ArchiveError::InvalidId, "{manifest:?}");
        }
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn skips_os_litter_entries() {
        let dir = temp_dir("litter");
        let zip = write_zip(
            &dir,
            "litter.zip",
            &[
                ("manifest.json", br#"{"id":"tracer"}"#),
                (".DS_Store", b"junk"),
                ("lib/Thumbs.db", b"junk"),
            ],
        );
        let destination = dir.join("out");

        extract_zip(&zip, &destination, &small_limits()).unwrap();

        assert!(!destination.join(".DS_Store").exists());
        assert!(!destination.join("lib/Thumbs.db").exists());
        assert!(destination.join("manifest.json").exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
