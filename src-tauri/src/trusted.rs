//! Directories outside the webview's reach.
//!
//! The fs scope is the desktop webview's only write boundary, so a directory
//! that matters to the app but must not be writable by the webview lives
//! outside every allowed pattern and is recorded in `<app config dir>.trusted`,
//! a sibling of the config directory. That sibling matters: the webview may
//! write anywhere under the config directory, and scope patterns match case
//! sensitively, so a denied file inside it could still be reached through a
//! differently cased path on macOS and Windows (ADR 0010). The Backup
//! Directory (ADR 0010) enters the fs scope through this module; the Plugin
//! Directory (ADR 0020) is forbidden through it and never granted.

use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};
use tauri_plugin_fs::FsExt;

/// A directory that is not an absolute path below a filesystem root.
pub const INVALID: &str = "DIRECTORY_INVALID";

#[derive(Serialize, Deserialize)]
struct Approval {
    path: PathBuf,
}

/// An approved directory must be an absolute path to a folder below a
/// filesystem root. Relative paths and `~` would resolve against the process's
/// working directory, and `..` is rejected by the fs plugin anyway.
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

/// Where an approval lives: a sibling of the app config directory, not inside
/// it (see the module docs).
pub fn approval_dir(config_dir: &Path) -> Option<PathBuf> {
    let name = config_dir.file_name()?.to_str()?;
    Some(config_dir.with_file_name(format!("{name}.trusted")))
}

/// The recorded directory for `file`, or `None` when it is absent or corrupt.
pub fn read_approval(dir: &Path, file: &str) -> Option<PathBuf> {
    let text = std::fs::read_to_string(dir.join(file)).ok()?;
    serde_json::from_str::<Approval>(&text).ok().map(|a| a.path)
}

#[cfg_attr(mobile, allow(dead_code))]
pub fn write_approval(dir: &Path, file: &str, path: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let approval = Approval {
        path: path.to_path_buf(),
    };
    let text = serde_json::to_string(&approval).map_err(std::io::Error::other)?;
    std::fs::write(dir.join(file), text)
}

pub fn clear_approval(dir: &Path, file: &str) -> std::io::Result<()> {
    match std::fs::remove_file(dir.join(file)) {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error),
        _ => Ok(()),
    }
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

/// Deny a directory to the webview recursively, even if a grant would cover
/// it. Runs at setup, before the webview loads.
pub fn forbid_directory<R: Runtime>(app: &AppHandle<R>, path: &Path) -> Result<(), String> {
    let scope = app.fs_scope();
    for path in scope_paths(path) {
        scope
            .forbid_directory(&path, true)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
