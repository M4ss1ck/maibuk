//! The Plugin Directory itself (ADR 0020): where it lives, how it is kept out
//! of the webview's reach, and how Rust lists, reads, copies, and hashes it.
//!
//! Desktop default: `$DOCUMENT/Maibuk/Plugins`. Android default: the
//! app-private `$APPDATA/plugins`. A custom desktop folder joins through the
//! ADR 0010 approval path (native UI in Rust, recorded in
//! `<app config dir>.trusted/plugin-directory.json`) and is forbidden in the
//! fs scope, never granted: a Plugin file the webview could overwrite is code
//! that runs.

use std::path::{Component, Path, PathBuf};

use tauri::{AppHandle, Manager, Runtime};

use crate::plugins::{archive, hash, PluginFile};
use crate::trusted;

pub const PLUGIN_APPROVAL_FILE: &str = "plugin-directory.json";
pub const INVALID: &str = "PLUGIN_DIRECTORY_INVALID";

/// A folder Rust refuses to read or copy as a Plugin folder.
#[derive(Debug, PartialEq, Eq)]
pub enum ReadError {
    /// A name that is not a single, safe folder name.
    InvalidName(String),
    /// A symbolic link where a regular file or folder belongs.
    Symlink(String),
    /// A file that is neither a regular file nor a folder.
    NotRegular(String),
    /// One file larger than the cap.
    FileTooLarge(String),
    /// The folder's total size is over the cap.
    FolderTooLarge,
    Io(String),
}

impl std::fmt::Display for ReadError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ReadError::InvalidName(path) => write!(formatter, "PLUGIN_FOLDER_INVALID_NAME: {path}"),
            ReadError::Symlink(path) => write!(formatter, "PLUGIN_FOLDER_SYMLINK: {path}"),
            ReadError::NotRegular(path) => write!(formatter, "PLUGIN_FOLDER_NOT_REGULAR: {path}"),
            ReadError::FileTooLarge(path) => {
                write!(formatter, "PLUGIN_FOLDER_FILE_TOO_LARGE: {path}")
            }
            ReadError::FolderTooLarge => write!(formatter, "PLUGIN_FOLDER_TOO_LARGE"),
            ReadError::Io(error) => write!(formatter, "PLUGIN_FOLDER_IO: {error}"),
        }
    }
}

/// A Plugin folder as Rust read it: the bytes it hashed and the `h1:` value
/// over them. `hash` is `None` for a folder the Go scheme cannot represent
/// (a filename with a newline), which the webview refuses with the shared
/// `hash-fixture-newline` contract.
#[derive(Debug, PartialEq, Eq)]
pub struct ReadFolder {
    pub name: String,
    pub hash: Option<String>,
    pub files: Vec<PluginFile>,
}

/// A Plugin Directory must be an absolute path to a folder below a filesystem
/// root, like a Backup Directory (ADR 0010).
pub fn validate_directory(path: &str) -> Result<PathBuf, &'static str> {
    trusted::validate_directory(path).map_err(|_| INVALID)
}

/// `$DOCUMENT/Maibuk/Plugins`, outside every folder the fs capability grants
/// the webview (`$APPCONFIG`, `$APPDATA`, `$APPLOCALDATA`, `$APPCACHE`,
/// `$APPLOG`), so even a differently cased path matches no allow pattern on
/// Windows (the case-variant hazard ADR 0020 records).
#[cfg(desktop)]
pub fn desktop_directory(documents: &Path) -> PathBuf {
    documents.join("Maibuk").join("Plugins")
}

/// The app-private folder Android installs into; case-sensitive, so the
/// recursive forbid is enough.
#[cfg(mobile)]
pub fn android_directory(data: &Path) -> PathBuf {
    data.join("plugins")
}

#[cfg(desktop)]
pub fn default_plugin_directory<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    // A Linux session with no XDG user dirs has no `$DOCUMENT`; `~/Documents`
    // is the same convention, and without it the app still runs with no
    // Plugins installed.
    let documents = app
        .path()
        .document_dir()
        .or_else(|_| app.path().home_dir().map(|home| home.join("Documents")))
        .map_err(|e| e.to_string())?;
    Ok(desktop_directory(&documents))
}

#[cfg(mobile)]
pub fn default_plugin_directory<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(android_directory(&data))
}

fn app_approval_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    trusted::approval_dir(&config_dir).ok_or_else(|| "app config directory has no name".into())
}

/// The folder the author approved on desktop, when one is recorded.
pub fn approved_directory<R: Runtime>(app: &AppHandle<R>) -> Result<Option<PathBuf>, String> {
    Ok(trusted::read_approval(
        &app_approval_dir(app)?,
        PLUGIN_APPROVAL_FILE,
    ))
}

/// The active Plugin Directory: the approved folder, or the platform default.
pub fn plugin_directory<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    match approved_directory(app)? {
        Some(approved) => Ok(approved),
        None => default_plugin_directory(app),
    }
}

/// Records an approval and forbids the folder in the fs scope. Never grants
/// it: the webview reads Plugin bytes only through Rust commands.
#[cfg_attr(mobile, allow(dead_code))]
pub fn approve<R: Runtime>(app: &AppHandle<R>, path: &Path) -> Result<(), String> {
    trusted::write_approval(&app_approval_dir(app)?, PLUGIN_APPROVAL_FILE, path)
        .map_err(|e| e.to_string())?;
    trusted::forbid_directory(app, path)
}

/// Drops the approval when the author goes back to the default directory.
pub fn forget<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    trusted::clear_approval(&app_approval_dir(app)?, PLUGIN_APPROVAL_FILE)
        .map_err(|e| e.to_string())
}

/// Creates the active directory when it is missing, so a launch with zero
/// Plugins still has the folder the author drops files into.
pub fn ensure<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let directory = plugin_directory(app)?;
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    Ok(directory)
}

/// Deny the Plugin Directory to the webview at setup, before it loads. The
/// default is forbidden even while a custom folder is active, so switching
/// back never opens a window where it is writable.
pub fn protect<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    trusted::forbid_directory(app, &default_plugin_directory(app)?)?;
    if let Some(approved) = approved_directory(app)? {
        trusted::forbid_directory(app, &approved)?;
    }
    Ok(())
}

/// The confirmation shown for a typed Plugin Directory. The text lives here,
/// not in the webview, so a script cannot word the dialog to mislead.
#[cfg_attr(mobile, allow(dead_code))]
pub fn confirmation_text(locale: &str, path: &Path) -> [String; 4] {
    let path = path.display();
    if locale.starts_with("es") {
        [
            "¿Usar esta carpeta para los Plugins?".into(),
            format!(
                "Maibuk cargará Plugins desde:\n\n{path}\n\n\
                 Solo Maibuk leerá esa carpeta; los Plugins que contenga podrán \
                 ejecutarse cuando los apruebes."
            ),
            "Usar carpeta".into(),
            "Cancelar".into(),
        ]
    } else {
        [
            "Use this folder for Plugins?".into(),
            format!(
                "Maibuk will load Plugins from:\n\n{path}\n\n\
                 Only Maibuk reads that folder; the Plugins it holds can run once \
                 you approve them."
            ),
            "Use folder".into(),
            "Cancel".into(),
        ]
    }
}

/// A single, safe folder name inside the Plugin Directory.
pub fn is_safe_folder_name(name: &str) -> bool {
    !name.is_empty()
        && !name.contains(['/', '\\', ':', '\0'])
        && Path::new(name)
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
        && !archive::is_os_litter(Path::new(name))
}

/// Folder names in the Plugin Directory, sorted; `[]` when there is none.
/// Loose files, symlinks, and OS litter are not Plugins.
pub fn list_folders(root: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    let mut names: Vec<String> = Vec::new();
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_dir() || file_type.is_symlink() {
            continue;
        }
        if archive::is_os_litter(Path::new(&entry.file_name())) {
            continue;
        }
        if let Some(name) = entry.file_name().to_str() {
            names.push(name.to_string());
        }
    }
    names.sort();
    names
}

fn relative(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

/// Every regular file under `root`, as `PluginFile`s sorted by the path's
/// UTF-8 bytes. Refuses symlinks and non-regular files, skips OS litter, and
/// caps the folder's size like an archive would.
pub fn read_files(root: &Path) -> Result<Vec<PluginFile>, ReadError> {
    read_files_with(root, &archive::Limits::default())
}

/// `read_files` with injectable caps, so the refusal paths are testable
/// without writing 64 MiB.
fn read_files_with(root: &Path, limits: &archive::Limits) -> Result<Vec<PluginFile>, ReadError> {
    let mut files = Vec::new();
    let mut total = 0u64;
    walk(root, root, &mut files, &mut total, limits)?;
    files.sort_by(|a, b| a.path.as_bytes().cmp(b.path.as_bytes()));
    Ok(files)
}

fn walk(
    root: &Path,
    directory: &Path,
    files: &mut Vec<PluginFile>,
    total: &mut u64,
    limits: &archive::Limits,
) -> Result<(), ReadError> {
    let entries = std::fs::read_dir(directory).map_err(|e| ReadError::Io(e.to_string()))?;
    for entry in entries {
        let entry = entry.map_err(|e| ReadError::Io(e.to_string()))?;
        let path = entry.path();
        if archive::is_os_litter(Path::new(&entry.file_name())) {
            continue;
        }
        let file_type = entry
            .file_type()
            .map_err(|e| ReadError::Io(e.to_string()))?;
        if file_type.is_symlink() {
            return Err(ReadError::Symlink(relative(root, &path)));
        }
        if file_type.is_dir() {
            walk(root, &path, files, total, limits)?;
            continue;
        }
        if !file_type.is_file() {
            return Err(ReadError::NotRegular(relative(root, &path)));
        }
        let size = entry
            .metadata()
            .map_err(|e| ReadError::Io(e.to_string()))?
            .len();
        if size > limits.max_file_bytes {
            return Err(ReadError::FileTooLarge(relative(root, &path)));
        }
        let bytes = std::fs::read(&path).map_err(|e| ReadError::Io(e.to_string()))?;
        *total += bytes.len() as u64;
        if *total > limits.max_total_bytes {
            return Err(ReadError::FolderTooLarge);
        }
        files.push(PluginFile {
            path: relative(root, &path),
            bytes,
        });
    }
    Ok(())
}

/// One Plugin folder: its files and the `h1:` hash over exactly those bytes.
/// `Ok(None)` when the folder is gone; a folder whose name is not safe, or
/// whose root is a symlink out of the Plugin Directory, is refused.
pub fn read_folder(root: &Path, name: &str) -> Result<Option<ReadFolder>, ReadError> {
    if !is_safe_folder_name(name) {
        return Err(ReadError::InvalidName(name.to_string()));
    }
    let folder = root.join(name);
    let metadata = match std::fs::symlink_metadata(&folder) {
        Ok(metadata) => metadata,
        Err(_) => return Ok(None),
    };
    if metadata.file_type().is_symlink() {
        return Err(ReadError::Symlink(folder.to_string_lossy().into_owned()));
    }
    if !metadata.is_dir() {
        return Ok(None);
    }
    if let (Ok(canonical_root), Ok(canonical)) =
        (std::fs::canonicalize(root), std::fs::canonicalize(&folder))
    {
        if !canonical.starts_with(&canonical_root) {
            return Err(ReadError::Symlink(folder.to_string_lossy().into_owned()));
        }
    }
    let files = read_files(&folder)?;
    // A folder the Go scheme cannot represent (a filename with a newline)
    // still reaches the webview, which refuses it with the shared contract.
    let hash = hash::hash1(&files).ok();
    Ok(Some(ReadFolder {
        name: name.to_string(),
        hash,
        files,
    }))
}

/// Copies a Plugin folder, using the same walk and rules as a read. The
/// caller writes into a staging folder and replaces the installed copy only
/// when the copy succeeded (Built-in installs, #444).
#[cfg_attr(mobile, allow(dead_code))]
pub fn copy_folder(source: &Path, destination: &Path) -> Result<(), ReadError> {
    let files = read_files(source)?;
    std::fs::create_dir_all(destination).map_err(|e| ReadError::Io(e.to_string()))?;
    for file in files {
        let target = destination.join(&file.path);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|e| ReadError::Io(e.to_string()))?;
        }
        std::fs::write(&target, file.bytes).map_err(|e| ReadError::Io(e.to_string()))?;
    }
    Ok(())
}

/// Moves `staging` onto `target`, keeping the previous copy until the move
/// succeeds. A failed extraction therefore leaves the installed Plugin as it
/// was.
pub fn replace_directory(staging: &Path, target: &Path) -> std::io::Result<()> {
    if !target.exists() {
        return std::fs::rename(staging, target);
    }
    let name = target
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "plugin".into());
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let previous = target.with_file_name(format!(".{name}.replaced-{nanos}"));
    std::fs::rename(target, &previous)?;
    match std::fs::rename(staging, target) {
        Ok(()) => {
            let _ = std::fs::remove_dir_all(&previous);
            Ok(())
        }
        Err(error) => {
            let _ = std::fs::rename(&previous, target);
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "maibuk-plugin-directory-{name}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn plugin_folder(root: &Path, name: &str, files: &[(&str, &str)]) -> PathBuf {
        let folder = root.join(name);
        std::fs::create_dir_all(&folder).unwrap();
        for (path, contents) in files {
            let target = folder.join(path);
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent).unwrap();
            }
            std::fs::write(target, contents).unwrap();
        }
        folder
    }

    #[test]
    fn lists_plugin_folders_sorted_and_ignores_files_litter_and_symlinks() {
        let dir = temp_dir("list");
        plugin_folder(&dir, "zeta", &[("manifest.json", "{}")]);
        plugin_folder(&dir, "alpha", &[("manifest.json", "{}")]);
        std::fs::write(dir.join("loose.txt"), "not a Plugin").unwrap();
        std::fs::write(dir.join(".DS_Store"), "litter").unwrap();
        std::fs::create_dir_all(dir.join(".DS_Store")).ok();
        #[cfg(unix)]
        std::os::unix::fs::symlink(dir.join("alpha"), dir.join("linked")).unwrap();

        assert_eq!(
            list_folders(&dir),
            vec!["alpha".to_string(), "zeta".to_string()]
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn lists_nothing_when_the_directory_does_not_exist() {
        let dir = temp_dir("missing");
        assert_eq!(list_folders(&dir.join("absent")), Vec::<String>::new());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn reads_a_folder_with_posix_paths_skipping_litter_and_hashes_it() {
        let dir = temp_dir("read");
        plugin_folder(
            &dir,
            "tracer",
            &[
                ("manifest.json", r#"{"id":"tracer"}"#),
                ("lib/util.js", "export {}"),
                (".DS_Store", "junk"),
            ],
        );

        let folder = read_folder(&dir, "tracer").unwrap().unwrap();

        assert_eq!(folder.name, "tracer");
        assert_eq!(
            folder
                .files
                .iter()
                .map(|file| file.path.as_str())
                .collect::<Vec<_>>(),
            vec!["lib/util.js", "manifest.json"]
        );
        assert_eq!(
            folder.hash,
            hash::hash1(&folder.files).ok(),
            "the returned hash is over exactly the returned bytes"
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn returns_none_for_a_missing_folder_or_a_loose_file() {
        let dir = temp_dir("none");
        std::fs::write(dir.join("loose.txt"), "x").unwrap();

        assert_eq!(read_folder(&dir, "absent").unwrap(), None);
        assert_eq!(read_folder(&dir, "loose.txt").unwrap(), None);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn refuses_names_that_are_not_a_single_safe_folder_name() {
        let dir = temp_dir("names");
        for name in ["", "..", ".", "a/b", "a\\b", "a:b", "nested/../../etc"] {
            let error = read_folder(&dir, name).unwrap_err();
            assert!(
                matches!(error, ReadError::InvalidName(_)),
                "{name:?}: {error:?}"
            );
        }
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn refuses_a_symlinked_folder_or_a_symlink_inside_one() {
        let dir = temp_dir("symlinks");
        plugin_folder(&dir, "real", &[("manifest.json", "{}")]);
        std::fs::create_dir_all(dir.join("outside")).unwrap();
        std::fs::write(dir.join("outside/secret.txt"), "secret").unwrap();
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(dir.join("real"), dir.join("linked")).unwrap();
            std::os::unix::fs::symlink(dir.join("outside/secret.txt"), dir.join("real/leak.txt"))
                .unwrap();
        }

        #[cfg(unix)]
        {
            assert!(matches!(
                read_folder(&dir, "linked").unwrap_err(),
                ReadError::Symlink(_)
            ));
            assert!(matches!(
                read_folder(&dir, "real").unwrap_err(),
                ReadError::Symlink(_)
            ));
        }
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn leaves_the_hash_unset_for_a_folder_the_go_scheme_cannot_represent() {
        let dir = temp_dir("newline");
        plugin_folder(&dir, "tracer", &[("manifest.json", "{}")]);
        std::fs::create_dir_all(dir.join("tracer/data")).unwrap();
        std::fs::write(dir.join("tracer/data/a\nb.txt"), "contents").unwrap();

        let folder = read_folder(&dir, "tracer").unwrap().unwrap();

        assert_eq!(folder.hash, None);
        assert_eq!(folder.files.len(), 2);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn refuses_a_file_over_the_reader_size_limit() {
        let dir = temp_dir("read-size");
        plugin_folder(
            &dir,
            "tracer",
            &[("manifest.json", "{}"), ("asset.bin", "12345")],
        );
        let limits = archive::Limits {
            max_entries: 8,
            max_file_bytes: 4,
            max_total_bytes: 64,
        };

        let error = read_files_with(&dir.join("tracer"), &limits).unwrap_err();

        assert!(matches!(error, ReadError::FileTooLarge(_)), "{error:?}");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn refuses_a_folder_over_the_reader_total_size_limit() {
        let dir = temp_dir("read-total");
        plugin_folder(&dir, "tracer", &[("a.bin", "1234"), ("b.bin", "5678")]);
        let limits = archive::Limits {
            max_entries: 8,
            max_file_bytes: 8,
            max_total_bytes: 4,
        };

        let error = read_files_with(&dir.join("tracer"), &limits).unwrap_err();

        assert_eq!(error, ReadError::FolderTooLarge);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn refuses_a_non_regular_file() {
        let dir = temp_dir("read-socket");
        plugin_folder(&dir, "tracer", &[("manifest.json", "{}")]);
        // A Unix socket is neither a regular file nor a directory; reading
        // through it would block or serve bytes the hash never covered.
        let _socket = std::os::unix::net::UnixListener::bind(dir.join("tracer/pipe")).unwrap();

        let error = read_folder(&dir, "tracer").unwrap_err();

        assert!(matches!(error, ReadError::NotRegular(_)), "{error:?}");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn copies_a_folder_with_the_same_file_set() {
        let dir = temp_dir("copy");
        let source = plugin_folder(
            &dir,
            "tracer",
            &[
                ("manifest.json", r#"{"id":"tracer"}"#),
                ("lib/util.js", "export {}"),
                (".DS_Store", "junk"),
            ],
        );
        let destination = dir.join("staging");

        copy_folder(&source, &destination).unwrap();

        assert_eq!(
            read_files(&destination).unwrap(),
            read_files(&source).unwrap()
        );
        assert!(!destination.join(".DS_Store").exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn refuses_to_copy_a_folder_with_a_symlink() {
        let dir = temp_dir("copy-symlink");
        let source = plugin_folder(&dir, "tracer", &[("manifest.json", "{}")]);
        #[cfg(unix)]
        {
            std::fs::write(dir.join("secret.txt"), "secret").unwrap();
            std::os::unix::fs::symlink(dir.join("secret.txt"), source.join("leak.txt")).unwrap();

            assert!(matches!(
                copy_folder(&source, &dir.join("staging")).unwrap_err(),
                ReadError::Symlink(_)
            ));
        }
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn replaces_an_installed_folder_and_installs_a_missing_one() {
        let dir = temp_dir("replace");
        let target = plugin_folder(&dir, "tracer", &[("index.js", "old")]);
        let staging = plugin_folder(&dir, "staging", &[("index.js", "new")]);

        replace_directory(&staging, &target).unwrap();
        assert_eq!(
            std::fs::read_to_string(target.join("index.js")).unwrap(),
            "new"
        );
        assert!(!staging.exists());

        let fresh = plugin_folder(&dir, "fresh-staging", &[("index.js", "fresh")]);
        let fresh_target = dir.join("fresh");
        replace_directory(&fresh, &fresh_target).unwrap();
        assert_eq!(
            std::fs::read_to_string(fresh_target.join("index.js")).unwrap(),
            "fresh"
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn names_the_path_in_both_languages() {
        let path = Path::new("/home/a/Documents/Maibuk/Plugins");

        let [title, message, ok, _] = confirmation_text("en", path);
        assert_eq!(title, "Use this folder for Plugins?");
        assert!(message.contains("/home/a/Documents/Maibuk/Plugins"));
        assert_eq!(ok, "Use folder");

        let [title, message, ok, _] = confirmation_text("es-ES", path);
        assert_eq!(title, "¿Usar esta carpeta para los Plugins?");
        assert!(message.contains("/home/a/Documents/Maibuk/Plugins"));
        assert_eq!(ok, "Usar carpeta");
    }

    #[test]
    fn rejects_relative_home_root_and_parent_paths() {
        for path in ["", "plugins", "~/Plugins", "./plugins", "/", "/mnt/../etc"] {
            assert_eq!(validate_directory(path), Err(INVALID), "{path:?}");
        }
    }

    #[cfg(desktop)]
    #[test]
    fn the_desktop_default_lives_under_the_documents_folder() {
        assert_eq!(
            desktop_directory(Path::new("/home/a/Documents")),
            Path::new("/home/a/Documents/Maibuk/Plugins")
        );
    }

    /// The security property end to end, on a mock app with the real fs
    /// plugin: the Plugin Directory is forbidden recursively, and it lives
    /// outside every folder the fs capability grants the webview, so even a
    /// differently cased path matches no allow pattern (the Windows hazard
    /// ADR 0020 records; this fails if the default moves under an app-specific
    /// folder). Runs on every desktop OS, so a case-insensitive filesystem
    /// exercises the case-variant path for real.
    #[cfg(desktop)]
    #[test]
    fn the_webview_scope_cannot_read_or_write_the_plugin_directory() {
        use tauri_plugin_fs::FsExt;

        let app = tauri::test::mock_builder()
            .plugin(tauri_plugin_fs::init())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let handle = app.handle().clone();
        let scope = handle.fs_scope();
        // What the capability grants the webview (`fs:default`'s
        // `read-app-specific-dirs-recursive`, plus the appconfig write grant).
        for folder in [
            handle.path().app_config_dir(),
            handle.path().app_data_dir(),
            handle.path().app_local_data_dir(),
            handle.path().app_cache_dir(),
            handle.path().app_log_dir(),
        ]
        .into_iter()
        .flatten()
        {
            scope.allow_directory(&folder, true).unwrap();
        }

        protect(&handle).unwrap();
        let plugins = plugin_directory(&handle).unwrap();

        for folder in [
            handle.path().app_config_dir(),
            handle.path().app_data_dir(),
            handle.path().app_local_data_dir(),
            handle.path().app_cache_dir(),
            handle.path().app_log_dir(),
        ]
        .into_iter()
        .flatten()
        {
            assert!(
                !plugins.starts_with(&folder),
                "the Plugin Directory must stay outside {folder:?}"
            );
        }
        assert!(!scope.is_allowed(plugins.join("manifest.json")));
        assert!(scope.is_forbidden(plugins.join("manifest.json")));
        assert!(!scope.is_allowed(plugins.join("MANIFEST.JSON")));
        let case_variant = plugins
            .parent()
            .unwrap()
            .join("PLUGINS")
            .join("manifest.json");
        assert!(!scope.is_allowed(&case_variant));
    }

    /// A custom approved folder is forbidden under both the path the author
    /// picked and its real path, so a symlink cannot expose it, and the forbid
    /// wins over any grant that covers it.
    #[cfg(unix)]
    #[test]
    fn a_symlinked_custom_plugin_directory_is_forbidden_under_both_paths() {
        use tauri_plugin_fs::FsExt;

        let dir = temp_dir("forbid");
        let real = dir.join("real");
        std::fs::create_dir_all(&real).unwrap();
        let link = dir.join("link");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        let real = std::fs::canonicalize(&real).unwrap();

        let app = tauri::test::mock_builder()
            .plugin(tauri_plugin_fs::init())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let handle = app.handle().clone();
        let scope = handle.fs_scope();
        scope.allow_directory(&dir, true).unwrap();

        trusted::forbid_directory(&handle, &link).unwrap();

        assert!(scope.is_forbidden(link.join("manifest.json")));
        assert!(scope.is_forbidden(real.join("manifest.json")));
        assert!(!scope.is_allowed(link.join("manifest.json")));
        assert!(!scope.is_allowed(real.join("manifest.json")));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
