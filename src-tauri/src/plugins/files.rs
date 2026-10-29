//! File Grants (ADR 0036). A Plugin asks Maibuk to show its native file dialog,
//! and gets back a grant id with the file's name and size, never a path. It
//! reads the bytes later in ranges through that grant, and only after this
//! module checks the grant names one of its own. Grants live in an app data
//! file, outside the Library, so Backups, Database Files, and Sync never carry
//! them; the webview `fs` scope is never widened (ADR 0010).
//!
//! Nothing here returns a path to the webview: a grant is named by an id, and
//! every error carries one of the two stable prefixes below plus a fixed
//! sentence, so a Plugin can tell a gone file from bad arguments without
//! learning where the file lives.

use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use serde::{Deserialize, Serialize};

/// The app data file the grant record lives in, next to the other device-local
/// Plugin records.
pub const GRANTS_FILE: &str = "plugin-file-grants.json";

/// Largest byte range one read returns: the Plugin message cap (4 MB) with room
/// for the reply envelope, the same limit `FILE_READ_MAX_BYTES` sets on the
/// TypeScript side (`src/plugin-sdk/protocol.ts`).
pub const MAX_READ_BYTES: u32 = 4 * 1024 * 1024 - 64 * 1024;

/// A gone or unknown grant's prefix; `file-missing` on the TypeScript side.
const FILE_MISSING: &str = "file-missing";
/// Bad arguments' prefix; `invalid-params` on the TypeScript side.
const INVALID_PARAMS: &str = "invalid-params";
/// A failure of Maibuk's own device-local record, never the Plugin's fault.
const INTERNAL_ERROR: &str = "internal-error";

fn file_missing(detail: &str) -> String {
    format!("{FILE_MISSING}: {detail}")
}

fn invalid_params(detail: &str) -> String {
    format!("{INVALID_PARAMS}: {detail}")
}

fn internal_error(detail: &str) -> String {
    format!("{INTERNAL_ERROR}: {detail}")
}

/// One persisted grant: the Plugin it belongs to, the id it is named by, and
/// the file it points at. The path never leaves this module.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GrantRecord {
    plugin_id: String,
    grant_id: String,
    path: String,
}

/// What `files.pick` returns and `files.list` lists: a live grant, named and
/// sized. The name is the file's own name, never its folder.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct GrantInfo {
    pub grant: String,
    pub name: String,
    pub size: u64,
}

/// What `files.stat` reads without opening the file's bytes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct GrantStat {
    pub name: String,
    pub size: u64,
    /// Milliseconds since the Unix epoch.
    pub modified: u64,
}

/// The File Grants this device holds, per Plugin. Loaded from `path` on first
/// use and written back after every change, so grants survive a restart while
/// staying out of the Library.
pub struct GrantStore {
    /// The JSON record; `None` keeps grants for this run only, which is what a
    /// device with no app data folder and every test get.
    path: Option<PathBuf>,
    /// Loaded lazily; `None` means "not read from disk yet".
    grants: Mutex<Option<Vec<GrantRecord>>>,
}

impl Default for GrantStore {
    /// No file, so grants last for this run.
    fn default() -> Self {
        Self {
            path: None,
            grants: Mutex::new(None),
        }
    }
}

impl GrantStore {
    /// Keeps grants in `path` across launches.
    pub fn new(path: PathBuf) -> Self {
        Self {
            path: Some(path),
            ..Self::default()
        }
    }

    /// Grants that last for this run only.
    pub fn in_memory() -> Self {
        Self::default()
    }

    /// Grants `path` to `plugin_id`, returning the grant this Plugin already
    /// holds for the same file instead of a second one. The path is
    /// canonicalized first, so picking the same file through another name finds
    /// the grant that exists.
    pub fn grant(&self, plugin_id: &str, path: &Path) -> Result<GrantInfo, String> {
        validate_plugin_id(plugin_id)?;
        // A file the dialog named but that is already gone, and a symlink that
        // leads nowhere, read as gone: the grant would be useless.
        let canonical = std::fs::canonicalize(path)
            .map_err(|_| file_missing("the picked file is gone or unreadable"))?;
        let metadata = std::fs::metadata(&canonical)
            .map_err(|_| file_missing("the picked file is gone or unreadable"))?;
        if !metadata.is_file() {
            return Err(file_missing("the picked entry is not a file"));
        }
        let name = file_name(&canonical);
        let key = canonical.to_string_lossy().into_owned();

        let mut slot = self.records()?;
        let records = slot.as_mut().expect("records() loads the record");
        if let Some(existing) = records
            .iter()
            .find(|record| record.plugin_id == plugin_id && record.path == key)
        {
            return Ok(GrantInfo {
                grant: existing.grant_id.clone(),
                name,
                size: metadata.len(),
            });
        }
        let grant = new_grant_id();
        records.push(GrantRecord {
            plugin_id: plugin_id.to_string(),
            grant_id: grant.clone(),
            path: key,
        });
        // A record Maibuk could not write must not be granted: the grant would
        // vanish on the next launch.
        if let Err(error) = self.save(records) {
            let _ = records.pop();
            return Err(error);
        }
        Ok(GrantInfo {
            grant,
            name,
            size: metadata.len(),
        })
    }

    /// Reads up to `length` bytes from `offset`. A range past the end returns
    /// the bytes that exist: shorter than asked, empty at or past the end.
    pub fn read_range(
        &self,
        plugin_id: &str,
        grant: &str,
        offset: u64,
        length: u32,
    ) -> Result<Vec<u8>, String> {
        if length > MAX_READ_BYTES {
            return Err(invalid_params(&format!(
                "a read is capped at {MAX_READ_BYTES} bytes"
            )));
        }
        let path = self.path_for(plugin_id, grant)?;
        let mut file = std::fs::File::open(&path)
            .map_err(|_| file_missing("the file behind this File Grant is gone or unreadable"))?;
        let size = file
            .metadata()
            .map_err(|_| file_missing("the file behind this File Grant is gone or unreadable"))?
            .len();
        if offset >= size {
            return Ok(Vec::new());
        }
        file.seek(SeekFrom::Start(offset))
            .map_err(|_| file_missing("the file behind this File Grant is gone or unreadable"))?;
        let wanted = u64::from(length).min(size - offset);
        let mut bytes = Vec::with_capacity(wanted as usize);
        file.take(wanted)
            .read_to_end(&mut bytes)
            .map_err(|_| file_missing("the file behind this File Grant is gone or unreadable"))?;
        Ok(bytes)
    }

    /// The grant's name, size, and last-modified time, without reading its
    /// bytes. A file that moved or was deleted is `file-missing`, which is how a
    /// Shelf marks a Missing Document.
    pub fn stat(&self, plugin_id: &str, grant: &str) -> Result<GrantStat, String> {
        let path = self.path_for(plugin_id, grant)?;
        let metadata = std::fs::metadata(&path)
            .map_err(|_| file_missing("the file behind this File Grant is gone or unreadable"))?;
        Ok(GrantStat {
            name: file_name(&path),
            size: metadata.len(),
            modified: modified_ms(&metadata),
        })
    }

    /// Ends one grant. A file that is already gone still ends here: the author
    /// removed the Document from the Shelf.
    pub fn release(&self, plugin_id: &str, grant: &str) -> Result<(), String> {
        validate_plugin_id(plugin_id)?;
        let mut slot = self.records()?;
        let records = slot.as_mut().expect("records() loads the record");
        let before = records.len();
        records.retain(|record| !(record.plugin_id == plugin_id && record.grant_id == grant));
        if records.len() == before {
            return Err(file_missing("this Plugin holds no such File Grant"));
        }
        self.save(records)
    }

    /// Every live grant the Plugin holds. A file that is gone is still listed,
    /// with size 0, so the author can locate it again.
    pub fn list(&self, plugin_id: &str) -> Result<Vec<GrantInfo>, String> {
        validate_plugin_id(plugin_id)?;
        let mut slot = self.records()?;
        let records = slot.as_mut().expect("records() loads the record");
        Ok(records
            .iter()
            .filter(|record| record.plugin_id == plugin_id)
            .map(|record| GrantInfo {
                grant: record.grant_id.clone(),
                name: file_name(Path::new(&record.path)),
                size: std::fs::metadata(&record.path)
                    .map(|metadata| metadata.len())
                    .unwrap_or(0),
            })
            .collect())
    }

    /// Ends every grant the Plugin holds, and no other Plugin's.
    pub fn clear_plugin(&self, plugin_id: &str) -> Result<(), String> {
        validate_plugin_id(plugin_id)?;
        let mut slot = self.records()?;
        let records = slot.as_mut().expect("records() loads the record");
        records.retain(|record| record.plugin_id != plugin_id);
        self.save(records)
    }

    /// Ends every File Grant on this device.
    pub fn clear_all(&self) -> Result<(), String> {
        let mut slot = self.records()?;
        let records = slot.as_mut().expect("records() loads the record");
        records.clear();
        self.save(records)
    }

    /// The file behind (plugin_id, grant). A grant of another Plugin is unknown
    /// here, so it reports the same `file-missing` as an id that never existed.
    fn path_for(&self, plugin_id: &str, grant: &str) -> Result<PathBuf, String> {
        validate_plugin_id(plugin_id)?;
        if grant.is_empty() {
            return Err(invalid_params("the File Grant id is empty"));
        }
        let mut slot = self.records()?;
        let records = slot.as_mut().expect("records() loads the record");
        records
            .iter()
            .find(|record| record.plugin_id == plugin_id && record.grant_id == grant)
            .map(|record| PathBuf::from(&record.path))
            .ok_or_else(|| file_missing("this Plugin holds no such File Grant"))
    }

    /// The record, read from disk the first time anything asks for it.
    fn records(&self) -> Result<MutexGuard<'_, Option<Vec<GrantRecord>>>, String> {
        let mut slot = self.lock();
        if slot.is_none() {
            *slot = Some(self.load());
        }
        Ok(slot)
    }

    fn lock(&self) -> MutexGuard<'_, Option<Vec<GrantRecord>>> {
        // A poisoned lock still holds the record: there is nothing to undo.
        self.grants
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// A missing, unreadable, or garbage file reads as no grants: a record this
    /// app never wrote is one no Plugin may read through.
    fn load(&self) -> Vec<GrantRecord> {
        let Some(path) = self.path.as_ref() else {
            return Vec::new();
        };
        let Ok(text) = std::fs::read_to_string(path) else {
            return Vec::new();
        };
        serde_json::from_str(&text).unwrap_or_default()
    }

    /// Writes the record through a temp file and a rename, so a crash mid-write
    /// leaves the previous record rather than half a file the next launch would
    /// read as empty. An error names no path: the webview reads it.
    fn save(&self, records: &[GrantRecord]) -> Result<(), String> {
        let Some(path) = self.path.as_ref() else {
            return Ok(());
        };
        let unwritable = |error: &dyn std::fmt::Display| {
            internal_error(&format!("the File Grant record is unwritable ({error})"))
        };
        let json = serde_json::to_string_pretty(records).map_err(|error| unwritable(&error))?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| unwritable(&error.kind()))?;
        }
        let temp = path.with_extension("tmp");
        std::fs::write(&temp, json).map_err(|error| unwritable(&error.kind()))?;
        std::fs::rename(&temp, path).map_err(|error| unwritable(&error.kind()))
    }
}

/// Whether every extension is lowercase letters and digits, 1 to 16 long: the
/// shape a dialog filter takes, and nothing that could widen what it shows.
pub fn validate_extensions(extensions: &[String]) -> Result<(), String> {
    for extension in extensions {
        let valid = (1..=16).contains(&extension.len())
            && extension
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit());
        if !valid {
            return Err(invalid_params(
                "an extension is not lowercase letters and digits, 1 to 16 long",
            ));
        }
    }
    Ok(())
}

fn validate_plugin_id(plugin_id: &str) -> Result<(), String> {
    if plugin_id.is_empty() {
        return Err(invalid_params("the Plugin id is empty"));
    }
    Ok(())
}

/// The file's own name, never its folder.
fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// Milliseconds since the Unix epoch; 0 when the platform reports no time.
fn modified_ms(metadata: &std::fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |elapsed| elapsed.as_millis() as u64)
}

/// A fresh 128-bit grant id, hex. No crate: `RandomState` seeds from the OS and
/// advances per value, so a counter and the clock are enough for an id no
/// Plugin needs to predict (the same rule `random_port` follows).
fn new_grant_id() -> String {
    use std::hash::BuildHasher;
    use std::sync::atomic::{AtomicU64, Ordering};

    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let seed = COUNTER.fetch_add(1, Ordering::Relaxed);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_nanos() as u64);
    let state = std::collections::hash_map::RandomState::new();
    let high = state.hash_one((seed, now, 0u8));
    let low = state.hash_one((seed, now, 1u8));
    format!("{high:016x}{low:016x}")
}

/// Open Maibuk's file dialog filtered to `extensions` and grant the author's
/// pick to `plugin_id`. Resolves to `None` when the author cancels. The path
/// stays in Rust: the webview only ever sees a grant id.
#[tauri::command]
pub async fn plugin_files_pick<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    window: tauri::WebviewWindow<R>,
    state: tauri::State<'_, GrantStore>,
    plugin_id: String,
    extensions: Vec<String>,
) -> Result<Option<GrantInfo>, String> {
    use tauri_plugin_dialog::DialogExt;

    validate_extensions(&extensions)?;
    let mut picker = app.dialog().file().set_parent(&window);
    if !extensions.is_empty() {
        let filters: Vec<&str> = extensions.iter().map(String::as_str).collect();
        picker = picker.add_filter("Documents", &filters);
    }
    let Some(picked) = picker.blocking_pick_file() else {
        return Ok(None);
    };
    let path = picked
        .into_path()
        .map_err(|_| file_missing("the picked file is not on this device"))?;
    state.grant(&plugin_id, &path).map(Some)
}

/// Read a byte range through a grant. The bytes cross as raw IPC, so the
/// webview receives an `ArrayBuffer`.
#[tauri::command]
pub fn plugin_files_read(
    state: tauri::State<'_, GrantStore>,
    plugin_id: String,
    grant: String,
    offset: u64,
    length: u32,
) -> Result<tauri::ipc::Response, String> {
    let bytes = state.read_range(&plugin_id, &grant, offset, length)?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// The grant's name, size, and last-modified time; cheap enough for a Shelf.
#[tauri::command]
pub fn plugin_files_stat(
    state: tauri::State<'_, GrantStore>,
    plugin_id: String,
    grant: String,
) -> Result<GrantStat, String> {
    state.stat(&plugin_id, &grant)
}

/// End one grant.
#[tauri::command]
pub fn plugin_files_release(
    state: tauri::State<'_, GrantStore>,
    plugin_id: String,
    grant: String,
) -> Result<(), String> {
    state.release(&plugin_id, &grant)
}

/// Every live grant the Plugin holds on this device.
#[tauri::command]
pub fn plugin_files_list(
    state: tauri::State<'_, GrantStore>,
    plugin_id: String,
) -> Result<Vec<GrantInfo>, String> {
    state.list(&plugin_id)
}

/// End every grant the Plugin holds, and no other Plugin's.
#[tauri::command]
pub fn plugin_files_clear_plugin(
    state: tauri::State<'_, GrantStore>,
    plugin_id: String,
) -> Result<(), String> {
    state.clear_plugin(&plugin_id)
}

/// End every File Grant on this device.
#[tauri::command]
pub fn plugin_files_clear_all(state: tauri::State<'_, GrantStore>) -> Result<(), String> {
    state.clear_all()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fresh folder per test, with the grant record inside it.
    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("maibuk-file-grants-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn store_in(dir: &Path) -> GrantStore {
        GrantStore::new(dir.join(GRANTS_FILE))
    }

    /// The file the tests grant, holding `contents`.
    fn file_in(dir: &Path, name: &str, contents: &[u8]) -> PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, contents).unwrap();
        path
    }

    #[test]
    fn grants_a_file_with_its_name_and_size() {
        let dir = temp_dir("grant");
        let path = file_in(&dir, "book.pdf", b"0123456789");
        let store = store_in(&dir);

        let info = store.grant("tracer", &path).unwrap();

        assert_eq!(info.name, "book.pdf", "the name is the file's own name");
        assert_eq!(info.size, 10);
        assert!(!info.grant.is_empty());
        assert_eq!(store.list("tracer").unwrap(), vec![info]);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn an_unknown_grant_or_another_plugins_grant_is_file_missing() {
        let dir = temp_dir("scope");
        let path = file_in(&dir, "book.pdf", b"contents");
        let store = store_in(&dir);
        let info = store.grant("tracer", &path).unwrap();

        let error = store.read_range("echoes", &info.grant, 0, 4).unwrap_err();
        assert!(error.starts_with("file-missing:"), "{error}");
        assert!(store.stat("echoes", &info.grant).is_err());
        assert!(store.list("echoes").unwrap().is_empty());

        let unknown = store.read_range("tracer", "not-a-grant", 0, 4).unwrap_err();
        assert!(unknown.starts_with("file-missing:"), "{unknown}");

        // The grant still reads for the Plugin that holds it.
        assert_eq!(
            store.read_range("tracer", &info.grant, 0, 3).unwrap(),
            b"con"
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn reads_a_range_and_a_short_read_past_the_end() {
        let dir = temp_dir("range");
        let path = file_in(&dir, "book.pdf", b"0123456789");
        let store = store_in(&dir);
        let grant = store.grant("tracer", &path).unwrap().grant;

        assert_eq!(store.read_range("tracer", &grant, 2, 3).unwrap(), b"234");
        assert_eq!(
            store.read_range("tracer", &grant, 0, 10).unwrap(),
            b"0123456789"
        );
        assert_eq!(
            store.read_range("tracer", &grant, 8, 5).unwrap(),
            b"89",
            "a read past the end returns the bytes that exist"
        );
        assert!(store
            .read_range("tracer", &grant, 10, 5)
            .unwrap()
            .is_empty());
        assert!(store
            .read_range("tracer", &grant, 5_000, 5)
            .unwrap()
            .is_empty());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn refuses_a_read_over_the_message_cap() {
        let dir = temp_dir("cap");
        let path = file_in(&dir, "book.pdf", b"contents");
        let store = store_in(&dir);
        let grant = store.grant("tracer", &path).unwrap().grant;

        let error = store
            .read_range("tracer", &grant, 0, MAX_READ_BYTES + 1)
            .unwrap_err();
        assert!(error.starts_with("invalid-params:"), "{error}");
        assert!(store
            .read_range("tracer", &grant, 0, MAX_READ_BYTES)
            .is_ok());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_missing_file_reads_as_file_missing_and_stays_listed() {
        let dir = temp_dir("missing");
        let path = file_in(&dir, "book.pdf", b"contents");
        let store = store_in(&dir);
        let grant = store.grant("tracer", &path).unwrap().grant;
        std::fs::remove_file(&path).unwrap();

        let read = store.read_range("tracer", &grant, 0, 4).unwrap_err();
        assert!(read.starts_with("file-missing:"), "{read}");
        let stat = store.stat("tracer", &grant).unwrap_err();
        assert!(stat.starts_with("file-missing:"), "{stat}");

        // Still on the Shelf, at size 0, so the author can locate it again.
        assert_eq!(
            store.list("tracer").unwrap(),
            vec![GrantInfo {
                grant,
                name: "book.pdf".into(),
                size: 0
            }]
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn stat_reports_the_name_size_and_last_modified_time() {
        let dir = temp_dir("stat");
        let path = file_in(&dir, "book.epub", b"0123456789");
        let store = store_in(&dir);
        let grant = store.grant("tracer", &path).unwrap().grant;

        let stat = store.stat("tracer", &grant).unwrap();

        assert_eq!(stat.name, "book.epub");
        assert_eq!(stat.size, 10);
        assert!(stat.modified > 0, "a real file has a modification time");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn picking_the_same_file_again_returns_the_same_grant() {
        let dir = temp_dir("re-pick");
        let path = file_in(&dir, "book.pdf", b"contents");
        let store = store_in(&dir);

        let first = store.grant("tracer", &path).unwrap();
        // Another name for the same file: canonicalized, so the grant matches.
        let alias = dir.join(".").join("book.pdf");
        let second = store.grant("tracer", &alias).unwrap();

        assert_eq!(first.grant, second.grant);
        assert_eq!(store.list("tracer").unwrap().len(), 1);

        // A different Plugin gets its own grant for the same file.
        let other = store.grant("echoes", &path).unwrap();
        assert_ne!(first.grant, other.grant);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn grants_survive_a_restart() {
        let dir = temp_dir("persist");
        let path = file_in(&dir, "book.pdf", b"0123456789");
        let grant = {
            let store = store_in(&dir);
            store.grant("tracer", &path).unwrap().grant
        };

        let restarted = store_in(&dir);
        assert_eq!(restarted.list("tracer").unwrap().len(), 1);
        assert_eq!(
            restarted.read_range("tracer", &grant, 0, 4).unwrap(),
            b"0123"
        );

        // Ending a grant survives a restart too.
        restarted.release("tracer", &grant).unwrap();
        assert!(store_in(&dir).list("tracer").unwrap().is_empty());
        // No temp file is left beside the record.
        assert!(!dir.join(GRANTS_FILE).with_extension("tmp").exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn an_in_memory_store_keeps_grants_for_this_run() {
        let dir = temp_dir("memory");
        let path = file_in(&dir, "book.pdf", b"contents");
        let store = GrantStore::in_memory();
        let grant = store.grant("tracer", &path).unwrap().grant;

        assert_eq!(store.read_range("tracer", &grant, 0, 4).unwrap(), b"cont");
        assert!(!dir.join(GRANTS_FILE).exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn release_ends_a_grant() {
        let dir = temp_dir("release");
        let path = file_in(&dir, "book.pdf", b"contents");
        let store = store_in(&dir);
        let grant = store.grant("tracer", &path).unwrap().grant;

        store.release("tracer", &grant).unwrap();

        assert!(store.list("tracer").unwrap().is_empty());
        let error = store.read_range("tracer", &grant, 0, 4).unwrap_err();
        assert!(error.starts_with("file-missing:"), "{error}");
        // Releasing it twice is the same as naming a grant that never existed.
        let again = store.release("tracer", &grant).unwrap_err();
        assert!(again.starts_with("file-missing:"), "{again}");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn clear_plugin_ends_only_that_plugins_grants() {
        let dir = temp_dir("clear-plugin");
        let first = file_in(&dir, "a.pdf", b"a");
        let second = file_in(&dir, "b.pdf", b"b");
        let store = store_in(&dir);
        let tracer = store.grant("tracer", &first).unwrap().grant;
        let echoes = store.grant("echoes", &second).unwrap().grant;

        store.clear_plugin("tracer").unwrap();

        assert!(store.list("tracer").unwrap().is_empty());
        assert!(store.read_range("tracer", &tracer, 0, 1).is_err());
        assert_eq!(store.list("echoes").unwrap().len(), 1);
        assert_eq!(store.read_range("echoes", &echoes, 0, 1).unwrap(), b"b");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn clear_all_ends_every_grant() {
        let dir = temp_dir("clear-all");
        let first = file_in(&dir, "a.pdf", b"a");
        let second = file_in(&dir, "b.pdf", b"b");
        let store = store_in(&dir);
        let tracer = store.grant("tracer", &first).unwrap().grant;
        let echoes = store.grant("echoes", &second).unwrap().grant;

        store.clear_all().unwrap();

        assert!(store.list("tracer").unwrap().is_empty());
        assert!(store.list("echoes").unwrap().is_empty());
        assert!(store.read_range("tracer", &tracer, 0, 1).is_err());
        assert!(store.read_range("echoes", &echoes, 0, 1).is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn refuses_an_empty_plugin_id() {
        let dir = temp_dir("empty-id");
        let path = file_in(&dir, "book.pdf", b"contents");
        let store = store_in(&dir);
        let grant = store.grant("tracer", &path).unwrap().grant;

        let error = store.grant("", &path).unwrap_err();
        assert!(error.starts_with("invalid-params:"), "{error}");
        assert!(store.read_range("", &grant, 0, 1).is_err());
        assert!(store.release("", &grant).is_err());
        assert!(store.list("").is_err());
        assert!(store.clear_plugin("").is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn refuses_a_pick_that_is_not_a_file() {
        let dir = temp_dir("not-a-file");
        let store = store_in(&dir);

        let error = store.grant("tracer", &dir).unwrap_err();
        assert!(error.starts_with("file-missing:"), "{error}");
        let absent = store.grant("tracer", &dir.join("absent.pdf")).unwrap_err();
        assert!(absent.starts_with("file-missing:"), "{absent}");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn validates_a_dialog_filter_extension() {
        assert!(validate_extensions(&[]).is_ok());
        assert!(validate_extensions(&["pdf".into(), "epub".into(), "cbz".into()]).is_ok());
        assert!(validate_extensions(&["a1b2c3d4e5f6g7h8".into()]).is_ok());

        for extension in ["", "PDF", "p df", "p/f", "*.pdf", "a1b2c3d4e5f6g7h8i"] {
            let error = validate_extensions(&[extension.to_string()]).unwrap_err();
            assert!(
                error.starts_with("invalid-params:"),
                "{extension:?}: {error}"
            );
        }
    }

    /// A path a Plugin must never learn, whether in a returned value or in an
    /// error message.
    #[test]
    fn no_output_carries_the_path() {
        let dir = temp_dir("no-path");
        let path = file_in(&dir, "book.pdf", b"0123456789");
        let store = store_in(&dir);
        let grant = store.grant("tracer", &path).unwrap().grant;
        let folder = dir.to_string_lossy().into_owned();

        let outputs = [
            serde_json::to_string(&store.list("tracer").unwrap()).unwrap(),
            serde_json::to_string(&store.stat("tracer", &grant).unwrap()).unwrap(),
            store.read_range("tracer", "other-grant", 0, 4).unwrap_err(),
            store
                .read_range("tracer", &grant, 0, MAX_READ_BYTES + 1)
                .unwrap_err(),
            store.stat("echoes", &grant).unwrap_err(),
            store.release("tracer", "other-grant").unwrap_err(),
            store.grant("tracer", &dir.join("absent.pdf")).unwrap_err(),
            store.grant("", &path).unwrap_err(),
            validate_extensions(&["PDF".into()]).unwrap_err(),
        ];
        for output in outputs {
            assert!(!output.contains(&folder), "{output}");
        }
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
