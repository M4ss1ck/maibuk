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

use std::io::{Read, Seek};
use std::path::{Path, PathBuf};

use base64::Engine;
use serde::Serialize;
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

/// Installs the Plugin an archive carries into `root`: extract to a staging
/// folder, hash what was written, then replace the installed copy.
pub fn install_reader<R: Read + Seek>(root: &Path, reader: R) -> Result<InstalledPlugin, String> {
    stage_and_finish(root, move |staging| {
        let extracted = archive::extract(reader, staging, &archive::Limits::default())
            .map_err(|e| e.to_string())?;
        Ok(extracted.id)
    })
}

/// Copies a Plugin folder into `root` (the Rust-side source must be one the
/// author picked, never a webview-named path).
#[cfg(desktop)]
pub fn install_folder(source: &Path, root: &Path) -> Result<InstalledPlugin, String> {
    let manifest = std::fs::read_to_string(source.join("manifest.json"))
        .map_err(|e| format!("PLUGIN_FOLDER_MANIFEST: {e}"))?;
    let id = archive::manifest_id(&manifest).map_err(|e| e.to_string())?;
    stage_and_finish(root, move |staging| {
        directory::copy_folder(source, staging).map_err(|e| e.to_string())?;
        Ok(id)
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
    use tauri_plugin_fs::FsExt;

    #[cfg(mobile)]
    let _ = &window;
    let picker = app.dialog().file().add_filter("Plugin", &["zip"]);
    #[cfg(desktop)]
    let picker = picker.set_parent(&window);
    let Some(picked) = picker.blocking_pick_file() else {
        return Ok(None);
    };
    // `Fs` reads Android content URIs and desktop paths alike.
    let bytes = app.fs().read(picked).map_err(|e| e.to_string())?;
    let root = directory::ensure(&app)?;
    Ok(Some(install_reader(&root, std::io::Cursor::new(bytes))?))
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
}
