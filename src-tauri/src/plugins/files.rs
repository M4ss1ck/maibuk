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
//!
//! A Plugin File Save (ADR 0040) is the write side: the native dialog picks a
//! place, the host streams the bytes into a sibling `.part` file, and one rename
//! puts it in place. A save that fails partway never destroys the file the
//! author chose to replace. On Android the picker always creates a new
//! document, so there is no existing file to protect and the save writes that
//! open file in place. Either way the webview holds only a token.

use std::borrow::Cow;
use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};

use serde::{Deserialize, Serialize};

/// The app data file the grant record lives in, next to the other device-local
/// Plugin records.
#[cfg_attr(mobile, allow(dead_code))]
pub const GRANTS_FILE: &str = "plugin-file-grants.json";

/// Largest byte range one read returns: the Plugin message cap (4 MB) with room
/// for the reply envelope, the same limit `FILE_READ_MAX_BYTES` sets on the
/// TypeScript side (`src/plugin-sdk/protocol.ts`).
#[cfg_attr(mobile, allow(dead_code))]
pub const MAX_READ_BYTES: u32 = 4 * 1024 * 1024 - 64 * 1024;

/// A gone or unknown grant's prefix; `file-missing` on the TypeScript side.
#[cfg_attr(mobile, allow(dead_code))]
const FILE_MISSING: &str = "file-missing";
/// Bad arguments' prefix; `invalid-params` on the TypeScript side.
const INVALID_PARAMS: &str = "invalid-params";
/// A failure of Maibuk's own device-local record, never the Plugin's fault.
const INTERNAL_ERROR: &str = "internal-error";

#[cfg_attr(mobile, allow(dead_code))]
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
///
/// On desktop `path` is a canonical file path. On Android it is the
/// `content://` URI of a document the picker handed over with a persisted read
/// permission, which is the only handle that survives a restart there; `name`
/// keeps the display name, because a document URI does not carry it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GrantRecord {
    plugin_id: String,
    grant_id: String,
    path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    /// The size the pick reported. A provider that streams a document reports
    /// none on a later `stat`, and this stands in for it then; desktop leaves
    /// it out, because a file's own metadata is authoritative there.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(not(target_os = "android"), allow(dead_code))]
    size: Option<u64>,
}

/// The size a `stat` reports for a document: the provider's own when it
/// reports one, else the size the pick recorded, else 0 for a document nobody
/// can read any more.
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
fn stat_size(reported: Option<u64>, recorded: Option<u64>) -> u64 {
    reported.or(recorded).unwrap_or(0)
}

impl GrantRecord {
    /// The name a Plugin sees: the stored display name, else the path's own.
    fn display_name(&self) -> String {
        self.name
            .clone()
            .unwrap_or_else(|| file_name(Path::new(&self.path)))
    }
}

/// What `files.pick` returns and `files.list` lists: a live grant, named and
/// sized. The name is the file's own name, never its folder.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(mobile, allow(dead_code))]
pub struct GrantInfo {
    pub grant: String,
    pub name: String,
    pub size: u64,
}

/// What `files.stat` reads without opening the file's bytes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(mobile, allow(dead_code))]
pub struct GrantStat {
    pub name: String,
    pub size: u64,
    /// Milliseconds since the Unix epoch.
    pub modified: u64,
}

/// The File Grants this device holds, per Plugin. Loaded from `path` on first
/// use and written back after every change, so grants survive a restart while
/// staying out of the Library.
#[cfg_attr(mobile, allow(dead_code))]
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

#[cfg_attr(mobile, allow(dead_code))]
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
        self.grant_key(plugin_id, key, None, None, name, metadata.len())
    }

    #[cfg_attr(not(target_os = "android"), allow(dead_code))]
    /// Grants the Android document `uri` to `plugin_id` under its display
    /// `name`, returning the grant this Plugin already holds for the same
    /// document instead of a second one. The caller has already taken the
    /// persisted read permission the URI needs after a restart.
    pub fn grant_document(
        &self,
        plugin_id: &str,
        uri: &str,
        name: &str,
        size: u64,
    ) -> Result<GrantInfo, String> {
        validate_plugin_id(plugin_id)?;
        if uri.is_empty() {
            return Err(file_missing("the picked document has no address"));
        }
        self.grant_key(
            plugin_id,
            uri.to_string(),
            Some(name.to_string()),
            Some(size),
            name.to_string(),
            size,
        )
    }

    /// The record write both kinds of grant share: reuse this Plugin's grant
    /// for `key`, else mint one and persist it before handing it out.
    fn grant_key(
        &self,
        plugin_id: &str,
        key: String,
        stored_name: Option<String>,
        stored_size: Option<u64>,
        name: String,
        size: u64,
    ) -> Result<GrantInfo, String> {
        let mut slot = self.records()?;
        let records = slot.as_mut().expect("records() loads the record");
        if let Some(existing) = records
            .iter_mut()
            .find(|record| record.plugin_id == plugin_id && record.path == key)
        {
            let grant = existing.grant_id.clone();
            // A document renamed or grown since the last pick shows what the
            // new pick saw; a record that cannot be rewritten still names the
            // right document.
            let changed = existing.name != stored_name || existing.size != stored_size;
            if stored_name.is_some() && changed {
                existing.name = stored_name;
                existing.size = stored_size;
                let _ = self.save(records);
            }
            return Ok(GrantInfo { grant, name, size });
        }
        let grant = new_grant_id();
        records.push(GrantRecord {
            plugin_id: plugin_id.to_string(),
            grant_id: grant.clone(),
            path: key,
            name: stored_name,
            size: stored_size,
        });
        // A record Maibuk could not write must not be granted: the grant would
        // vanish on the next launch.
        if let Err(error) = self.save(records) {
            let _ = records.pop();
            return Err(error);
        }
        Ok(GrantInfo { grant, name, size })
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
        self.read_range_with(plugin_id, grant, offset, length, |path| {
            std::fs::File::open(path)
        })
    }

    /// `read_range` through `open`, which turns the record's path into an open
    /// file: a plain open on desktop, a content resolver open on Android.
    pub fn read_range_with<F>(
        &self,
        plugin_id: &str,
        grant: &str,
        offset: u64,
        length: u32,
        open: impl FnOnce(&str) -> std::io::Result<F>,
    ) -> Result<Vec<u8>, String>
    where
        F: Read + Seek,
    {
        if length > MAX_READ_BYTES {
            return Err(invalid_params(&format!(
                "a read is capped at {MAX_READ_BYTES} bytes"
            )));
        }
        let record = self.record_for(plugin_id, grant)?;
        let gone = |_| file_missing("the file behind this File Grant is gone or unreadable");
        let file = open(&record.path).map_err(gone)?;
        read_from(file, offset, length).map_err(gone)
    }

    /// The grant's name, size, and last-modified time, without reading its
    /// bytes. A file that moved or was deleted is `file-missing`, which is how a
    /// Shelf marks a Missing Document.
    pub fn stat(&self, plugin_id: &str, grant: &str) -> Result<GrantStat, String> {
        let path = PathBuf::from(self.record_for(plugin_id, grant)?.path);
        let metadata = std::fs::metadata(&path)
            .map_err(|_| file_missing("the file behind this File Grant is gone or unreadable"))?;
        Ok(GrantStat {
            name: file_name(&path),
            size: metadata.len(),
            modified: modified_ms(&metadata),
        })
    }

    /// Ends one grant. A file that is already gone still ends here: the author
    /// removed the Document from the Shelf. Returns the paths no grant names
    /// any more, so Android can give their read permission back.
    pub fn release(&self, plugin_id: &str, grant: &str) -> Result<Vec<String>, String> {
        validate_plugin_id(plugin_id)?;
        if grant.is_empty() {
            return Err(invalid_params("the File Grant id is empty"));
        }
        self.remove_where(|record| record.plugin_id == plugin_id && record.grant_id == grant)
            .and_then(|(removed, orphaned)| {
                if removed == 0 {
                    Err(file_missing("this Plugin holds no such File Grant"))
                } else {
                    Ok(orphaned)
                }
            })
    }

    /// Every live grant the Plugin holds. A file that is gone is still listed,
    /// with size 0, so the author can locate it again.
    pub fn list(&self, plugin_id: &str) -> Result<Vec<GrantInfo>, String> {
        self.list_with(plugin_id, |record| {
            std::fs::metadata(&record.path)
                .map(|metadata| metadata.len())
                .ok()
        })
    }

    /// `list` with `size_of` reading each record's size, `None` when it is
    /// gone. It gets the whole record, since a document provider may report no
    /// size at all and the size the pick recorded stands in for it. The record
    /// lock is not held while `size_of` runs, since on Android it asks the
    /// content resolver.
    pub fn list_with(
        &self,
        plugin_id: &str,
        size_of: impl Fn(&GrantRecord) -> Option<u64>,
    ) -> Result<Vec<GrantInfo>, String> {
        validate_plugin_id(plugin_id)?;
        let held: Vec<GrantRecord> = {
            let mut slot = self.records()?;
            let records = slot.as_mut().expect("records() loads the record");
            records
                .iter()
                .filter(|record| record.plugin_id == plugin_id)
                .cloned()
                .collect()
        };
        Ok(held
            .into_iter()
            .map(|record| GrantInfo {
                name: record.display_name(),
                size: size_of(&record).unwrap_or(0),
                grant: record.grant_id,
            })
            .collect())
    }

    /// Ends every grant the Plugin holds, and no other Plugin's. Returns the
    /// paths no grant names any more.
    pub fn clear_plugin(&self, plugin_id: &str) -> Result<Vec<String>, String> {
        validate_plugin_id(plugin_id)?;
        self.remove_where(|record| record.plugin_id == plugin_id)
            .map(|(_, orphaned)| orphaned)
    }

    /// Ends every File Grant on this device. Returns every path it held.
    pub fn clear_all(&self) -> Result<Vec<String>, String> {
        self.remove_where(|_| true).map(|(_, orphaned)| orphaned)
    }

    #[cfg_attr(not(target_os = "android"), allow(dead_code))]
    /// Whether any Plugin's grant names `path`.
    pub fn holds(&self, path: &str) -> bool {
        self.records()
            .map(|mut slot| {
                slot.as_mut()
                    .expect("records() loads the record")
                    .iter()
                    .any(|record| record.path == path)
            })
            .unwrap_or(false)
    }

    #[cfg_attr(not(target_os = "android"), allow(dead_code))]
    /// Whether any grant names a document inside `prefix`, a tree or a folder
    /// URI: a record path that is `prefix` followed by `/`.
    pub fn holds_under(&self, prefix: &str) -> bool {
        self.records()
            .map(|mut slot| {
                slot.as_mut()
                    .expect("records() loads the record")
                    .iter()
                    .any(|record| {
                        record
                            .path
                            .strip_prefix(prefix)
                            .is_some_and(|rest| rest.starts_with('/'))
                    })
            })
            .unwrap_or(false)
    }

    /// The record behind (plugin_id, grant). A grant of another Plugin is
    /// unknown here, so it reports the same `file-missing` as an id that never
    /// existed.
    fn record_for(&self, plugin_id: &str, grant: &str) -> Result<GrantRecord, String> {
        validate_plugin_id(plugin_id)?;
        if grant.is_empty() {
            return Err(invalid_params("the File Grant id is empty"));
        }
        let mut slot = self.records()?;
        let records = slot.as_mut().expect("records() loads the record");
        records
            .iter()
            .find(|record| record.plugin_id == plugin_id && record.grant_id == grant)
            .cloned()
            .ok_or_else(|| file_missing("this Plugin holds no such File Grant"))
    }

    /// Drops every record `matches` picks and saves, returning how many went
    /// and the paths that no remaining record names. Two Plugins can hold the
    /// same document, and Android's read permission is the app's, so it may
    /// only be given back once the last grant on it ends. A record that cannot
    /// be written back is restored, so a failed release changes nothing.
    fn remove_where(
        &self,
        matches: impl Fn(&GrantRecord) -> bool,
    ) -> Result<(usize, Vec<String>), String> {
        let mut slot = self.records()?;
        let records = slot.as_mut().expect("records() loads the record");
        let (removed, kept): (Vec<GrantRecord>, Vec<GrantRecord>) =
            records.iter().cloned().partition(|record| matches(record));
        self.save(&kept)?;
        *records = kept;
        let mut orphaned: Vec<String> = removed
            .iter()
            .map(|record| record.path.clone())
            .filter(|path| !records.iter().any(|record| &record.path == path))
            .collect();
        orphaned.sort();
        orphaned.dedup();
        Ok((removed.len(), orphaned))
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

/// The paths the OS named in the most recent drop on the window, as the only
/// paths the webview may turn into File Grants: a path Rust never saw in that
/// drop is one the webview invented. Replacing them on every drop keeps a file
/// dropped long ago from being granted after a newer drop.
#[cfg_attr(mobile, allow(dead_code))]
#[derive(Default)]
pub struct LastDrop(Mutex<Vec<PathBuf>>);

#[cfg_attr(mobile, allow(dead_code))]
impl LastDrop {
    /// Replaces the remembered paths with the ones the newest drop carried.
    pub fn remember(&self, paths: Vec<PathBuf>) {
        *self.lock() = paths;
    }

    /// Grants the dropped files the webview names to `plugin_id`, in request
    /// order, never a file the last drop did not carry: naming one refuses the
    /// whole request and mints nothing. A remembered folder and a file that is
    /// gone or unreadable are left out, because a grant names one readable file.
    /// A Plugin that already holds a grant for a file gets that grant back.
    pub fn grant_dropped(
        &self,
        store: &GrantStore,
        plugin_id: &str,
        paths: &[String],
    ) -> Result<Vec<GrantInfo>, String> {
        validate_plugin_id(plugin_id)?;
        // The request is checked whole before a grant is minted, so a path the
        // drop never carried grants nothing of the ones it did.
        let remembered = self.lock().clone();
        for path in paths {
            if !remembered.iter().any(|seen| seen == Path::new(path)) {
                return Err(invalid_params("this path is not part of the last drop"));
            }
        }
        let mut grants = Vec::with_capacity(paths.len());
        for path in paths {
            // A folder, a file that is gone, and a refused grant leave a gap in
            // the reply; a failure of Maibuk's own record still reports.
            match store.grant(plugin_id, Path::new(path)) {
                Ok(info) => grants.push(info),
                Err(error) if error.starts_with(FILE_MISSING) => {}
                Err(error) => return Err(error),
            }
        }
        Ok(grants)
    }

    fn lock(&self) -> MutexGuard<'_, Vec<PathBuf>> {
        // A poisoned lock still holds the drop: there is nothing to undo.
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// One save in progress: the handle the bytes go to, plus how the save puts
/// them in place. Every field stays in Rust.
struct PendingSave {
    file: std::fs::File,
    finish: Finish,
}

/// How a save finishes. A desktop save writes a sibling `.part` file that one
/// rename swaps in. An Android save writes the document in place, because the
/// picker created it and there is no earlier file to protect.
enum Finish {
    #[cfg_attr(mobile, allow(dead_code))]
    Rename {
        part: PathBuf,
        target: PathBuf,
    },
    InPlace,
}

/// The Plugin File Saves this device is writing right now, by token. A token
/// names one save to the webview; the paths never cross IPC. A desktop save
/// goes through a sibling `.part` file; an Android save writes its document in
/// place.
#[derive(Default)]
pub struct SaveStore {
    saves: Mutex<HashMap<u64, PendingSave>>,
}

/// The header that names a save on each raw write.
const SAVE_TOKEN_HEADER: &str = "x-save-token";

/// Tokens only move up, so no save ever reuses another's.
static NEXT_SAVE_TOKEN: AtomicU64 = AtomicU64::new(0);

impl SaveStore {
    fn lock(&self) -> MutexGuard<'_, HashMap<u64, PendingSave>> {
        // A poisoned lock still holds the saves: there is nothing to undo.
        self.saves
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Opens the `.part` file beside `target` and keeps it until a commit or an
    /// abort. The target itself is untouched until the commit.
    #[cfg_attr(mobile, allow(dead_code))]
    fn begin(&self, target: PathBuf) -> Result<u64, String> {
        let part = part_path(&target);
        let file = match std::fs::File::create(&part) {
            Ok(file) => file,
            Err(error) => {
                let _ = std::fs::remove_file(&part);
                return Err(error.to_string());
            }
        };
        let token = NEXT_SAVE_TOKEN.fetch_add(1, Ordering::Relaxed);
        self.lock().insert(
            token,
            PendingSave {
                file,
                finish: Finish::Rename { part, target },
            },
        );
        Ok(token)
    }

    /// Keeps an already-open file until a commit or an abort, for a platform
    /// whose picker hands back a handle and no path to rename.
    #[cfg_attr(not(mobile), allow(dead_code))]
    fn begin_in_place(&self, file: std::fs::File) -> u64 {
        let token = NEXT_SAVE_TOKEN.fetch_add(1, Ordering::Relaxed);
        self.lock().insert(
            token,
            PendingSave {
                file,
                finish: Finish::InPlace,
            },
        );
        token
    }

    /// Appends one chunk. A failed write ends the save: a part is removed, and
    /// an in-place document is emptied, so a half-written file never looks
    /// finished.
    fn write(&self, token: u64, bytes: &[u8]) -> Result<(), String> {
        let mut saves = self.lock();
        let Some(save) = saves.get_mut(&token) else {
            return Err(invalid_params("this save has no open file"));
        };
        if let Err(error) = save.file.write_all(bytes) {
            let save = saves.remove(&token).expect("the save was just found");
            match save.finish {
                Finish::Rename { part, .. } => {
                    let _ = std::fs::remove_file(&part);
                }
                Finish::InPlace => {
                    let _ = save.file.set_len(0);
                }
            }
            return Err(error.to_string());
        }
        Ok(())
    }

    /// Finishes the save: the bytes reach the disk, then either the part takes
    /// the target's place or the in-place document is closed. A failed rename
    /// removes the part and leaves the old file whole.
    fn commit(&self, token: u64) -> Result<(), String> {
        let Some(save) = self.lock().remove(&token) else {
            return Err(invalid_params("this save has no open file"));
        };
        match save.finish {
            Finish::Rename { part, target } => {
                commit_save(save.file, &part, &target).map_err(|error| {
                    let _ = std::fs::remove_file(&part);
                    error.to_string()
                })
            }
            Finish::InPlace => commit_in_place(save.file).map_err(|error| error.to_string()),
        }
    }

    /// Gives up the save: the part goes and the target keeps what it had, while
    /// an in-place document is emptied.
    fn abort(&self, token: u64) -> Result<(), String> {
        let Some(save) = self.lock().remove(&token) else {
            return Err(invalid_params("this save has no open file"));
        };
        match save.finish {
            Finish::Rename { part, .. } => {
                abort_save(save.file, &part).map_err(|error| error.to_string())
            }
            Finish::InPlace => {
                abort_in_place(save.file);
                Ok(())
            }
        }
    }
}

/// The sibling a save writes before it replaces `target`: the target's own name
/// with `.part` appended, so the rename never crosses a file system.
#[cfg_attr(mobile, allow(dead_code))]
fn part_path(target: &Path) -> PathBuf {
    let mut name = target
        .file_name()
        .map(|name| name.to_os_string())
        .unwrap_or_default();
    name.push(".part");
    target.with_file_name(name)
}

/// Ends a save: the bytes reach the disk, then one rename puts the part in the
/// target's place. A failure leaves the target file whole.
fn commit_save(mut file: std::fs::File, part: &Path, target: &Path) -> std::io::Result<()> {
    file.flush()?;
    file.sync_all()?;
    drop(file);
    std::fs::rename(part, target)
}

/// Gives up a save: drop the handle, then remove the part. A part that is
/// already gone is the state this asks for.
fn abort_save(file: std::fs::File, part: &Path) -> std::io::Result<()> {
    drop(file);
    match std::fs::remove_file(part) {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error),
        _ => Ok(()),
    }
}

/// Ends an in-place save: the bytes reach the document, then the handle closes.
/// A failed flush empties the document and returns the error. A content
/// provider can hand out a pipe, where there is nothing to sync, so the
/// `InvalidInput` and `Unsupported` a sync reports for one are ignored; every
/// other sync failure empties the document and is returned too, so no
/// half-written document looks finished.
fn commit_in_place(mut file: std::fs::File) -> std::io::Result<()> {
    if let Err(error) = file.flush() {
        let _ = file.set_len(0);
        return Err(error);
    }
    if let Err(error) = file.sync_all() {
        match error.kind() {
            std::io::ErrorKind::InvalidInput | std::io::ErrorKind::Unsupported => {}
            _ => {
                let _ = file.set_len(0);
                return Err(error);
            }
        }
    }
    drop(file);
    Ok(())
}

/// Gives up an in-place save: empty the document, so no half-written file looks
/// finished, then drop the handle.
fn abort_in_place(file: std::fs::File) {
    let _ = file.set_len(0);
    drop(file);
}

/// Up to `length` bytes of `file` from `offset`: shorter past the end, empty
/// at or past it. A file that cannot seek, such as a pipe a cloud document
/// provider hands over, reads and drops the bytes before `offset` instead.
fn read_from(mut file: impl Read + Seek, offset: u64, length: u32) -> std::io::Result<Vec<u8>> {
    if file.seek(SeekFrom::Start(offset)).is_err() {
        let skipped = std::io::copy(&mut (&mut file).take(offset), &mut std::io::sink())?;
        if skipped < offset {
            return Ok(Vec::new());
        }
    }
    let mut bytes = Vec::new();
    file.take(u64::from(length)).read_to_end(&mut bytes)?;
    Ok(bytes)
}

/// Whether every extension is lowercase letters and digits, 1 to 16 long: the
/// shape a dialog filter takes, and nothing that could widen what it shows.
#[cfg_attr(mobile, allow(dead_code))]
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

#[cfg_attr(mobile, allow(dead_code))]
fn validate_plugin_id(plugin_id: &str) -> Result<(), String> {
    if plugin_id.is_empty() {
        return Err(invalid_params("the Plugin id is empty"));
    }
    Ok(())
}

/// The file's own name, never its folder.
#[cfg_attr(mobile, allow(dead_code))]
fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// Milliseconds since the Unix epoch; 0 when the platform reports no time.
#[cfg_attr(mobile, allow(dead_code))]
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
#[cfg_attr(mobile, allow(dead_code))]
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

/// What `files.pickFolder` returns: the folder's own name, never its path, and
/// one grant per matching file in it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderPick {
    pub folder: String,
    pub grants: Vec<GrantInfo>,
}

/// Every regular file under `root`, in any subfolder, whose extension (ignoring
/// case) is one of `extensions`, sorted by full path. Walks with an explicit
/// stack and `symlink_metadata`, so a symbolic link to a file or a folder is
/// neither followed nor returned, and a link back to an ancestor cannot loop.
/// An entry that cannot be read is skipped.
#[cfg_attr(mobile, allow(dead_code))]
fn matching_files(root: &Path, extensions: &[String]) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let mut folders = vec![root.to_path_buf()];
    while let Some(folder) = folders.pop() {
        let Ok(entries) = std::fs::read_dir(&folder) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(metadata) = std::fs::symlink_metadata(&path) else {
                continue;
            };
            if metadata.is_dir() {
                folders.push(path);
            } else if metadata.is_file() {
                let matches = path
                    .extension()
                    .map(|ext| ext.to_string_lossy().to_lowercase())
                    .is_some_and(|ext| extensions.contains(&ext));
                if matches {
                    found.push(path);
                }
            }
        }
    }
    found.sort();
    found
}

/// The tree a Storage Access Framework child URI sits under:
/// `content://<authority>/tree/<treeId>/document/<docId>` gives
/// `content://<authority>/tree/<treeId>`. None for any other shape, including a
/// document URI with no tree.
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
pub fn tree_uri_of(uri: &str) -> Option<&str> {
    let tree = uri.find("/tree/")?;
    let document = uri.find("/document/")?;
    // The tree id must be non-empty and lie wholly before the document part.
    (document > tree + "/tree/".len()).then(|| &uri[..document])
}

/// Open Maibuk's file dialog filtered to `extensions` and grant the author's
/// pick to `plugin_id`. Resolves to `None` when the author cancels. The path
/// stays in Rust: the webview only ever sees a grant id.
#[cfg(desktop)]
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

/// Open Maibuk's folder dialog and grant every file in the picked folder, and
/// its subfolders, whose extension is one of `extensions`, to `plugin_id`.
/// Resolves to `None` when the author cancels. A file that vanishes between the
/// walk and its grant is left out; any other grant failure fails the pick.
#[cfg(desktop)]
#[tauri::command]
pub async fn plugin_files_pick_folder<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    window: tauri::WebviewWindow<R>,
    state: tauri::State<'_, GrantStore>,
    plugin_id: String,
    extensions: Vec<String>,
) -> Result<Option<FolderPick>, String> {
    use tauri_plugin_dialog::DialogExt;

    validate_extensions(&extensions)?;
    let Some(picked) = app
        .dialog()
        .file()
        .set_parent(&window)
        .blocking_pick_folder()
    else {
        return Ok(None);
    };
    let folder = picked
        .into_path()
        .map_err(|_| file_missing("the picked folder is not on this device"))?;
    let mut grants: Vec<GrantInfo> = Vec::new();
    for path in matching_files(&folder, &extensions) {
        match state.grant(&plugin_id, &path) {
            Ok(info) => {
                if !grants.iter().any(|seen| seen.grant == info.grant) {
                    grants.push(info);
                }
            }
            Err(error) if error.starts_with(FILE_MISSING) => {}
            Err(error) => return Err(error),
        }
    }
    Ok(Some(FolderPick {
        folder: file_name(&folder),
        grants,
    }))
}

/// Grant the files the author dropped on the window to `plugin_id`. The webview
/// names the paths, and Rust mints a grant only for a path its own drop handler
/// saw, so a Plugin can read what the author dropped and never a path it made
/// up. A file already held keeps its grant; a folder and a file that is gone
/// are left out. The paths stay in Rust: the webview only ever sees grant ids.
#[cfg(desktop)]
#[tauri::command]
pub fn plugin_files_drop(
    state: tauri::State<'_, GrantStore>,
    last_drop: tauri::State<'_, LastDrop>,
    plugin_id: String,
    paths: Vec<String>,
) -> Result<Vec<GrantInfo>, String> {
    last_drop.grant_dropped(&state, &plugin_id, &paths)
}

/// Read a byte range through a grant. The bytes cross as raw IPC, so the
/// webview receives an `ArrayBuffer`.
#[cfg(desktop)]
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
#[cfg(desktop)]
#[tauri::command]
pub fn plugin_files_stat(
    state: tauri::State<'_, GrantStore>,
    plugin_id: String,
    grant: String,
) -> Result<GrantStat, String> {
    state.stat(&plugin_id, &grant)
}

/// End one grant.
#[cfg(desktop)]
#[tauri::command]
pub fn plugin_files_release(
    state: tauri::State<'_, GrantStore>,
    plugin_id: String,
    grant: String,
) -> Result<(), String> {
    state.release(&plugin_id, &grant).map(drop)
}

/// Every live grant the Plugin holds on this device.
#[cfg(desktop)]
#[tauri::command]
pub fn plugin_files_list(
    state: tauri::State<'_, GrantStore>,
    plugin_id: String,
) -> Result<Vec<GrantInfo>, String> {
    state.list(&plugin_id)
}

/// End every grant the Plugin holds, and no other Plugin's.
#[cfg(desktop)]
#[tauri::command]
pub fn plugin_files_clear_plugin(
    state: tauri::State<'_, GrantStore>,
    plugin_id: String,
) -> Result<(), String> {
    state.clear_plugin(&plugin_id).map(drop)
}

/// End every File Grant on this device.
#[cfg(desktop)]
#[tauri::command]
pub fn plugin_files_clear_all(state: tauri::State<'_, GrantStore>) -> Result<(), String> {
    state.clear_all().map(drop)
}

/// File Grants on Android (ADR 0036). The system document picker
/// (`ACTION_OPEN_DOCUMENT`) hands over a `content://` URI, and Maibuk takes a
/// persisted read permission on it, so a Shelf still opens the document after a
/// restart. The URI stays in Rust like a desktop path does: the webview only
/// ever sees a grant id. The Kotlin half is `FileGrantsPlugin` in the Android
/// project; the bytes come through the `fs` plugin's content resolver open, so
/// they never cross the Kotlin bridge.
#[cfg(target_os = "android")]
pub mod android {
    use super::{
        file_missing, internal_error, stat_size, tree_uri_of, validate_extensions,
        validate_plugin_id, FolderPick, GrantInfo, GrantStat, GrantStore,
    };
    use serde::{Deserialize, Serialize};
    use tauri::plugin::{Builder, PluginHandle, TauriPlugin};
    use tauri::{AppHandle, Manager, Runtime};

    /// The Kotlin plugin's package and class.
    const KOTLIN_PACKAGE: &str = "com.massick.maibuk";
    const KOTLIN_CLASS: &str = "FileGrantsPlugin";

    /// The handle to the Kotlin document picker and resolver.
    pub struct Documents<R: Runtime>(PluginHandle<R>);

    impl<R: Runtime> Documents<R> {
        /// Name, size, and last-modified time from the content resolver, with
        /// no bytes read. A provider that streams a document reports no size,
        /// which the answer leaves out; a revoked permission and a deleted
        /// document both fail.
        fn stat(&self, uri: &str) -> Result<StatAnswer, String> {
            self.0
                .run_mobile_plugin::<StatAnswer>("stat", UriArgs { uri })
                .map_err(|_| file_missing("the file behind this File Grant is gone or unreadable"))
        }

        /// Gives the persisted read permission on `uri` back to the system.
        /// Best-effort: a permission already gone has nothing to give back.
        fn release(&self, uri: &str) {
            let _ = self
                .0
                .run_mobile_plugin::<serde_json::Value>("release", UriArgs { uri });
        }

        /// Gives back the permission of each URI no grant needs any more. A
        /// folder pick's documents carry no permission of their own: the tree
        /// they were picked under does. So that tree is released too, once no
        /// grant names a document inside it.
        fn release_all(&self, grants: &GrantStore, uris: &[String]) {
            for uri in uris {
                self.release(uri);
            }
            let mut trees: Vec<&str> = uris.iter().filter_map(|uri| tree_uri_of(uri)).collect();
            trees.sort_unstable();
            trees.dedup();
            for tree in trees {
                if !grants.holds_under(tree) {
                    self.release(tree);
                }
            }
        }
    }

    /// Registers the Kotlin half. A Tauri plugin with no commands of its own:
    /// the webview reaches it only through the `plugin_files_*` commands below.
    pub fn init<R: Runtime>() -> TauriPlugin<R> {
        Builder::new("maibuk-file-grants")
            .setup(|app, api| {
                let handle = api.register_android_plugin(KOTLIN_PACKAGE, KOTLIN_CLASS)?;
                app.manage(Documents(handle));
                Ok(())
            })
            .build()
    }

    #[derive(Serialize)]
    struct PickArgs {
        extensions: Vec<String>,
    }

    /// The folder picker's answer: no folder when the author cancelled, else
    /// the folder's name and every matching document in it.
    #[derive(Deserialize)]
    struct PickedFolder {
        /// The picked tree's URI, which holds the persisted read permission;
        /// absent on cancel.
        #[serde(default)]
        tree: Option<String>,
        /// Set when the walk failed after the tree was picked.
        #[serde(default)]
        error: Option<String>,
        #[serde(default)]
        folder: Option<String>,
        #[serde(default)]
        documents: Vec<PickedDocument>,
    }

    #[derive(Deserialize)]
    struct PickedDocument {
        uri: String,
        #[serde(default)]
        name: String,
        #[serde(default)]
        size: u64,
    }

    #[derive(Serialize)]
    struct UriArgs<'a> {
        uri: &'a str,
    }

    /// The picker's answer: no URI when the author cancelled.
    #[derive(Deserialize)]
    struct Picked {
        uri: Option<String>,
        #[serde(default)]
        name: String,
        #[serde(default)]
        size: u64,
    }

    /// The resolver's `stat` answer: `size` is absent when the provider reports
    /// none, which a streaming document provider does.
    #[derive(Deserialize)]
    struct StatAnswer {
        #[serde(default)]
        name: String,
        #[serde(default)]
        size: Option<u64>,
        #[serde(default)]
        modified: u64,
    }

    fn documents<R: Runtime>(app: &AppHandle<R>) -> Result<tauri::State<'_, Documents<R>>, String> {
        app.try_state::<Documents<R>>()
            .ok_or_else(|| internal_error("the document picker is not available"))
    }

    /// Open the system document picker filtered to `extensions` and grant the
    /// author's pick to `plugin_id`. Resolves to `None` when the author cancels.
    #[tauri::command]
    pub async fn plugin_files_pick<R: Runtime>(
        app: AppHandle<R>,
        plugin_id: String,
        extensions: Vec<String>,
    ) -> Result<Option<GrantInfo>, String> {
        validate_extensions(&extensions)?;
        validate_plugin_id(&plugin_id)?;
        let handle = documents(&app)?.0.clone();
        // The call waits for the author, so it waits off the async workers.
        let picked = tauri::async_runtime::spawn_blocking(move || {
            handle.run_mobile_plugin::<Picked>("pick", PickArgs { extensions })
        })
        .await
        .map_err(|_| internal_error("the document picker stopped"))?
        .map_err(|_| internal_error("the document picker failed"))?;
        let Some(uri) = picked.uri else {
            return Ok(None);
        };
        let grants = app.state::<GrantStore>();
        let granted = grants.grant_document(&plugin_id, &uri, &picked.name, picked.size);
        // A grant that could not be recorded must not keep the permission.
        if granted.is_err() && !grants.holds(&uri) {
            documents(&app)?.release(&uri);
        }
        granted.map(Some)
    }

    /// Open the system folder picker and grant every document under the picked
    /// folder, in any subfolder, whose extension is one of `extensions`, to
    /// `plugin_id`. Resolves to `None` when the author cancels. Kotlin walks the
    /// tree and hands back each match; the tree's own read permission is what
    /// the grants rely on, and it is given back when nothing is granted.
    #[tauri::command]
    pub async fn plugin_files_pick_folder<R: Runtime>(
        app: AppHandle<R>,
        plugin_id: String,
        extensions: Vec<String>,
    ) -> Result<Option<FolderPick>, String> {
        validate_extensions(&extensions)?;
        validate_plugin_id(&plugin_id)?;
        let handle = documents(&app)?.0.clone();
        // The call waits for the author and the walk, so it waits off the async
        // workers.
        let picked = tauri::async_runtime::spawn_blocking(move || {
            handle.run_mobile_plugin::<PickedFolder>("pickFolder", PickArgs { extensions })
        })
        .await
        .map_err(|_| internal_error("the folder picker stopped"))?
        .map_err(|_| internal_error("the folder picker failed"))?;
        let Some(tree) = picked.tree.clone() else {
            return Ok(None);
        };
        let grants = app.state::<GrantStore>();
        // The tree's permission stays only while a grant lives under it: an
        // earlier pick of this folder may hold some, so the check runs here.
        let release_unheld_tree = || {
            if !grants.holds_under(&tree) {
                if let Ok(documents) = documents(&app) {
                    documents.release(&tree);
                }
            }
        };
        if picked.error.is_some() {
            release_unheld_tree();
            return Err(internal_error("the picked folder could not be read"));
        }
        let folder = picked.folder.unwrap_or_default();
        let mut held: Vec<GrantInfo> = Vec::new();
        let mut failure = None;
        for document in &picked.documents {
            match grants.grant_document(&plugin_id, &document.uri, &document.name, document.size) {
                Ok(info) => {
                    if !held.iter().any(|seen| seen.grant == info.grant) {
                        held.push(info);
                    }
                }
                Err(error) => {
                    failure = Some(error);
                    break;
                }
            }
        }
        if let Some(error) = failure {
            // A document this pick could not grant keeps no permission; the
            // tree it sat under goes too, unless another grant still needs it.
            let orphaned: Vec<String> = picked
                .documents
                .iter()
                .map(|document| document.uri.clone())
                .filter(|uri| !grants.holds(uri))
                .collect();
            documents(&app)?.release_all(&grants, &orphaned);
            release_unheld_tree();
            return Err(error);
        }
        release_unheld_tree();
        Ok(Some(FolderPick {
            folder,
            grants: held,
        }))
    }

    /// Read a byte range through a grant, opening the document through the
    /// content resolver. The bytes cross as raw IPC. The open and the read both
    /// block on the system, and the invoke handler runs inline, so they run on
    /// the blocking pool instead of holding an async worker or the bridge.
    #[tauri::command]
    pub async fn plugin_files_read<R: Runtime>(
        app: AppHandle<R>,
        plugin_id: String,
        grant: String,
        offset: u64,
        length: u32,
    ) -> Result<tauri::ipc::Response, String> {
        let bytes = tauri::async_runtime::spawn_blocking(
            move || -> Result<Vec<u8>, String> {
                use tauri_plugin_fs::{FilePath, FsExt, OpenOptions};

                let grants = app.state::<GrantStore>();
                grants.read_range_with(&plugin_id, &grant, offset, length, |uri| {
                    let url = tauri::Url::parse(uri).map_err(|error| {
                        std::io::Error::new(std::io::ErrorKind::InvalidInput, error)
                    })?;
                    let mut options = OpenOptions::new();
                    options.read(true);
                    app.fs().open(FilePath::Url(url), options)
                })
            },
        )
        .await
        .map_err(|_| internal_error("the read stopped"))??;
        Ok(tauri::ipc::Response::new(bytes))
    }

    /// The grant's name, size, and last-modified time.
    #[tauri::command]
    pub async fn plugin_files_stat<R: Runtime>(
        app: AppHandle<R>,
        plugin_id: String,
        grant: String,
    ) -> Result<GrantStat, String> {
        let record = app.state::<GrantStore>().record_for(&plugin_id, &grant)?;
        let answer = documents(&app)?.stat(&record.path)?;
        Ok(GrantStat {
            name: answer.name,
            // A provider that reports no size leaves the pick's in place.
            size: stat_size(answer.size, record.size),
            modified: answer.modified,
        })
    }

    /// End one grant, and give the read permission back once no grant names
    /// the document.
    #[tauri::command]
    pub async fn plugin_files_release<R: Runtime>(
        app: AppHandle<R>,
        plugin_id: String,
        grant: String,
    ) -> Result<(), String> {
        let grants = app.state::<GrantStore>();
        let orphaned = grants.release(&plugin_id, &grant)?;
        documents(&app)?.release_all(&grants, &orphaned);
        Ok(())
    }

    /// Every live grant the Plugin holds; a document that is gone lists with
    /// size 0, and one whose provider reports no size keeps the pick's.
    #[tauri::command]
    pub async fn plugin_files_list<R: Runtime>(
        app: AppHandle<R>,
        plugin_id: String,
    ) -> Result<Vec<GrantInfo>, String> {
        let documents = documents(&app)?;
        app.state::<GrantStore>().list_with(&plugin_id, |record| {
            documents
                .stat(&record.path)
                .ok()
                .map(|answer| stat_size(answer.size, record.size))
        })
    }

    /// End every grant the Plugin holds, and no other Plugin's.
    #[tauri::command]
    pub async fn plugin_files_clear_plugin<R: Runtime>(
        app: AppHandle<R>,
        plugin_id: String,
    ) -> Result<(), String> {
        let grants = app.state::<GrantStore>();
        let orphaned = grants.clear_plugin(&plugin_id)?;
        documents(&app)?.release_all(&grants, &orphaned);
        Ok(())
    }

    /// End every File Grant on this device.
    #[tauri::command]
    pub async fn plugin_files_clear_all<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
        let grants = app.state::<GrantStore>();
        let orphaned = grants.clear_all()?;
        documents(&app)?.release_all(&grants, &orphaned);
        Ok(())
    }
}

/// Open the native save dialog prefilled with `name`, filtered to its own
/// extension, then open the file the Plugin's bytes will fill: the sibling
/// `.part` file on desktop, the document the picker created on Android.
/// Resolves to `None` when the author cancels; the chosen path never leaves
/// Rust, and on desktop the target file is untouched until the commit.
#[tauri::command]
pub async fn plugin_files_save_begin<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    window: tauri::WebviewWindow<R>,
    state: tauri::State<'_, SaveStore>,
    name: String,
) -> Result<Option<u64>, String> {
    use tauri_plugin_dialog::DialogExt;

    let extension = Path::new(&name)
        .extension()
        .map(|extension| extension.to_string_lossy().to_lowercase())
        .filter(|extension| !extension.is_empty());
    #[cfg(mobile)]
    let _ = &window;
    let mut picker = app.dialog().file().set_file_name(&name);
    #[cfg(desktop)]
    {
        picker = picker.set_parent(&window);
    }
    if let Some(extension) = extension.as_deref() {
        picker = picker.add_filter(extension.to_uppercase(), &[extension]);
    }
    let Some(picked) = picker.blocking_save_file() else {
        return Ok(None);
    };
    // A desktop dialog hands back a path to write beside; Android hands back
    // the document its picker just created, which the save writes in place.
    #[cfg(desktop)]
    {
        let target = picked
            .into_path()
            .map_err(|_| internal_error("the chosen place is not a path on this device"))?;
        state.begin(target).map(Some)
    }
    #[cfg(mobile)]
    {
        use tauri_plugin_fs::{FsExt, OpenOptions};

        // Write, truncate and create, no read and no append: Android turns
        // that into the mode "wt", which is all a freshly created document
        // needs.
        let mut options = OpenOptions::new();
        options.write(true).truncate(true).create(true);
        let file = app
            .fs()
            .open(picked, options)
            .map_err(|_| internal_error("the chosen document could not be opened"))?;
        Ok(Some(state.begin_in_place(file)))
    }
}

/// What one save write carries: the bytes, and the save token when the JSON
/// body names it. `None` means the token must come from the request header.
#[derive(Debug)]
struct SaveWrite<'a> {
    token: Option<u64>,
    bytes: Cow<'a, [u8]>,
}

/// Reads a save write's token and bytes from either body shape. The raw path is
/// the desktop one and is borrowed untouched; the JSON path is Android's and
/// decodes its base64 `data` string. Anything else is `invalid-params`.
fn save_write_body(body: &tauri::ipc::InvokeBody) -> Result<SaveWrite<'_>, String> {
    use base64::Engine as _;

    match body {
        tauri::ipc::InvokeBody::Raw(bytes) => Ok(SaveWrite {
            token: None,
            bytes: Cow::Borrowed(bytes),
        }),
        tauri::ipc::InvokeBody::Json(value) => {
            let object = value
                .as_object()
                .ok_or_else(|| invalid_params("a save write's JSON body must be an object"))?;
            let data = object
                .get("data")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| {
                    invalid_params("a save write's JSON body needs a base64 \"data\" string")
                })?;
            let token =
                match object.get("token") {
                    None => None,
                    Some(value) => Some(value.as_u64().ok_or_else(|| {
                        invalid_params("a save write's JSON token must be a number")
                    })?),
                };
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(data)
                .map_err(|_| invalid_params("a save write's JSON data is not base64"))?;
            Ok(SaveWrite {
                token,
                bytes: Cow::Owned(bytes),
            })
        }
    }
}

/// Append one chunk to the save `token` names. Desktop sends the bytes as raw
/// IPC, so the body is not parsed and the webview never holds the file's path.
/// Android never delivers `InvokeBody::Raw`, so there the chunk arrives as JSON
/// `{"token": n, "data": "<base64>"}`: the token travels in the body when the
/// header is missing too, and the base64 decodes here before the bytes reach
/// the store. A malformed body is `invalid-params`.
#[tauri::command]
pub fn plugin_files_save_write(
    state: tauri::State<'_, SaveStore>,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    let write = save_write_body(request.body())?;
    let token = request
        .headers()
        .get(SAVE_TOKEN_HEADER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .or(write.token)
        .ok_or_else(|| invalid_params("the save token header is missing"))?;
    state.write(token, &write.bytes)
}

/// Put the finished part in the target's place.
#[tauri::command]
pub fn plugin_files_save_commit(
    state: tauri::State<'_, SaveStore>,
    token: u64,
) -> Result<(), String> {
    state.commit(token)
}

/// Give the save up: the part goes and the target keeps what it had.
#[tauri::command]
pub fn plugin_files_save_abort(
    state: tauri::State<'_, SaveStore>,
    token: u64,
) -> Result<(), String> {
    state.abort(token)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

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
    fn releasing_an_empty_grant_is_invalid_params() {
        let dir = temp_dir("release-empty");
        let store = store_in(&dir);

        let error = store.release("tracer", "").unwrap_err();

        assert!(error.starts_with("invalid-params:"), "{error}");
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

    /// A dropped path as the webview names it.
    fn dropped(path: &Path) -> String {
        path.to_string_lossy().into_owned()
    }

    #[test]
    fn grants_a_file_the_last_drop_named() {
        let dir = temp_dir("drop");
        let path = file_in(&dir, "book.pdf", b"contents");
        let store = store_in(&dir);
        let last_drop = LastDrop::default();
        last_drop.remember(vec![path.clone()]);

        let grants = last_drop
            .grant_dropped(&store, "tracer", &[dropped(&path)])
            .unwrap();

        assert_eq!(grants.len(), 1);
        assert_eq!(
            grants[0].name, "book.pdf",
            "the name is the file's own name"
        );
        assert_eq!(grants[0].size, 8);
        assert_eq!(grants, store.list("tracer").unwrap());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn refuses_a_path_the_last_drop_never_named() {
        let dir = temp_dir("drop-unknown");
        let path = file_in(&dir, "book.pdf", b"contents");
        let absent = dir.join("invented.pdf");
        let store = store_in(&dir);
        let last_drop = LastDrop::default();
        last_drop.remember(vec![path.clone()]);

        // Naming one file the drop did not carry refuses the whole request, so
        // no grant is minted for the file it did.
        let error = last_drop
            .grant_dropped(&store, "tracer", &[dropped(&path), dropped(&absent)])
            .unwrap_err();
        assert!(error.starts_with("invalid-params:"), "{error}");
        assert!(store.list("tracer").unwrap().is_empty());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn refuses_a_path_from_an_earlier_drop() {
        let dir = temp_dir("drop-earlier");
        let first = file_in(&dir, "first.pdf", b"a");
        let second = file_in(&dir, "second.pdf", b"b");
        let store = store_in(&dir);
        let last_drop = LastDrop::default();
        last_drop.remember(vec![first.clone()]);
        last_drop.remember(vec![second.clone()]);

        let error = last_drop
            .grant_dropped(&store, "tracer", &[dropped(&first)])
            .unwrap_err();
        assert!(error.starts_with("invalid-params:"), "{error}");
        assert!(store.list("tracer").unwrap().is_empty());

        // The drop the window saw last still grants.
        let grants = last_drop
            .grant_dropped(&store, "tracer", &[dropped(&second)])
            .unwrap();
        assert_eq!(grants.len(), 1);
        assert_eq!(grants[0].name, "second.pdf");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn re_dropping_a_held_file_returns_the_same_grant() {
        let dir = temp_dir("drop-again");
        let path = file_in(&dir, "book.pdf", b"contents");
        let store = store_in(&dir);
        let last_drop = LastDrop::default();

        last_drop.remember(vec![path.clone()]);
        let first = last_drop
            .grant_dropped(&store, "tracer", &[dropped(&path)])
            .unwrap();
        last_drop.remember(vec![path.clone()]);
        let again = last_drop
            .grant_dropped(&store, "tracer", &[dropped(&path)])
            .unwrap();

        assert_eq!(first[0].grant, again[0].grant);
        assert_eq!(store.list("tracer").unwrap().len(), 1);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn leaves_out_a_remembered_directory() {
        let dir = temp_dir("drop-directory");
        let first = file_in(&dir, "a.pdf", b"a");
        let second = file_in(&dir, "b.pdf", b"b");
        let store = store_in(&dir);
        let last_drop = LastDrop::default();
        // A folder dragged along with the files says nothing a grant can read.
        last_drop.remember(vec![dir.clone(), first.clone(), second.clone()]);

        let grants = last_drop
            .grant_dropped(
                &store,
                "tracer",
                &[dropped(&dir), dropped(&first), dropped(&second)],
            )
            .unwrap();

        let names: Vec<&str> = grants.iter().map(|info| info.name.as_str()).collect();
        assert_eq!(names, ["a.pdf", "b.pdf"], "the files keep request order");
        assert_eq!(store.list("tracer").unwrap().len(), 2);
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

    #[test]
    fn a_part_is_a_sibling_with_part_appended() {
        assert_eq!(
            part_path(Path::new("/home/author/map.png")),
            Path::new("/home/author/map.png.part")
        );
        assert_eq!(
            part_path(Path::new("map.svg")),
            Path::new("map.svg.part"),
            "a relative target keeps its folder"
        );
    }

    #[test]
    fn a_commit_puts_the_part_in_the_targets_place() {
        let dir = temp_dir("save-commit");
        let target = file_in(&dir, "map.png", b"old");
        let part = part_path(&target);
        let mut file = std::fs::File::create(&part).unwrap();
        file.write_all(b"new").unwrap();

        commit_save(file, &part, &target).unwrap();

        assert_eq!(std::fs::read(&target).unwrap(), b"new");
        assert!(
            !part.exists(),
            "the part is gone once it took the target's place"
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn an_abort_removes_the_part_and_leaves_the_target_intact() {
        let dir = temp_dir("save-abort");
        let target = file_in(&dir, "map.png", b"old");
        let part = part_path(&target);
        let mut file = std::fs::File::create(&part).unwrap();
        file.write_all(b"half").unwrap();

        abort_save(file, &part).unwrap();

        assert!(!part.exists(), "a failed save leaves no part");
        assert_eq!(
            std::fs::read(&target).unwrap(),
            b"old",
            "the target still holds what it held"
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn an_abort_of_a_part_that_is_already_gone_is_fine() {
        let dir = temp_dir("save-abort-gone");
        let part = dir.join("map.png.part");
        let file = std::fs::File::create(&part).unwrap();
        std::fs::remove_file(&part).unwrap();

        abort_save(file, &part).unwrap();
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_save_store_writes_every_chunk_then_commits() {
        let dir = temp_dir("save-store");
        let target = dir.join("map.png");
        let store = SaveStore::default();

        let token = store.begin(target.clone()).unwrap();
        // The target is untouched while the bytes are still in flight.
        assert!(!target.exists());
        store.write(token, b"0123").unwrap();
        store.write(token, b"4567").unwrap();
        store.commit(token).unwrap();

        assert_eq!(std::fs::read(&target).unwrap(), b"01234567");
        assert!(!part_path(&target).exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_json_save_write_carries_its_token_and_decoded_bytes() {
        let body = tauri::ipc::InvokeBody::Json(json!({ "token": 12, "data": "aGVsbG8=" }));

        let write = save_write_body(&body).unwrap();

        assert_eq!(write.token, Some(12));
        assert_eq!(&*write.bytes, b"hello");
    }

    #[test]
    fn a_json_save_write_without_a_token_leaves_it_to_the_header() {
        let body = tauri::ipc::InvokeBody::Json(json!({ "data": "aGVsbG8=" }));

        let write = save_write_body(&body).unwrap();

        assert_eq!(write.token, None);
        assert_eq!(&*write.bytes, b"hello");
    }

    #[test]
    fn a_json_save_write_appends_the_decoded_bytes_to_its_save() {
        let dir = temp_dir("save-json");
        let target = dir.join("map.png");
        let store = SaveStore::default();
        let token = store.begin(target.clone()).unwrap();

        let body = tauri::ipc::InvokeBody::Json(json!({ "data": "MDEyMw==" }));
        let write = save_write_body(&body).unwrap();
        store.write(token, &write.bytes).unwrap();
        store.commit(token).unwrap();

        assert_eq!(std::fs::read(&target).unwrap(), b"0123");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_json_save_write_refuses_bad_base64() {
        let body = tauri::ipc::InvokeBody::Json(json!({ "data": "not base64!" }));

        let error = save_write_body(&body).unwrap_err();

        assert!(error.starts_with("invalid-params:"), "{error}");
    }

    #[test]
    fn a_json_save_write_refuses_the_wrong_shape() {
        for value in [
            json!({}),
            json!({ "data": 7 }),
            json!({ "data": "aGVsbG8=", "token": "seven" }),
            json!(["aGVsbG8="]),
        ] {
            let body = tauri::ipc::InvokeBody::Json(value);
            let error = save_write_body(&body).unwrap_err();
            assert!(error.starts_with("invalid-params:"), "{error}");
        }
    }

    #[test]
    fn a_raw_save_write_still_carries_its_bytes() {
        let body = tauri::ipc::InvokeBody::Raw(b"raw bytes".to_vec());

        let write = save_write_body(&body).unwrap();

        assert_eq!(write.token, None);
        assert_eq!(&*write.bytes, b"raw bytes");
    }

    #[test]
    fn a_save_store_begin_leaves_an_existing_target_alone() {
        let dir = temp_dir("save-existing");
        let target = file_in(&dir, "map.png", b"old");
        let store = SaveStore::default();

        let token = store.begin(target.clone()).unwrap();

        assert_eq!(
            std::fs::read(&target).unwrap(),
            b"old",
            "the target is untouched until the commit"
        );
        assert!(part_path(&target).exists());
        store.abort(token).unwrap();
        assert!(!part_path(&target).exists());
        assert_eq!(std::fs::read(&target).unwrap(), b"old");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_save_store_refuses_a_token_it_does_not_hold() {
        let store = SaveStore::default();

        let write = store.write(404, b"abc").unwrap_err();
        assert!(write.starts_with("invalid-params:"), "{write}");
        let commit = store.commit(404).unwrap_err();
        assert!(commit.starts_with("invalid-params:"), "{commit}");
        let abort = store.abort(404).unwrap_err();
        assert!(abort.starts_with("invalid-params:"), "{abort}");
    }

    #[test]
    fn a_commit_or_abort_ends_its_token() {
        let dir = temp_dir("save-ended");
        let target = dir.join("map.png");
        let store = SaveStore::default();

        let token = store.begin(target).unwrap();
        store.commit(token).unwrap();
        assert!(store.commit(token).is_err(), "a committed save is gone");
        assert!(store.abort(token).is_err());

        let token = store.begin(dir.join("other.png")).unwrap();
        store.abort(token).unwrap();
        assert!(
            store.write(token, b"late").is_err(),
            "an aborted save is gone"
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn an_in_place_save_writes_every_chunk_then_commits() {
        let dir = temp_dir("save-in-place");
        let path = dir.join("map.png");
        let store = SaveStore::default();

        let token = store.begin_in_place(std::fs::File::create(&path).unwrap());
        store.write(token, b"0123").unwrap();
        store.write(token, b"4567").unwrap();
        store.commit(token).unwrap();

        assert_eq!(std::fs::read(&path).unwrap(), b"01234567");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn an_in_place_abort_empties_the_file_and_ends_the_token() {
        let dir = temp_dir("save-in-place-abort");
        let path = dir.join("map.png");
        let store = SaveStore::default();

        let token = store.begin_in_place(std::fs::File::create(&path).unwrap());
        store.write(token, b"half").unwrap();
        store.abort(token).unwrap();

        assert_eq!(
            std::fs::read(&path).unwrap(),
            b"",
            "a half-written file is emptied, never left looking finished"
        );
        let again = store.commit(token).unwrap_err();
        assert!(again.starts_with("invalid-params:"), "{again}");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn an_in_place_commit_refuses_a_token_it_does_not_hold() {
        let dir = temp_dir("save-in-place-unknown");
        let path = dir.join("map.png");
        let store = SaveStore::default();
        let token = store.begin_in_place(std::fs::File::create(&path).unwrap());

        let error = store.commit(token + 1).unwrap_err();
        assert!(error.starts_with("invalid-params:"), "{error}");

        // The save the store does hold still commits.
        store.commit(token).unwrap();
        std::fs::remove_dir_all(&dir).unwrap();
    }

    // Android document grants: the record holds a content URI and its display
    // name, and the bytes come through an opener the platform supplies.

    const BOOK_URI: &str = "content://com.android.providers.downloads.documents/document/42";

    #[test]
    fn grants_a_document_under_its_display_name_and_size() {
        let store = GrantStore::in_memory();

        let info = store
            .grant_document("tracer", BOOK_URI, "Moby Dick.epub", 1234)
            .unwrap();

        assert_eq!(info.name, "Moby Dick.epub");
        assert_eq!(info.size, 1234);
        assert_eq!(info.grant.len(), 32);
        let listed = store.list_with("tracer", |_| Some(99)).unwrap();
        assert_eq!(listed.len(), 1);
        // The list shows the stored name, never the URI's last segment.
        assert_eq!(listed[0].name, "Moby Dick.epub");
        assert_eq!(listed[0].size, 99);
    }

    #[test]
    fn picking_the_same_document_again_returns_the_same_grant_with_its_new_name() {
        let dir = temp_dir("document-repick");
        let store = store_in(&dir);
        let first = store
            .grant_document("tracer", BOOK_URI, "draft.pdf", 10)
            .unwrap();

        let again = store
            .grant_document("tracer", BOOK_URI, "final.pdf", 12)
            .unwrap();

        assert_eq!(again.grant, first.grant);
        assert_eq!(again.name, "final.pdf");
        assert_eq!(
            store_in(&dir).list_with("tracer", |_| None).unwrap()[0].name,
            "final.pdf"
        );
        // Another Plugin picking it gets a grant of its own.
        let other = store
            .grant_document("other", BOOK_URI, "final.pdf", 12)
            .unwrap();
        assert_ne!(other.grant, first.grant);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn document_grants_survive_a_restart() {
        let dir = temp_dir("document-persist");
        let grant = store_in(&dir)
            .grant_document("tracer", BOOK_URI, "book.epub", 5)
            .unwrap()
            .grant;

        let restarted = store_in(&dir);

        let listed = restarted.list_with("tracer", |_| Some(5)).unwrap();
        assert_eq!(listed[0].grant, grant);
        assert_eq!(listed[0].name, "book.epub");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn refuses_a_document_with_no_address_or_plugin() {
        let store = GrantStore::in_memory();
        let error = store
            .grant_document("tracer", "", "book.pdf", 1)
            .unwrap_err();
        assert!(error.starts_with("file-missing:"), "{error}");
        let error = store
            .grant_document("", BOOK_URI, "book.pdf", 1)
            .unwrap_err();
        assert!(error.starts_with("invalid-params:"), "{error}");
    }

    #[test]
    fn a_record_written_before_names_were_kept_still_loads() {
        let dir = temp_dir("legacy-record");
        let path = file_in(&dir, "book.pdf", b"0123456789");
        let canonical = std::fs::canonicalize(&path).unwrap();
        let legacy = serde_json::json!([
            { "pluginId": "tracer", "grantId": "abc", "path": canonical.to_string_lossy() }
        ]);
        std::fs::write(dir.join(GRANTS_FILE), legacy.to_string()).unwrap();

        let store = store_in(&dir);

        assert_eq!(store.list("tracer").unwrap()[0].name, "book.pdf");
        assert_eq!(store.read_range("tracer", "abc", 2, 3).unwrap(), b"234");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_desktop_record_stays_free_of_a_stored_name_and_size() {
        let dir = temp_dir("no-name-field");
        let path = file_in(&dir, "book.pdf", b"x");
        store_in(&dir).grant("tracer", &path).unwrap();

        let text = std::fs::read_to_string(dir.join(GRANTS_FILE)).unwrap();

        assert!(!text.contains("\"name\""), "{text}");
        assert!(!text.contains("\"size\""), "{text}");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_stat_with_no_size_keeps_the_one_the_pick_recorded() {
        // The provider's own size wins, the pick's stands in for a missing
        // one, and 0 is left for a document nobody can read.
        assert_eq!(stat_size(Some(9), Some(12)), 9);
        assert_eq!(stat_size(None, Some(12)), 12);
        assert_eq!(stat_size(None, None), 0);
    }

    #[test]
    fn a_provider_that_reports_no_size_leaves_the_picked_one_in_the_list() {
        let dir = temp_dir("document-no-size");
        store_in(&dir)
            .grant_document("tracer", BOOK_URI, "streamed.pdf", 4096)
            .unwrap();

        // A fresh store proves the size was written to the record, not kept in
        // memory, and the stat answer carries none.
        let listed = store_in(&dir)
            .list_with("tracer", |record| Some(stat_size(None, record.size)))
            .unwrap();

        assert_eq!(listed[0].size, 4096);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_repick_refreshes_the_recorded_size() {
        let store = GrantStore::in_memory();
        store
            .grant_document("tracer", BOOK_URI, "draft.pdf", 10)
            .unwrap();
        store
            .grant_document("tracer", BOOK_URI, "final.pdf", 12)
            .unwrap();

        let listed = store
            .list_with("tracer", |record| Some(stat_size(None, record.size)))
            .unwrap();

        assert_eq!(listed[0].size, 12);
    }

    #[test]
    fn reads_a_document_through_the_opener_it_is_given() {
        let store = GrantStore::in_memory();
        let grant = store
            .grant_document("tracer", BOOK_URI, "book.pdf", 10)
            .unwrap()
            .grant;

        let mut opened = None;
        let bytes = store
            .read_range_with("tracer", &grant, 3, 4, |uri| {
                opened = Some(uri.to_string());
                Ok(std::io::Cursor::new(b"0123456789".to_vec()))
            })
            .unwrap();

        assert_eq!(bytes, b"3456");
        assert_eq!(opened.as_deref(), Some(BOOK_URI));
        // An opener that fails is a gone document.
        let error = store
            .read_range_with::<std::io::Cursor<Vec<u8>>>("tracer", &grant, 0, 4, |_| {
                Err(std::io::Error::other("permission revoked"))
            })
            .unwrap_err();
        assert!(error.starts_with("file-missing:"), "{error}");
        assert!(!error.contains("revoked"), "{error}");
    }

    /// A reader that refuses to seek, like a pipe a cloud provider hands over.
    struct Pipe(std::io::Cursor<Vec<u8>>);

    impl Read for Pipe {
        fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            self.0.read(buf)
        }
    }

    impl Seek for Pipe {
        fn seek(&mut self, _: SeekFrom) -> std::io::Result<u64> {
            Err(std::io::Error::new(
                std::io::ErrorKind::Unsupported,
                "a pipe",
            ))
        }
    }

    #[test]
    fn a_file_that_cannot_seek_reads_by_skipping() {
        let pipe = || Pipe(std::io::Cursor::new(b"0123456789".to_vec()));

        assert_eq!(read_from(pipe(), 4, 3).unwrap(), b"456");
        assert_eq!(read_from(pipe(), 8, 10).unwrap(), b"89");
        assert!(read_from(pipe(), 10, 4).unwrap().is_empty());
        assert!(read_from(pipe(), 50, 4).unwrap().is_empty());
    }

    #[test]
    fn release_names_a_document_only_once_no_grant_holds_it() {
        let store = GrantStore::in_memory();
        let mine = store
            .grant_document("tracer", BOOK_URI, "b.pdf", 1)
            .unwrap()
            .grant;
        let theirs = store
            .grant_document("other", BOOK_URI, "b.pdf", 1)
            .unwrap()
            .grant;

        // Another Plugin still reads it, so the permission stays.
        assert!(store.release("tracer", &mine).unwrap().is_empty());
        assert!(store.holds(BOOK_URI));

        assert_eq!(
            store.release("other", &theirs).unwrap(),
            vec![BOOK_URI.to_string()]
        );
        assert!(!store.holds(BOOK_URI));
    }

    #[test]
    fn clearing_names_every_document_left_unheld() {
        let store = GrantStore::in_memory();
        let shared = "content://docs/document/shared";
        let own = "content://docs/document/own";
        store.grant_document("tracer", shared, "s.pdf", 1).unwrap();
        store.grant_document("tracer", own, "o.pdf", 1).unwrap();
        store.grant_document("other", shared, "s.pdf", 1).unwrap();

        assert_eq!(store.clear_plugin("tracer").unwrap(), vec![own.to_string()]);
        assert_eq!(store.clear_all().unwrap(), vec![shared.to_string()]);
        assert!(!store.holds(shared));
    }

    #[test]
    fn a_release_that_cannot_be_written_changes_nothing() {
        let dir = temp_dir("unwritable-release");
        let store = store_in(&dir);
        let grant = store
            .grant_document("tracer", BOOK_URI, "b.pdf", 1)
            .unwrap()
            .grant;
        // A folder where the record's temp file goes makes every save fail.
        std::fs::create_dir_all(dir.join(GRANTS_FILE).with_extension("tmp")).unwrap();

        let error = store.release("tracer", &grant).unwrap_err();

        assert!(error.starts_with("internal-error:"), "{error}");
        assert!(store.holds(BOOK_URI));
        assert_eq!(store.list_with("tracer", |_| None).unwrap()[0].grant, grant);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    fn extensions(list: &[&str]) -> Vec<String> {
        list.iter().map(|ext| ext.to_string()).collect()
    }

    fn sorted(mut paths: Vec<PathBuf>) -> Vec<PathBuf> {
        paths.sort();
        paths
    }

    #[test]
    fn matching_files_walks_every_subfolder() {
        let dir = temp_dir("walk-nested");
        std::fs::create_dir_all(dir.join("a/b")).unwrap();
        let top = file_in(&dir, "top.epub", b"x");
        let middle = file_in(&dir.join("a"), "middle.epub", b"x");
        let deep = file_in(&dir.join("a/b"), "deep.epub", b"x");
        file_in(&dir.join("a/b"), "notes.txt", b"x");

        let found = matching_files(&dir, &extensions(&["epub"]));

        assert_eq!(found, sorted(vec![top, middle, deep]));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn matching_files_matches_the_extension_in_any_case() {
        let dir = temp_dir("walk-case");
        let upper = file_in(&dir, "B.EPUB", b"x");
        let mixed = file_in(&dir, "c.EpUb", b"x");

        let found = matching_files(&dir, &extensions(&["epub"]));

        assert_eq!(found, sorted(vec![upper, mixed]));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn matching_files_leaves_out_other_extensions_and_dot_files() {
        let dir = temp_dir("walk-exclude");
        file_in(&dir, "notes.txt", b"x");
        file_in(&dir, "epub", b"x");
        file_in(&dir, ".epub", b"x");
        file_in(&dir, "book.epub.part", b"x");
        let keep = file_in(&dir, "book.epub", b"x");

        let found = matching_files(&dir, &extensions(&["epub"]));

        assert_eq!(found, vec![keep]);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn matching_files_never_follows_or_returns_a_symbolic_link() {
        use std::os::unix::fs::symlink;

        let dir = temp_dir("walk-symlink");
        let real_folder = dir.join("real");
        std::fs::create_dir_all(&real_folder).unwrap();
        let real = file_in(&real_folder, "real.epub", b"x");
        let root_file = file_in(&dir, "root.epub", b"x");
        // A link to a file that looks like a match, a link to a folder that
        // holds one, and a link from inside the folder back to the root.
        symlink(&real, dir.join("file-link.epub")).unwrap();
        symlink(&real_folder, dir.join("folder-link")).unwrap();
        symlink(&dir, real_folder.join("loop")).unwrap();

        let found = matching_files(&dir, &extensions(&["epub"]));

        assert_eq!(found, sorted(vec![root_file, real]));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn matching_files_returns_paths_sorted_by_full_path() {
        let dir = temp_dir("walk-sorted");
        std::fs::create_dir_all(dir.join("z")).unwrap();
        file_in(&dir, "m.epub", b"x");
        file_in(&dir.join("z"), "a.epub", b"x");
        file_in(&dir, "b.epub", b"x");

        let found = matching_files(&dir, &extensions(&["epub"]));

        assert_eq!(found.len(), 3);
        assert_eq!(found, sorted(found.clone()));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn granting_each_matching_file_twice_returns_the_same_grant_ids() {
        let dir = temp_dir("walk-grant");
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        file_in(&dir, "one.epub", b"0123");
        file_in(&dir.join("sub"), "two.EPUB", b"01");
        let store = store_in(&dir);
        let paths = matching_files(&dir, &extensions(&["epub"]));
        assert_eq!(paths.len(), 2);

        let first: Vec<GrantInfo> = paths
            .iter()
            .map(|path| store.grant("tracer", path).unwrap())
            .collect();
        let second: Vec<GrantInfo> = paths
            .iter()
            .map(|path| store.grant("tracer", path).unwrap())
            .collect();

        assert_eq!(first, second);
        assert_eq!(store.list("tracer").unwrap().len(), 2);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_folder_pick_serializes_its_fields_in_camel_case() {
        let pick = FolderPick {
            folder: "Books".to_string(),
            grants: vec![GrantInfo {
                grant: "g1".to_string(),
                name: "a.epub".to_string(),
                size: 3,
            }],
        };

        assert_eq!(
            serde_json::to_value(pick).unwrap(),
            json!({"folder": "Books", "grants": [{"grant": "g1", "name": "a.epub", "size": 3}]})
        );
    }

    #[test]
    fn tree_uri_of_names_the_tree_a_saf_child_sits_under() {
        assert_eq!(
            tree_uri_of("content://auth/tree/primary%3ABooks/document/primary%3ABooks%2Fa.epub"),
            Some("content://auth/tree/primary%3ABooks")
        );
    }

    #[test]
    fn tree_uri_of_is_none_without_a_tree_before_a_document() {
        assert_eq!(tree_uri_of("content://docs/document/x"), None);
        assert_eq!(tree_uri_of("content://docs/tree/t"), None);
        assert_eq!(tree_uri_of("content://docs/document/x/tree/t"), None);
        assert_eq!(tree_uri_of("content://docs/tree//document/x"), None);
    }

    #[test]
    fn holds_under_matches_only_a_document_inside_the_prefix() {
        let store = GrantStore::in_memory();
        store
            .grant_document("tracer", "content://auth/tree/t/document/d1", "a.epub", 1)
            .unwrap();

        assert!(store.holds_under("content://auth/tree/t"));
        // A document is not inside itself, and a tree whose id only starts the
        // same way is a different tree.
        assert!(!store.holds_under("content://auth/tree/t/document/d1"));
        assert!(!store.holds_under("content://auth/tree/tt"));
        assert!(!GrantStore::in_memory().holds_under("content://auth/tree/t"));
    }
}
