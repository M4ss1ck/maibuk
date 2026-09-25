//! Backup Directory access.
//!
//! The fs scope is the only thing that confines the webview's writes, so a
//! custom Backup Directory joins it only through native UI a script cannot
//! fake: the author picks the folder in the native picker, or confirms a typed
//! path in a native dialog. The approved directory is recorded outside every
//! path the webview may write, so launch can grant it again without asking and
//! background Backups never open a dialog. See docs/adr/0010.

use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_fs::FsExt;

pub const NOT_APPROVED: &str = "BACKUP_DIRECTORY_NOT_APPROVED";
pub const INVALID: &str = "BACKUP_DIRECTORY_INVALID";

const APPROVAL_FILE: &str = "backup-directory.json";

#[derive(Serialize, Deserialize)]
struct Approval {
    path: PathBuf,
}

/// A Backup Directory must be an absolute path to a folder below a filesystem
/// root. Relative paths and `~` would resolve against the process's working
/// directory, and `..` is rejected by the fs plugin anyway.
pub fn validate_directory(path: &str) -> Result<PathBuf, &'static str> {
    let path = PathBuf::from(path.trim());
    if !path.is_absolute() || path.parent().is_none() {
        return Err(INVALID);
    }
    if path.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err(INVALID);
    }
    Ok(path)
}

/// Where the approval lives: a sibling of the app config directory, not inside
/// it. The webview may write anywhere under the config directory
/// (`fs:allow-appconfig-write-recursive`), and scope patterns match case
/// sensitively, so a denied file inside it could still be reached through a
/// differently cased path on macOS and Windows. A sibling matches no allowed
/// pattern in any casing.
pub fn approval_dir(config_dir: &Path) -> Option<PathBuf> {
    let name = config_dir.file_name()?.to_str()?;
    Some(config_dir.with_file_name(format!("{name}.trusted")))
}

pub fn read_approval(dir: &Path) -> Option<PathBuf> {
    let text = std::fs::read_to_string(dir.join(APPROVAL_FILE)).ok()?;
    serde_json::from_str::<Approval>(&text).ok().map(|a| a.path)
}

#[cfg_attr(mobile, allow(dead_code))]
pub fn write_approval(dir: &Path, path: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let approval = Approval {
        path: path.to_path_buf(),
    };
    let text = serde_json::to_string(&approval).map_err(std::io::Error::other)?;
    std::fs::write(dir.join(APPROVAL_FILE), text)
}

pub fn clear_approval(dir: &Path) -> std::io::Result<()> {
    match std::fs::remove_file(dir.join(APPROVAL_FILE)) {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error),
        _ => Ok(()),
    }
}

pub fn is_approved(dir: &Path, path: &Path) -> bool {
    read_approval(dir).is_some_and(|approved| approved == path)
}

/// The confirmation shown for a typed Backup Directory. The text lives here,
/// not in the webview, so a script cannot word the dialog to mislead.
#[cfg_attr(mobile, allow(dead_code))]
pub fn confirmation_text(locale: &str, path: &Path) -> [String; 4] {
    let path = path.display();
    if locale.starts_with("es") {
        [
            "¿Usar esta carpeta para las copias de seguridad?".into(),
            format!(
                "Maibuk guardará las copias de seguridad en:\n\n{path}\n\n\
                 y podrá crear y borrar archivos en esa carpeta."
            ),
            "Usar carpeta".into(),
            "Cancelar".into(),
        ]
    } else {
        [
            "Use this folder for Backups?".into(),
            format!(
                "Maibuk will keep Backups in:\n\n{path}\n\n\
                 and will be able to create and delete files in that folder."
            ),
            "Use folder".into(),
            "Cancel".into(),
        ]
    }
}

fn app_approval_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    approval_dir(&config_dir).ok_or_else(|| "app config directory has no name".into())
}

/// The path as given plus where it really lives. The fs scope stores patterns
/// as given but canonicalizes the paths it checks, so a folder reached through
/// a symlink needs both. A folder that does not exist yet resolves through its
/// parent.
pub fn scope_paths(path: &Path) -> Vec<PathBuf> {
    let real = std::fs::canonicalize(path).ok().or_else(|| {
        let parent = std::fs::canonicalize(path.parent()?).ok()?;
        Some(parent.join(path.file_name()?))
    });
    let mut paths = vec![path.to_path_buf()];
    if let Some(real) = real.filter(|real| real != path) {
        paths.push(real);
    }
    paths
}

fn grant<R: Runtime>(app: &AppHandle<R>, path: &Path) -> Result<(), String> {
    let scope = app.fs_scope();
    for path in scope_paths(path) {
        scope
            .allow_directory(&path, false)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, allow(dead_code))]
fn approve<R: Runtime>(app: &AppHandle<R>, path: &Path) -> Result<(), String> {
    write_approval(&app_approval_dir(app)?, path).map_err(|e| e.to_string())?;
    grant(app, path)
}

/// Deny the approval directory to the webview even if a grant would cover it,
/// for example an author choosing the config folder's parent as a Backup
/// Directory. Runs at setup, before the webview loads.
pub fn protect_approval<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let scope = app.fs_scope();
    for path in scope_paths(&app_approval_dir(app)?) {
        scope
            .forbid_directory(&path, true)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Open the native folder picker and approve the folder the author picks.
/// Resolves to `None` when the picker is cancelled.
#[tauri::command]
pub async fn pick_backup_directory<R: Runtime>(
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
            .and_then(|p| validate_directory(p).ok())
        {
            picker = picker.set_directory(start);
        }
        let Some(picked) = picker.blocking_pick_folder() else {
            return Ok(None);
        };
        let picked = picked.into_path().map_err(|e| e.to_string())?;
        let path = validate_directory(&picked.to_string_lossy())?;
        approve(&app, &path)?;
        Ok(Some(path.to_string_lossy().into_owned()))
    }
    #[cfg(mobile)]
    {
        let _ = (app, window, default_path);
        Err("a Backup Directory can only be chosen on desktop".into())
    }
}

/// Approve a typed Backup Directory after the author confirms it in a native
/// dialog. Resolves to `false` when the author declines.
#[tauri::command]
pub async fn request_backup_directory<R: Runtime>(
    app: AppHandle<R>,
    window: tauri::WebviewWindow<R>,
    path: String,
    locale: String,
) -> Result<bool, String> {
    let path = validate_directory(&path)?;
    if is_approved(&app_approval_dir(&app)?, &path) {
        grant(&app, &path)?;
        return Ok(true);
    }
    #[cfg(desktop)]
    {
        use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

        let [title, message, ok, cancel] = confirmation_text(&locale, &path);
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
        approve(&app, &path)?;
        Ok(true)
    }
    #[cfg(mobile)]
    {
        let _ = (window, locale);
        Err("a Backup Directory can only be chosen on desktop".into())
    }
}

/// Grant the approved Backup Directory again, without asking. Fails with
/// `BACKUP_DIRECTORY_NOT_APPROVED` for any other path.
#[tauri::command]
pub fn restore_backup_directory<R: Runtime>(app: AppHandle<R>, path: String) -> Result<(), String> {
    let path = validate_directory(&path)?;
    if !is_approved(&app_approval_dir(&app)?, &path) {
        return Err(NOT_APPROVED.into());
    }
    grant(&app, &path)
}

/// Drop the approval when the author goes back to the default directory. The
/// current session keeps its grant; the next launch does not restore it.
#[tauri::command]
pub fn forget_backup_directory<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    clear_approval(&app_approval_dir(&app)?).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("maibuk-backup-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[cfg(unix)]
    #[test]
    fn accepts_absolute_folders() {
        assert_eq!(
            validate_directory("/mnt/backups"),
            Ok(PathBuf::from("/mnt/backups"))
        );
        assert_eq!(
            validate_directory("  /mnt/my backups/ "),
            Ok(PathBuf::from("/mnt/my backups/"))
        );
    }

    #[cfg(windows)]
    #[test]
    fn accepts_absolute_folders() {
        assert!(validate_directory(r"C:\Backups").is_ok());
        assert!(validate_directory(r"\\server\share\backups").is_ok());
    }

    #[test]
    fn rejects_relative_home_root_and_parent_paths() {
        for path in ["", "backups", "~/Backups", "./backups", "/", "/mnt/../etc"] {
            assert_eq!(validate_directory(path), Err(INVALID), "{path:?}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn scopes_a_symlinked_folder_under_its_real_path_too() {
        let dir = temp_dir("symlink");
        let real = dir.join("real");
        std::fs::create_dir_all(&real).unwrap();
        let link = dir.join("link");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        let real = std::fs::canonicalize(&real).unwrap();

        assert_eq!(scope_paths(&link), vec![link.clone(), real.clone()]);
        assert_eq!(
            scope_paths(&link.join("new")),
            vec![link.join("new"), real.join("new")]
        );
        assert_eq!(scope_paths(&real), vec![real.clone()]);
        assert_eq!(
            scope_paths(Path::new("/does/not/exist")),
            vec![PathBuf::from("/does/not/exist")]
        );

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn keeps_the_approval_outside_the_config_directory() {
        let config = Path::new("/home/a/.config/com.massick.maibuk");
        let dir = approval_dir(config).unwrap();

        assert_eq!(dir, Path::new("/home/a/.config/com.massick.maibuk.trusted"));
        assert!(!dir.starts_with(config));
    }

    #[test]
    fn approves_only_the_recorded_directory() {
        let dir = temp_dir("approve");

        assert!(!is_approved(&dir, Path::new("/mnt/backups")));
        write_approval(&dir, Path::new("/mnt/backups")).unwrap();

        assert!(is_approved(&dir, Path::new("/mnt/backups")));
        assert!(is_approved(&dir, Path::new("/mnt/backups/")));
        assert!(!is_approved(&dir, Path::new("/mnt/other")));
        assert!(!is_approved(&dir, Path::new("/mnt/backups/nested")));

        write_approval(&dir, Path::new("/mnt/other")).unwrap();
        assert!(!is_approved(&dir, Path::new("/mnt/backups")));
        assert!(is_approved(&dir, Path::new("/mnt/other")));

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn forgets_the_approval_and_tolerates_forgetting_twice() {
        let dir = temp_dir("forget");
        write_approval(&dir, Path::new("/mnt/backups")).unwrap();

        clear_approval(&dir).unwrap();
        clear_approval(&dir).unwrap();

        assert!(!is_approved(&dir, Path::new("/mnt/backups")));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn treats_a_corrupt_approval_as_none() {
        let dir = temp_dir("corrupt");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(APPROVAL_FILE), "SQLite format 3\0").unwrap();

        assert_eq!(read_approval(&dir), None);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn names_the_path_in_both_languages() {
        let path = Path::new("/mnt/backups");

        let [title, message, ok, _] = confirmation_text("en", path);
        assert_eq!(title, "Use this folder for Backups?");
        assert!(message.contains("/mnt/backups"));
        assert_eq!(ok, "Use folder");

        let [title, message, ok, _] = confirmation_text("es-ES", path);
        assert_eq!(title, "¿Usar esta carpeta para las copias de seguridad?");
        assert!(message.contains("/mnt/backups"));
        assert_eq!(ok, "Usar carpeta");
    }

    /// The security property end to end, on a mock app with the real fs
    /// plugin: nothing is granted without an approval, the approved folder is,
    /// and the approval file stays forbidden even inside a granted folder.
    #[cfg(target_os = "linux")]
    #[test]
    fn grants_only_approved_directories_and_never_the_approval() {
        let home = temp_dir("scope");
        std::fs::create_dir_all(&home).unwrap();
        // app_config_dir() resolves under XDG_CONFIG_HOME (the mock app has no
        // identifier, so it is that folder itself); keep it off the real home.
        std::env::set_var("XDG_CONFIG_HOME", home.join("config"));
        let app = tauri::test::mock_builder()
            .plugin(tauri_plugin_fs::init())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let handle = app.handle().clone();
        protect_approval(&handle).unwrap();
        let scope = handle.fs_scope();
        let backups = home.join("backups");

        assert_eq!(
            restore_backup_directory(handle.clone(), backups.to_string_lossy().into()),
            Err(NOT_APPROVED.to_string())
        );
        assert!(!scope.is_allowed(backups.join("maibuk-backup.sql")));

        approve(&handle, &backups).unwrap();
        restore_backup_directory(handle.clone(), backups.to_string_lossy().into()).unwrap();
        assert!(scope.is_allowed(backups.join("maibuk-backup.sql")));
        assert!(!scope.is_allowed(backups.join("nested").join("file")));

        // A folder the author approved that contains the approval directory.
        approve(&handle, &home).unwrap();
        let approval = app_approval_dir(&handle).unwrap().join(APPROVAL_FILE);
        assert!(approval.starts_with(&home), "{approval:?}");
        assert!(!scope.is_allowed(&approval));
        assert!(scope.is_forbidden(&approval));

        forget_backup_directory(handle.clone()).unwrap();
        assert_eq!(
            restore_backup_directory(handle, home.to_string_lossy().into()),
            Err(NOT_APPROVED.to_string())
        );
        std::fs::remove_dir_all(&home).unwrap();
    }
}
