/// Grant the fs scope access to a Backup directory the author typed. A folder
/// chosen in the dialog is already scoped by the dialog plugin; this makes a
/// typed path usable too, and the persisted-scope plugin keeps the grant
/// across launches.
#[tauri::command]
pub fn allow_backup_directory(app: tauri::AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_fs::FsExt;
    app.fs_scope()
        .allow_directory(&path, false)
        .map_err(|error| error.to_string())
}
