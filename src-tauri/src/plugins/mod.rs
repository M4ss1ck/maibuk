//! The Plugin Directory (ADR 0020). Only Rust lists, reads, hashes, copies,
//! and watches the folder on desktop and Android, and hands the webview the
//! exact bytes it hashed. The directory is forbidden in the webview fs scope
//! at setup and never granted: a Plugin file the webview could overwrite is
//! code that runs.

pub mod archive;
pub mod directory;
pub mod hash;
#[cfg(desktop)]
pub mod watch;

use std::io::Read;
use std::path::{Component, Path, PathBuf};

use base64::Engine;
use serde::{Deserialize, Serialize};
#[cfg(not(target_os = "android"))]
use tauri::Manager;
use tauri::{AppHandle, Runtime};

/// One file in a Plugin folder: its POSIX-relative path and its exact bytes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PluginFile {
    pub path: String,
    pub bytes: Vec<u8>,
}

/// One Plugin folder as the webview receives it: every file's bytes, base64,
/// and the `h1:` hash Rust computed over exactly those bytes (`null` when the
/// Go scheme cannot represent the folder, which the runtime refuses).
#[derive(Debug, Serialize)]
pub struct PluginFolderPayload {
    pub name: String,
    pub hash: Option<String>,
    pub files: Vec<PluginFolderFilePayload>,
}

#[derive(Debug, Serialize)]
pub struct PluginFolderFilePayload {
    pub path: String,
    pub bytes: String,
}

/// An installed Plugin: its folder name and the hash of what was written.
#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct InstalledPlugin {
    pub id: String,
    pub hash: String,
}

/// A fresh staging folder beside the Plugin Directory. Extraction and copying
/// never write into an installed Plugin's folder.
fn staging_path(root: &Path) -> PathBuf {
    let name = root
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "plugins".into());
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    root.with_file_name(format!(".{name}.staging-{}-{nanos}", std::process::id()))
}

/// Hashes the staged folder and moves it onto the installed copy. Only a
/// fully written, readable folder replaces what is installed.
fn finish_install(id: &str, staging: &Path, root: &Path) -> Result<InstalledPlugin, String> {
    let files = directory::read_files(staging).map_err(|e| e.to_string())?;
    let hash = hash::hash1(&files).map_err(|e| e.to_string())?;
    directory::replace_directory(staging, &root.join(id)).map_err(|e| e.to_string())?;
    Ok(InstalledPlugin {
        id: id.to_string(),
        hash,
    })
}

/// Creates the staging folder, runs `stage`, then hashes what it wrote and
/// replaces the installed copy. Any failure cleans the staging folder and
/// leaves the installed copy exactly as it was.
fn stage_and_finish(
    root: &Path,
    stage: impl FnOnce(&Path) -> Result<String, String>,
) -> Result<InstalledPlugin, String> {
    std::fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let staging = staging_path(root);
    let _ = std::fs::remove_dir_all(&staging);
    let result = (|| {
        let id = stage(&staging)?;
        finish_install(&id, &staging, root)
    })();
    if result.is_err() {
        let _ = std::fs::remove_dir_all(&staging);
    }
    result
}

/// Installs the Plugin an archive carries into `root`: bound the input,
/// extract to a staging folder, hash what was written, then replace the
/// installed copy.
pub fn install_reader<R: Read>(root: &Path, reader: R) -> Result<InstalledPlugin, String> {
    install_reader_with_limits(root, reader, &archive::Limits::default())
}

/// `install_reader` with injectable limits: the compressed input is capped at
/// `limits.max_total_bytes` before it is buffered whole, so an oversized file
/// is refused through this function's error path and leaves no staging folder
/// behind.
fn install_reader_with_limits<R: Read>(
    root: &Path,
    reader: R,
    limits: &archive::Limits,
) -> Result<InstalledPlugin, String> {
    let mut input = Vec::new();
    reader
        .take(limits.max_total_bytes + 1)
        .read_to_end(&mut input)
        .map_err(|e| e.to_string())?;
    if input.len() as u64 > limits.max_total_bytes {
        return Err(archive::ArchiveError::ArchiveTooLarge.to_string());
    }
    stage_and_finish(root, move |staging| {
        let extracted = archive::extract(std::io::Cursor::new(input), staging, limits)
            .map_err(|e| e.to_string())?;
        Ok(extracted.id)
    })
}

/// Copies a Plugin folder into `root` (the Rust-side source must be one the
/// author picked, never a webview-named path). The id is read from the
/// staged manifest after the copy: the source manifest is never followed, and
/// the installed name always matches the folder that was written.
#[cfg(desktop)]
pub fn install_folder(source: &Path, root: &Path) -> Result<InstalledPlugin, String> {
    stage_and_finish(root, move |staging| {
        directory::copy_folder(source, staging).map_err(|e| e.to_string())?;
        let manifest = std::fs::read_to_string(staging.join("manifest.json"))
            .map_err(|e| format!("PLUGIN_FOLDER_MANIFEST: {e}"))?;
        archive::manifest_id(&manifest).map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub fn list_plugin_folders<R: Runtime>(app: AppHandle<R>) -> Result<Vec<String>, String> {
    let root = directory::plugin_directory(&app)?;
    Ok(directory::list_folders(&root))
}

#[tauri::command]
pub async fn read_plugin_folder<R: Runtime>(
    app: AppHandle<R>,
    name: String,
) -> Result<Option<PluginFolderPayload>, String> {
    let root = directory::plugin_directory(&app)?;
    let folder = directory::read_folder(&root, &name).map_err(|e| e.to_string())?;
    Ok(folder.map(|folder| PluginFolderPayload {
        name: folder.name,
        hash: folder.hash,
        files: folder
            .files
            .into_iter()
            .map(|file| PluginFolderFilePayload {
                path: file.path,
                bytes: base64::engine::general_purpose::STANDARD.encode(file.bytes),
            })
            .collect(),
    }))
}

/// The folder a Built-in Plugin ships in, under the app's resource root
/// (`<resource>/plugins/<id>/`). A pure function of the root so the resolve and
/// refuse rules are testable without an app: the id must pass the same safe
/// folder-name check the Plugin Directory uses, and a shipped folder must be
/// there and be a folder (never a symlink to one). This is the desktop path;
/// Android's `resource_dir()` is an `asset://` URI that `std::fs` cannot read,
/// so Android stages the shipped copy from the embedded frontend assets instead
/// (`stage_from_assets`).
#[cfg_attr(target_os = "android", allow(dead_code))]
pub fn resolve_builtin_plugin_folder(resource_root: &Path, name: &str) -> Result<PathBuf, String> {
    if !directory::is_safe_folder_name(name) {
        return Err(format!("PLUGIN_FOLDER_INVALID_NAME: {name}"));
    }
    let folder = resource_root.join("plugins").join(name);
    match std::fs::symlink_metadata(&folder) {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => Ok(folder),
        _ => Err(format!("PLUGIN_BUILT_IN_MISSING: {name}")),
    }
}

/// One entry in the embedded `plugins/index.json`: the id and the POSIX-relative
/// paths of its shipped files (the manifest and hash are not needed to stage).
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
#[derive(Deserialize)]
struct ShippedIndexEntry {
    id: String,
    files: Vec<String>,
}

#[cfg_attr(not(target_os = "android"), allow(dead_code))]
#[derive(Deserialize)]
struct ShippedIndex {
    plugins: Vec<ShippedIndexEntry>,
}

/// Whether `path` is a safe POSIX-relative path inside a Plugin folder: not
/// empty, no backslash, colon, or newline, and every component a normal name, so
/// `..`, an absolute path, and a drive prefix are refused. The same rules the
/// archive and the Plugin Directory apply before a file is written.
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
fn is_safe_relative_path(path: &str) -> bool {
    !path.is_empty()
        && !path.contains(['\\', ':', '\n'])
        && Path::new(path)
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
}

/// Stages a Built-in's shipped copy into `staging` from a lookup over the app's
/// embedded frontend assets (`dist/plugins/`, the `frontendDist`): reads
/// `plugins/index.json`, finds the entry whose id is `name`, then writes each
/// file it lists from `plugins/<id>/<path>`. A pure function of the lookup, so
/// Android's asset path is provable with an in-memory map. An unsafe `name`
/// (PLUGIN_FOLDER_INVALID_NAME), an id the index does not carry, a listed file
/// that is missing, and a listed path that would leave the folder are refused.
/// Returns the staged id; `stage_and_finish` installs it only when every file
/// was written, so a failure leaves the installed copy as it was.
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
fn stage_from_assets(
    lookup: impl Fn(&str) -> Option<Vec<u8>>,
    name: &str,
    staging: &Path,
) -> Result<String, String> {
    if !directory::is_safe_folder_name(name) {
        return Err(format!("PLUGIN_FOLDER_INVALID_NAME: {name}"));
    }
    let missing = || format!("PLUGIN_BUILT_IN_MISSING: {name}");
    let index_bytes = lookup("plugins/index.json").ok_or_else(missing)?;
    let index: ShippedIndex = serde_json::from_slice(&index_bytes).map_err(|_| missing())?;
    let entry = index
        .plugins
        .into_iter()
        .find(|entry| entry.id == name)
        .ok_or_else(missing)?;
    for path in &entry.files {
        if !is_safe_relative_path(path) {
            return Err(format!("PLUGIN_BUILT_IN_UNSAFE_PATH: {name}/{path}"));
        }
        let bytes = lookup(&format!("plugins/{name}/{path}")).ok_or_else(missing)?;
        let target = staging.join(path);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&target, bytes).map_err(|e| e.to_string())?;
    }
    Ok(name.to_string())
}

/// Replaces the installed copy of `name` under `root` with the shipped folder,
/// through a staging folder: the copy is read and hashed before it moves onto
/// the installed copy, so a failed copy leaves the installed copy as it was.
#[cfg_attr(target_os = "android", allow(dead_code))]
fn replace_from_folder(
    root: &Path,
    name: &str,
    shipped: PathBuf,
) -> Result<InstalledPlugin, String> {
    stage_and_finish(root, move |staging| {
        directory::copy_folder(&shipped, staging).map_err(|e| e.to_string())?;
        Ok(name.to_string())
    })
}

/// Replace a Built-in Plugin's installed folder with the copy Maibuk ships, so
/// the author's modified files are discarded in favour of the shipped ones. The
/// shipped copy is read in Rust: no bytes cross the IPC boundary, so the webview
/// cannot choose what a Built-in runs (ADR 0020). On desktop the copy lives in
/// the bundled resources (`<resource>/plugins/<id>/`); on Android the resource
/// root is an `asset://` URI, so the copy is staged from the app's embedded
/// frontend assets (`stage_from_assets`). An id with no bundled copy is refused.
#[tauri::command]
pub fn replace_builtin_plugin_folder<R: Runtime>(
    app: AppHandle<R>,
    name: String,
) -> Result<InstalledPlugin, String> {
    let root = directory::ensure(&app)?;
    #[cfg(target_os = "android")]
    {
        let resolver = app.asset_resolver();
        return stage_and_finish(&root, move |staging| {
            stage_from_assets(
                |path| resolver.get(path.to_string()).map(|asset| asset.bytes),
                &name,
                staging,
            )
        });
    }
    #[cfg(not(target_os = "android"))]
    {
        let resource_root = app.path().resource_dir().map_err(|e| e.to_string())?;
        let shipped = resolve_builtin_plugin_folder(&resource_root, &name)?;
        replace_from_folder(&root, &name, shipped)
    }
}

/// Open the native folder picker and approve the folder the author picks.
/// Resolves to `None` when the picker is cancelled. Desktop only; Android
/// keeps the fixed app-private directory.
#[tauri::command]
pub async fn pick_plugin_directory<R: Runtime>(
    app: AppHandle<R>,
    window: tauri::WebviewWindow<R>,
    default_path: Option<String>,
) -> Result<Option<String>, String> {
    #[cfg(desktop)]
    {
        use tauri_plugin_dialog::DialogExt;

        let mut picker = app.dialog().file().set_parent(&window);
        if let Some(start) = default_path
            .as_deref()
            .and_then(|path| directory::validate_directory(path).ok())
        {
            picker = picker.set_directory(start);
        }
        let Some(picked) = picker.blocking_pick_folder() else {
            return Ok(None);
        };
        let picked = picked.into_path().map_err(|e| e.to_string())?;
        let path = directory::validate_directory(&picked.to_string_lossy())?;
        directory::validate_custom_directory(&app, &path)?;
        directory::approve(&app, &path)?;
        Ok(Some(path.to_string_lossy().into_owned()))
    }
    #[cfg(mobile)]
    {
        let _ = (app, window, default_path);
        Err("the Plugin Directory is fixed on Android".into())
    }
}

/// Approve a typed Plugin Directory after the author confirms it in a native
/// dialog. Resolves to `false` when the author declines.
#[tauri::command]
pub async fn request_plugin_directory<R: Runtime>(
    app: AppHandle<R>,
    window: tauri::WebviewWindow<R>,
    path: String,
    locale: String,
) -> Result<bool, String> {
    let path = directory::validate_directory(&path)?;
    directory::validate_custom_directory(&app, &path)?;
    if directory::approved_directory(&app)? == Some(path.clone()) {
        return Ok(true);
    }
    #[cfg(desktop)]
    {
        use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

        let [title, message, ok, cancel] = directory::confirmation_text(&locale, &path);
        let confirmed = app
            .dialog()
            .message(message)
            .title(title)
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom(ok, cancel))
            .parent(&window)
            .blocking_show();
        if !confirmed {
            return Ok(false);
        }
        directory::approve(&app, &path)?;
        Ok(true)
    }
    #[cfg(mobile)]
    {
        let _ = (window, locale);
        Err("the Plugin Directory is fixed on Android".into())
    }
}

/// Drop the approval when the author goes back to the default directory.
#[tauri::command]
pub fn forget_plugin_directory<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    directory::forget(&app)
}

/// Open the native file picker for a Plugin `.zip`, read it in Rust, and
/// install it. Resolves to `None` when the picker is cancelled. The bytes
/// never pass through the webview, so a script cannot install a Plugin
/// without the author picking a file.
#[tauri::command]
pub async fn add_plugin_from_zip<R: Runtime>(
    app: AppHandle<R>,
    window: tauri::WebviewWindow<R>,
) -> Result<Option<InstalledPlugin>, String> {
    use tauri_plugin_dialog::DialogExt;
    use tauri_plugin_fs::{FsExt, OpenOptions};

    #[cfg(mobile)]
    let _ = &window;
    let picker = app.dialog().file().add_filter("Plugin", &["zip"]);
    #[cfg(desktop)]
    let picker = picker.set_parent(&window);
    let Some(picked) = picker.blocking_pick_file() else {
        return Ok(None);
    };
    // `Fs` opens Android content URIs and desktop paths alike. The compressed
    // input is bounded inside `install_reader` before it is buffered whole;
    // the `Fs` handle exposes no size, so the read is capped with `take`.
    let mut options = OpenOptions::new();
    options.read(true);
    let file = app.fs().open(picked, options).map_err(|e| e.to_string())?;
    let root = directory::ensure(&app)?;
    Ok(Some(install_reader(&root, file)?))
}

/// Open the native folder picker for a Plugin folder and copy it in. Resolves
/// to `None` when the picker is cancelled. Desktop only; Android installs
/// from a `.zip`.
#[cfg(desktop)]
#[tauri::command]
pub async fn add_plugin_from_folder<R: Runtime>(
    app: AppHandle<R>,
    window: tauri::WebviewWindow<R>,
) -> Result<Option<InstalledPlugin>, String> {
    use tauri_plugin_dialog::DialogExt;

    let Some(picked) = app
        .dialog()
        .file()
        .set_parent(&window)
        .blocking_pick_folder()
    else {
        return Ok(None);
    };
    let source = picked.into_path().map_err(|e| e.to_string())?;
    let root = directory::ensure(&app)?;
    Ok(Some(install_folder(&source, &root)?))
}

/// Removes a Plugin folder and every file in it. Resolves to `true` when the
/// folder was there and is now gone, `false` when it was already absent. The
/// id is the folder name; a name that is not a single safe folder name is
/// refused, and the folder must resolve under the current Plugin Directory.
#[tauri::command]
pub fn remove_plugin_folder<R: Runtime>(app: AppHandle<R>, id: String) -> Result<bool, String> {
    let root = directory::plugin_directory(&app)?;
    directory::remove_folder(&root, &id).map_err(|e| e.to_string())
}

/// Open the Plugin Directory in the system file manager, creating it first when
/// it is missing. Desktop only: mobile file managers have no folder view for
/// the app-private directory. The Rust-side opener is not reachable from the
/// webview, so no capability change is needed.
#[cfg(desktop)]
#[tauri::command]
pub fn open_plugin_directory<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;

    let root = directory::ensure(&app)?;
    app.opener()
        .open_path(root.to_string_lossy().into_owned(), None::<&str>)
        .map_err(|e| e.to_string())
}

/// Watch the Plugin Directory and emit `plugins://changed` with the folder
/// name when a Plugin's files change. Desktop only; Android has no hot reload
/// in v1.
#[cfg(desktop)]
#[tauri::command]
pub fn watch_plugin_directory<R: Runtime>(
    app: AppHandle<R>,
    watcher: tauri::State<'_, watch::PluginWatcher>,
) -> Result<(), String> {
    use tauri::Emitter;

    let root = directory::plugin_directory(&app)?;
    watcher.watch(&root, move |id| {
        let _ = app.emit("plugins://changed", ChangedPayload { id });
    })
}

#[cfg(desktop)]
#[tauri::command]
pub fn unwatch_plugin_directory(
    watcher: tauri::State<'_, watch::PluginWatcher>,
) -> Result<(), String> {
    watcher.unwatch();
    Ok(())
}

#[cfg(desktop)]
#[derive(Clone, Serialize)]
pub struct ChangedPayload {
    pub id: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "maibuk-plugin-install-{name}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn zip_bytes(files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (entry, contents) in files {
            writer
                .start_file(*entry, zip::write::SimpleFileOptions::default())
                .unwrap();
            writer.write_all(contents).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    #[test]
    fn installs_a_zip_and_returns_the_hash_of_what_was_written() {
        let root = temp_dir("install");
        let bytes = zip_bytes(&[
            ("manifest.json", br#"{"id":"tracer"}"#),
            ("index.js", b"export {}"),
        ]);

        let installed = install_reader(&root, Cursor::new(bytes)).unwrap();

        assert_eq!(installed.id, "tracer");
        let folder = directory::read_folder(&root, "tracer").unwrap().unwrap();
        assert_eq!(Some(installed.hash), folder.hash);
        assert!(root.join("tracer/index.js").exists());
        // No staging folder is left behind.
        let leftovers: Vec<_> = std::fs::read_dir(&root)
            .unwrap()
            .flatten()
            .filter(|entry| entry.file_name().to_string_lossy().contains("staging"))
            .collect();
        assert!(leftovers.is_empty(), "{leftovers:?}");
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_refused_archive_leaves_the_installed_copy_untouched() {
        let root = temp_dir("refused");
        let installed = install_reader(
            &root,
            Cursor::new(zip_bytes(&[
                ("manifest.json", br#"{"id":"tracer"}"#),
                ("index.js", b"export const a = 1;"),
            ])),
        )
        .unwrap();
        let before = directory::read_folder(&root, "tracer").unwrap().unwrap();

        let refused = install_reader(
            &root,
            Cursor::new(zip_bytes(&[
                ("manifest.json", br#"{"id":"tracer"}"#),
                ("../evil.txt", b"evil"),
            ])),
        );
        assert!(refused.is_err());
        assert!(!root.join("evil.txt").exists());

        let after = directory::read_folder(&root, "tracer").unwrap().unwrap();
        assert_eq!(before.files, after.files);
        assert_eq!(Some(installed.hash), after.hash);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn installing_a_second_copy_replaces_the_first() {
        let root = temp_dir("replace");
        install_reader(
            &root,
            Cursor::new(zip_bytes(&[
                ("manifest.json", br#"{"id":"tracer"}"#),
                ("index.js", b"old"),
            ])),
        )
        .unwrap();

        install_reader(
            &root,
            Cursor::new(zip_bytes(&[
                ("manifest.json", br#"{"id":"tracer"}"#),
                ("index.js", b"new"),
            ])),
        )
        .unwrap();

        assert_eq!(
            std::fs::read_to_string(root.join("tracer/index.js")).unwrap(),
            "new"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn copies_a_folder_in_and_leaves_the_copy_when_the_source_is_refused() {
        let root = temp_dir("folder-install");
        let source = temp_dir("folder-source");
        std::fs::write(source.join("manifest.json"), r#"{"id":"tracer"}"#).unwrap();
        std::fs::write(source.join("index.js"), "export {}").unwrap();

        let installed = install_folder(&source, &root).unwrap();
        assert_eq!(installed.id, "tracer");
        assert!(root.join("tracer/index.js").exists());

        #[cfg(unix)]
        {
            std::fs::write(source.join("secret.txt"), "secret").unwrap();
            std::os::unix::fs::symlink(source.join("secret.txt"), source.join("leak.txt")).unwrap();

            let before = directory::read_folder(&root, "tracer").unwrap().unwrap();
            assert!(install_folder(&source, &root).is_err());
            let after = directory::read_folder(&root, "tracer").unwrap().unwrap();
            assert_eq!(before.files, after.files);
        }
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&source).unwrap();
    }

    /// The compressed input is capped before it is buffered whole and before
    /// anything is staged: an oversized file is refused by `install_reader`
    /// and leaves no staging folder.
    #[test]
    fn refuses_an_archive_over_the_installed_input_cap_before_staging() {
        let root = temp_dir("input-cap");
        let limits = archive::Limits {
            max_file_bytes: 32,
            max_total_bytes: 64,
            ..archive::Limits::default()
        };

        let error =
            install_reader_with_limits(&root, Cursor::new(vec![0u8; 65]), &limits).unwrap_err();

        assert!(error.contains("PLUGIN_ARCHIVE_TOO_LARGE"), "{error}");
        assert_eq!(
            std::fs::read_dir(&root).unwrap().count(),
            0,
            "nothing may be staged for an oversized input"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    /// The id comes from the staged manifest, so a symlinked source manifest
    /// is refused (the copy refuses symlinks) and the installed copy stays as
    /// it was.
    #[cfg(unix)]
    #[test]
    fn refuses_a_source_whose_manifest_is_a_symlink_and_keeps_the_installed_copy() {
        let root = temp_dir("manifest-symlink-root");
        let source = temp_dir("manifest-symlink-source");
        std::fs::write(source.join("manifest.json"), r#"{"id":"tracer"}"#).unwrap();
        std::fs::write(source.join("index.js"), "export const a = 1;").unwrap();
        let installed = install_folder(&source, &root).unwrap();
        let before = directory::read_folder(&root, "tracer").unwrap().unwrap();

        // The source manifest becomes a symlink to a valid manifest outside
        // the folder: following it would install outside content under a
        // foreign id.
        std::fs::write(source.join("outside.json"), r#"{"id":"evil"}"#).unwrap();
        std::fs::remove_file(source.join("manifest.json")).unwrap();
        std::os::unix::fs::symlink(source.join("outside.json"), source.join("manifest.json"))
            .unwrap();

        assert!(install_folder(&source, &root).is_err());
        let after = directory::read_folder(&root, "tracer").unwrap().unwrap();
        assert_eq!(before.files, after.files);
        assert_eq!(Some(installed.hash), after.hash);
        assert!(!root.join("evil").exists());
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&source).unwrap();
    }

    #[test]
    fn resolves_a_bundled_built_in_folder_and_refuses_missing_or_unsafe_ids() {
        let root = temp_dir("builtin-resources");
        let shipped = root.join("plugins").join("tracer");
        std::fs::create_dir_all(&shipped).unwrap();
        std::fs::write(shipped.join("manifest.json"), r#"{"id":"tracer"}"#).unwrap();

        assert_eq!(
            resolve_builtin_plugin_folder(&root, "tracer").unwrap(),
            shipped,
            "a present bundled folder resolves"
        );

        // The id must pass the Plugin Directory's own safe-name check.
        for name in ["", "..", "a/b", "a\\b", "a:b", ".hidden"] {
            let error = resolve_builtin_plugin_folder(&root, name).unwrap_err();
            assert!(
                error.contains("PLUGIN_FOLDER_INVALID_NAME"),
                "{name:?}: {error}"
            );
        }

        // A shipped folder that is not there, and a loose file, are refused.
        assert!(resolve_builtin_plugin_folder(&root, "absent").is_err());
        std::fs::write(root.join("plugins").join("loose"), "x").unwrap();
        assert!(resolve_builtin_plugin_folder(&root, "loose").is_err());

        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn replaces_an_installed_copy_with_a_bundled_built_in_folder() {
        let resources = temp_dir("builtin-shipped");
        let shipped = resources.join("plugins").join("tracer");
        std::fs::create_dir_all(&shipped).unwrap();
        std::fs::write(shipped.join("manifest.json"), r#"{"id":"tracer"}"#).unwrap();
        std::fs::write(shipped.join("index.js"), "new").unwrap();

        let root = temp_dir("builtin-root");
        std::fs::create_dir_all(root.join("tracer")).unwrap();
        std::fs::write(root.join("tracer/index.js"), "old").unwrap();

        let resolved = resolve_builtin_plugin_folder(&resources, "tracer").unwrap();
        let installed = replace_from_folder(&root, "tracer", resolved).unwrap();

        assert_eq!(installed.id, "tracer");
        assert_eq!(
            std::fs::read_to_string(root.join("tracer/index.js")).unwrap(),
            "new"
        );
        let folder = directory::read_folder(&root, "tracer").unwrap().unwrap();
        assert_eq!(Some(installed.hash), folder.hash);
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&resources).unwrap();
    }

    /// The launch sync installs a Built-in whose folder is not there yet (#444):
    /// `replace_from_folder` must create the installed copy, not only replace
    /// one, and leave no staging folder behind.
    #[test]
    fn installs_a_bundled_built_in_folder_when_none_is_installed() {
        let resources = temp_dir("builtin-install-shipped");
        let shipped = resources.join("plugins").join("tracer");
        std::fs::create_dir_all(&shipped).unwrap();
        std::fs::write(shipped.join("manifest.json"), r#"{"id":"tracer"}"#).unwrap();
        std::fs::write(shipped.join("index.js"), "export {}").unwrap();

        let root = temp_dir("builtin-install-root");
        std::fs::create_dir_all(&root).unwrap();
        assert!(!root.join("tracer").exists());

        let resolved = resolve_builtin_plugin_folder(&resources, "tracer").unwrap();
        let installed = replace_from_folder(&root, "tracer", resolved).unwrap();

        assert_eq!(installed.id, "tracer");
        assert!(root.join("tracer/index.js").exists());
        let folder = directory::read_folder(&root, "tracer").unwrap().unwrap();
        assert_eq!(Some(installed.hash), folder.hash);
        let leftovers: Vec<_> = std::fs::read_dir(&root)
            .unwrap()
            .flatten()
            .filter(|entry| entry.file_name().to_string_lossy().contains("staging"))
            .collect();
        assert!(leftovers.is_empty(), "{leftovers:?}");
        std::fs::remove_dir_all(&root).unwrap();
        std::fs::remove_dir_all(&resources).unwrap();
    }

    /// The embedded assets Android stages from, keyed by path.
    fn asset_map(files: &[(&str, &[u8])]) -> std::collections::HashMap<String, Vec<u8>> {
        files
            .iter()
            .map(|(path, bytes)| (path.to_string(), bytes.to_vec()))
            .collect()
    }

    /// The Android path: the shipped copy is staged from the app's embedded
    /// frontend assets (`plugins/index.json` plus each listed file), not from a
    /// resource folder `std::fs` could read.
    #[test]
    fn stages_a_built_in_from_the_embedded_assets() {
        let index =
            br#"{"plugins":[{"id":"tracer","files":["manifest.json","index.js","assets/note.txt"]}]}"#;
        let files = asset_map(&[
            ("plugins/index.json", index),
            ("plugins/tracer/manifest.json", br#"{"id":"tracer"}"#),
            ("plugins/tracer/index.js", b"export {}"),
            ("plugins/tracer/assets/note.txt", b"note"),
        ]);
        let staging = temp_dir("assets-stage");

        let id = stage_from_assets(|path| files.get(path).cloned(), "tracer", &staging).unwrap();

        assert_eq!(id, "tracer");
        assert_eq!(
            std::fs::read_to_string(staging.join("index.js")).unwrap(),
            "export {}"
        );
        assert_eq!(
            std::fs::read_to_string(staging.join("assets/note.txt")).unwrap(),
            "note"
        );
        assert!(staging.join("manifest.json").exists());
        std::fs::remove_dir_all(&staging).unwrap();
    }

    /// An id the shipped index does not carry is refused with
    /// PLUGIN_BUILT_IN_MISSING, and an unsafe id (never a folder name the Plugin
    /// Directory would accept) with PLUGIN_FOLDER_INVALID_NAME.
    #[test]
    fn refuses_a_built_in_the_shipped_index_does_not_list() {
        let files = asset_map(&[("plugins/index.json", br#"{"plugins":[]}"#)]);
        let staging = temp_dir("assets-missing-id");

        let error =
            stage_from_assets(|path| files.get(path).cloned(), "tracer", &staging).unwrap_err();
        assert!(error.contains("PLUGIN_BUILT_IN_MISSING"), "{error}");

        for name in ["..", "a/b", ".hidden"] {
            let error = stage_from_assets(|_| None, name, &staging).unwrap_err();
            assert!(error.contains("PLUGIN_FOLDER_INVALID_NAME"), "{name}: {error}");
        }
        std::fs::remove_dir_all(&staging).unwrap();
    }

    /// A listed file the assets do not carry refuses the whole stage, so
    /// `stage_and_finish` installs nothing and leaves the installed copy as it
    /// was.
    #[test]
    fn a_missing_shipped_file_installs_nothing_and_keeps_the_copy() {
        let index = br#"{"plugins":[{"id":"tracer","files":["manifest.json","index.js"]}]}"#;
        let files = asset_map(&[
            ("plugins/index.json", index),
            ("plugins/tracer/manifest.json", br#"{"id":"tracer"}"#),
            // index.js is absent.
        ]);
        let root = temp_dir("assets-missing-file");
        std::fs::create_dir_all(root.join("tracer")).unwrap();
        std::fs::write(root.join("tracer/index.js"), "old").unwrap();

        let result = stage_and_finish(&root, |staging| {
            stage_from_assets(|path| files.get(path).cloned(), "tracer", staging)
        });

        assert!(result.is_err());
        assert_eq!(
            std::fs::read_to_string(root.join("tracer/index.js")).unwrap(),
            "old",
            "a refused stage leaves the installed copy untouched"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    /// A listed path that would leave the folder is refused before anything is
    /// written.
    #[test]
    fn refuses_a_shipped_path_that_leaves_the_folder() {
        for path in ["../evil.txt", "/etc/passwd", "a/../../evil.txt", "a\\b.txt"] {
            let index = serde_json::json!({
                "plugins": [{ "id": "tracer", "files": ["manifest.json", path] }]
            })
            .to_string();
            let files = asset_map(&[
                ("plugins/index.json", index.as_bytes()),
                ("plugins/tracer/manifest.json", br#"{"id":"tracer"}"#),
            ]);
            let parent = temp_dir("assets-traversal");
            let staging = parent.join("stage");
            std::fs::create_dir_all(&staging).unwrap();

            let error =
                stage_from_assets(|key| files.get(key).cloned(), "tracer", &staging).unwrap_err();

            assert!(error.contains("PLUGIN_BUILT_IN_UNSAFE_PATH"), "{path}: {error}");
            assert!(!parent.join("evil.txt").exists());
            std::fs::remove_dir_all(&parent).unwrap();
        }
    }
}
