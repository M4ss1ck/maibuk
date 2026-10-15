//! The OS keychain store for Plugin secrets (ADR 0023). A value lives under the
//! service `app.maibuk.plugins`, one entry per `<pluginId>/<name>`; the keychain
//! cannot enumerate its entries portably, so an index entry holds the names of
//! every Plugin and every index mutation runs behind one lock. Values never
//! leave this module except for a single host-side read.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Mutex, MutexGuard, OnceLock};

use keyring_core::{CredentialStore, Entry, Error as KeyringError};

/// The keychain service every Plugin secret and the index live under.
const SERVICE: &str = "app.maibuk.plugins";
/// The account holding the JSON index of names, per Plugin id.
const INDEX_ACCOUNT: &str = "__index__";

/// A Plugin never names a secret containing a separator, so `pluginId/name`
/// always splits back at the first separator this module encoded.
const NAME_SEPARATOR: char = '/';

/// Names per Plugin id, sorted and deduplicated.
type Index = BTreeMap<String, BTreeSet<String>>;

/// The keychain operations the index needs, so the tests run on a mock store.
trait Keyring: Send + Sync {
    fn get(&self, account: &str) -> Result<Option<String>, String>;
    fn set(&self, account: &str, value: &str) -> Result<(), String>;
    fn delete(&self, account: &str) -> Result<(), String>;
}

/// The OS keychain behind the default store keyring-core holds.
struct OsKeychain;

impl Keyring for OsKeychain {
    fn get(&self, account: &str) -> Result<Option<String>, String> {
        let entry = Entry::new(SERVICE, account).map_err(|error| error.to_string())?;
        match entry.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(KeyringError::NoEntry) => Ok(None),
            Err(error) => Err(error.to_string()),
        }
    }

    fn set(&self, account: &str, value: &str) -> Result<(), String> {
        let entry = Entry::new(SERVICE, account).map_err(|error| error.to_string())?;
        entry.set_password(value).map_err(|error| error.to_string())
    }

    fn delete(&self, account: &str) -> Result<(), String> {
        let entry = Entry::new(SERVICE, account).map_err(|error| error.to_string())?;
        // A name that was never set has no credential: a no-op, not a failure.
        match entry.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
            Err(error) => Err(error.to_string()),
        }
    }
}

/// The Plugin secret service: the keychain plus the names index that makes
/// `list_names` and the clear operations possible.
pub struct PluginSecrets {
    keyring: Box<dyn Keyring>,
    index: Mutex<()>,
}

impl PluginSecrets {
    fn new(keyring: Box<dyn Keyring>) -> Self {
        Self {
            keyring,
            index: Mutex::new(()),
        }
    }

    /// Saves `value` under (plugin_id, name) and records the name in the index.
    pub fn set(&self, plugin_id: &str, name: &str, value: &str) -> Result<(), String> {
        let account = value_account(plugin_id, name)?;
        let _guard = self.lock()?;
        self.keyring.set(&account, value)?;
        let mut index = self.read_index()?;
        index
            .entry(plugin_id.to_string())
            .or_default()
            .insert(name.to_string());
        self.write_index(&index)
    }

    /// Deletes one (plugin_id, name); a name that was never set is a no-op.
    pub fn delete(&self, plugin_id: &str, name: &str) -> Result<(), String> {
        let account = value_account(plugin_id, name)?;
        let _guard = self.lock()?;
        self.keyring.delete(&account)?;
        let mut index = self.read_index()?;
        if let Some(names) = index.get_mut(plugin_id) {
            names.remove(name);
            if names.is_empty() {
                index.remove(plugin_id);
            }
        }
        self.write_index(&index)
    }

    /// The Plugin's secret names, sorted, names only — never a value.
    pub fn list_names(&self, plugin_id: &str) -> Result<Vec<String>, String> {
        validate_plugin_id(plugin_id)?;
        let _guard = self.lock()?;
        let index = self.read_index()?;
        Ok(index
            .get(plugin_id)
            .map(|names| names.iter().cloned().collect())
            .unwrap_or_default())
    }

    /// The value for (plugin_id, name), or `None`. Host-only: used for network
    /// header injection, never exposed to a Plugin (ADR 0023).
    pub fn read(&self, plugin_id: &str, name: &str) -> Result<Option<String>, String> {
        let account = value_account(plugin_id, name)?;
        self.keyring.get(&account)
    }

    /// Deletes every secret the Plugin saved, and no other Plugin's.
    pub fn clear_plugin(&self, plugin_id: &str) -> Result<(), String> {
        validate_plugin_id(plugin_id)?;
        let _guard = self.lock()?;
        let mut index = self.read_index()?;
        if let Some(names) = index.remove(plugin_id) {
            for name in names {
                self.keyring.delete(&account(plugin_id, &name))?;
            }
        }
        self.write_index(&index)
    }

    /// Deletes every saved Plugin secret, then the index itself.
    pub fn clear_all(&self) -> Result<(), String> {
        let _guard = self.lock()?;
        let index = self.read_index()?;
        for (plugin_id, names) in &index {
            for name in names {
                self.keyring.delete(&account(plugin_id, name))?;
            }
        }
        self.keyring.delete(INDEX_ACCOUNT)
    }

    fn read_index(&self) -> Result<Index, String> {
        let Some(json) = self.keyring.get(INDEX_ACCOUNT)? else {
            return Ok(Index::new());
        };
        serde_json::from_str(&json).map_err(|error| format!("PLUGIN_SECRET_INDEX: {error}"))
    }

    fn write_index(&self, index: &Index) -> Result<(), String> {
        if index.is_empty() {
            return self.keyring.delete(INDEX_ACCOUNT);
        }
        let json = serde_json::to_string(index).map_err(|error| error.to_string())?;
        self.keyring.set(INDEX_ACCOUNT, &json)
    }

    fn lock(&self) -> Result<MutexGuard<'_, ()>, String> {
        self.index
            .lock()
            .map_err(|_| "the Plugin secret index lock was poisoned".to_string())
    }
}

/// The account a value waits under: the Plugin id, a separator, then the name.
fn account(plugin_id: &str, name: &str) -> String {
    format!("{plugin_id}{NAME_SEPARATOR}{name}")
}

/// Validates a write's inputs and returns the value's account. Only the name is
/// constrained against the separator, so an account always splits back at its
/// first separator.
fn value_account(plugin_id: &str, name: &str) -> Result<String, String> {
    validate_plugin_id(plugin_id)?;
    if name.is_empty() {
        return Err("the secret name is empty".to_string());
    }
    if name.contains(NAME_SEPARATOR) {
        return Err(format!(
            "the secret name '{name}' must not contain a '{NAME_SEPARATOR}'"
        ));
    }
    Ok(account(plugin_id, name))
}

fn validate_plugin_id(plugin_id: &str) -> Result<(), String> {
    if plugin_id.is_empty() {
        return Err("the Plugin id is empty".to_string());
    }
    Ok(())
}

/// The one Plugin secret service the app registers at startup. Empty when the
/// platform keychain could not be opened, so every command reports that instead
/// of panicking.
static SECRETS: OnceLock<PluginSecrets> = OnceLock::new();

/// Opens the platform keychain as the default store and installs the secret
/// service. Best-effort: a device whose keychain is unavailable keeps every
/// command returning a clear error rather than failing the launch.
pub fn init() {
    match native_store() {
        Ok(store) => {
            keyring_core::set_default_store(store);
            let _ = SECRETS.set(PluginSecrets::new(Box::new(OsKeychain)));
        }
        Err(error) => eprintln!("Plugin secret store unavailable: {error}"),
    }
}

#[cfg(target_os = "linux")]
fn native_store() -> Result<std::sync::Arc<CredentialStore>, String> {
    let store: std::sync::Arc<CredentialStore> =
        dbus_secret_service_keyring_store::Store::new().map_err(|error| error.to_string())?;
    Ok(store)
}

#[cfg(target_os = "windows")]
fn native_store() -> Result<std::sync::Arc<CredentialStore>, String> {
    let store: std::sync::Arc<CredentialStore> =
        windows_native_keyring_store::Store::new().map_err(|error| error.to_string())?;
    Ok(store)
}

/// The message every command that needs the keychain reports when it was never
/// installed on this device.
const UNAVAILABLE_STORE: &str = "the Plugin secret store is unavailable on this device";

/// The app's one secret service, or the answer a device without a keychain has.
/// A machine that never opened the keychain stored nothing, so listing, reading
/// and clearing succeed against nothing; only saving and deleting need it.
enum Available<'a> {
    Store(&'a PluginSecrets),
    Missing,
}

impl<'a> Available<'a> {
    fn from_store(store: Option<&'a PluginSecrets>) -> Self {
        match store {
            Some(secrets) => Available::Store(secrets),
            None => Available::Missing,
        }
    }

    fn set(&self, plugin_id: &str, name: &str, value: &str) -> Result<(), String> {
        match self {
            Available::Store(secrets) => secrets.set(plugin_id, name, value),
            Available::Missing => Err(UNAVAILABLE_STORE.to_string()),
        }
    }

    fn delete(&self, plugin_id: &str, name: &str) -> Result<(), String> {
        match self {
            Available::Store(secrets) => secrets.delete(plugin_id, name),
            Available::Missing => Err(UNAVAILABLE_STORE.to_string()),
        }
    }

    fn list_names(&self, plugin_id: &str) -> Result<Vec<String>, String> {
        match self {
            Available::Store(secrets) => secrets.list_names(plugin_id),
            Available::Missing => Ok(Vec::new()),
        }
    }

    fn read(&self, plugin_id: &str, name: &str) -> Result<Option<String>, String> {
        match self {
            Available::Store(secrets) => secrets.read(plugin_id, name),
            Available::Missing => Ok(None),
        }
    }

    fn clear_plugin(&self, plugin_id: &str) -> Result<(), String> {
        match self {
            Available::Store(secrets) => secrets.clear_plugin(plugin_id),
            Available::Missing => Ok(()),
        }
    }

    fn clear_all(&self) -> Result<(), String> {
        match self {
            Available::Store(secrets) => secrets.clear_all(),
            Available::Missing => Ok(()),
        }
    }
}

#[tauri::command]
pub async fn plugin_secret_set(
    plugin_id: String,
    name: String,
    value: String,
) -> Result<(), String> {
    let available = Available::from_store(SECRETS.get());
    tauri::async_runtime::spawn_blocking(move || available.set(&plugin_id, &name, &value))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn plugin_secret_delete(plugin_id: String, name: String) -> Result<(), String> {
    let available = Available::from_store(SECRETS.get());
    tauri::async_runtime::spawn_blocking(move || available.delete(&plugin_id, &name))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn plugin_secret_list_names(plugin_id: String) -> Result<Vec<String>, String> {
    let available = Available::from_store(SECRETS.get());
    tauri::async_runtime::spawn_blocking(move || available.list_names(&plugin_id))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn plugin_secret_read(plugin_id: String, name: String) -> Result<Option<String>, String> {
    let available = Available::from_store(SECRETS.get());
    tauri::async_runtime::spawn_blocking(move || available.read(&plugin_id, &name))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn plugin_secret_clear_plugin(plugin_id: String) -> Result<(), String> {
    let available = Available::from_store(SECRETS.get());
    tauri::async_runtime::spawn_blocking(move || available.clear_plugin(&plugin_id))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn plugin_secret_clear_all() -> Result<(), String> {
    let available = Available::from_store(SECRETS.get());
    tauri::async_runtime::spawn_blocking(move || available.clear_all())
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    /// keyring-core holds its default store in one process-wide slot, so the
    /// tests that set a mock store take turns. Each caller gets a fresh store.
    fn mock_store() -> MutexGuard<'static, ()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        let guard = LOCK
            .get_or_init(|| Mutex::new(()))
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        keyring_core::set_default_store(keyring_core::mock::Store::new().unwrap());
        guard
    }

    fn secrets() -> PluginSecrets {
        PluginSecrets::new(Box::new(OsKeychain))
    }

    #[test]
    fn set_then_list_and_read_round_trip() {
        let _guard = mock_store();
        let secrets = secrets();

        secrets.set("tracer", "token", "s3cr3t").unwrap();

        assert_eq!(secrets.list_names("tracer").unwrap(), vec!["token"]);
        assert_eq!(
            secrets.read("tracer", "token").unwrap().as_deref(),
            Some("s3cr3t")
        );
    }

    #[test]
    fn read_returns_none_for_a_name_that_was_never_set() {
        let _guard = mock_store();
        let secrets = secrets();

        assert_eq!(secrets.read("tracer", "missing").unwrap(), None);
        assert_eq!(secrets.list_names("tracer").unwrap(), Vec::<String>::new());
    }

    #[test]
    fn set_overwrites_the_previous_value() {
        let _guard = mock_store();
        let secrets = secrets();

        secrets.set("tracer", "token", "first").unwrap();
        secrets.set("tracer", "token", "second").unwrap();

        assert_eq!(
            secrets.read("tracer", "token").unwrap().as_deref(),
            Some("second")
        );
        assert_eq!(secrets.list_names("tracer").unwrap(), vec!["token"]);
    }

    #[test]
    fn two_plugins_never_see_each_others_secrets() {
        let _guard = mock_store();
        let secrets = secrets();

        secrets.set("tracer", "token", "tracer-token").unwrap();
        secrets.set("echoes", "token", "echoes-token").unwrap();

        assert_eq!(secrets.list_names("tracer").unwrap(), vec!["token"]);
        assert_eq!(secrets.list_names("echoes").unwrap(), vec!["token"]);
        assert_eq!(
            secrets.read("tracer", "token").unwrap().as_deref(),
            Some("tracer-token")
        );
        assert_eq!(
            secrets.read("echoes", "token").unwrap().as_deref(),
            Some("echoes-token")
        );
    }

    #[test]
    fn list_names_is_sorted_and_carries_names_only() {
        let _guard = mock_store();
        let secrets = secrets();

        secrets.set("tracer", "zeta", "z-value").unwrap();
        secrets.set("tracer", "alpha", "a-value").unwrap();
        secrets.set("tracer", "mu", "m-value").unwrap();

        assert_eq!(
            secrets.list_names("tracer").unwrap(),
            vec!["alpha", "mu", "zeta"]
        );
    }

    #[test]
    fn delete_removes_the_value_and_updates_the_index() {
        let _guard = mock_store();
        let secrets = secrets();
        secrets.set("tracer", "a", "1").unwrap();
        secrets.set("tracer", "b", "2").unwrap();

        secrets.delete("tracer", "a").unwrap();

        assert_eq!(secrets.list_names("tracer").unwrap(), vec!["b"]);
        assert_eq!(secrets.read("tracer", "a").unwrap(), None);
        assert_eq!(secrets.read("tracer", "b").unwrap().as_deref(), Some("2"));
        assert_eq!(
            secrets
                .read_index()
                .unwrap()
                .get("tracer")
                .unwrap()
                .iter()
                .cloned()
                .collect::<Vec<_>>(),
            vec!["b"]
        );
    }

    #[test]
    fn deleting_a_name_that_was_never_set_is_a_no_op() {
        let _guard = mock_store();
        let secrets = secrets();
        secrets.set("tracer", "kept", "value").unwrap();

        secrets.delete("tracer", "missing").unwrap();

        assert_eq!(secrets.list_names("tracer").unwrap(), vec!["kept"]);
        assert_eq!(secrets.read("tracer", "kept").unwrap().as_deref(), Some("value"));
    }

    #[test]
    fn clear_plugin_erases_one_plugin_and_leaves_every_other() {
        let _guard = mock_store();
        let secrets = secrets();
        secrets.set("tracer", "token", "tracer-token").unwrap();
        secrets.set("echoes", "token", "echoes-token").unwrap();

        secrets.clear_plugin("tracer").unwrap();

        assert_eq!(secrets.list_names("tracer").unwrap(), Vec::<String>::new());
        assert_eq!(secrets.read("tracer", "token").unwrap(), None);
        assert_eq!(
            secrets.read("echoes", "token").unwrap().as_deref(),
            Some("echoes-token")
        );
        assert!(secrets.read_index().unwrap().get("tracer").is_none());
    }

    #[test]
    fn clear_all_empties_every_plugin_and_the_index() {
        let _guard = mock_store();
        let secrets = secrets();
        secrets.set("tracer", "token", "tracer-token").unwrap();
        secrets.set("echoes", "token", "echoes-token").unwrap();

        secrets.clear_all().unwrap();

        assert_eq!(secrets.list_names("tracer").unwrap(), Vec::<String>::new());
        assert_eq!(secrets.list_names("echoes").unwrap(), Vec::<String>::new());
        assert_eq!(secrets.read("tracer", "token").unwrap(), None);
        // The index entry itself is gone, not left empty.
        let index_entry = Entry::new(SERVICE, INDEX_ACCOUNT).unwrap();
        assert!(matches!(
            index_entry.get_password(),
            Err(KeyringError::NoEntry)
        ));
    }

    #[test]
    fn a_name_with_a_separator_is_refused() {
        let _guard = mock_store();
        let secrets = secrets();

        let error = secrets.set("tracer", "a/b", "value").unwrap_err();

        assert!(!error.is_empty());
        assert!(secrets.read("tracer", "a/b").is_err());
        assert!(secrets.delete("tracer", "a/b").is_err());
        assert_eq!(secrets.list_names("tracer").unwrap(), Vec::<String>::new());
    }

    #[test]
    fn an_empty_plugin_id_or_name_is_refused() {
        let _guard = mock_store();
        let secrets = secrets();

        assert!(secrets.set("", "token", "value").is_err());
        assert!(secrets.set("tracer", "", "value").is_err());
        assert!(secrets.list_names("").is_err());
        assert!(secrets.clear_plugin("").is_err());
        assert_eq!(secrets.list_names("tracer").unwrap(), Vec::<String>::new());
    }

    #[test]
    fn an_error_never_carries_the_secret_value() {
        let _guard = mock_store();
        let secrets = secrets();
        let value = "s3cr3t-value";
        secrets.set("tracer", "token", value).unwrap();

        // A refused name and a refused index both produce an error; neither may
        // echo the stored value. A read is the only path that sees it.
        let refused_name = secrets.set("tracer", "a/b", value).unwrap_err();
        assert!(!refused_name.contains(value), "{refused_name}");

        secrets
            .keyring
            .set(INDEX_ACCOUNT, "not json")
            .expect("the index can be corrupted for the test");
        let refused_index = secrets.list_names("tracer").unwrap_err();
        assert!(!refused_index.contains(value), "{refused_index}");

        assert_eq!(secrets.read("tracer", "token").unwrap().as_deref(), Some(value));
    }

    #[test]
    fn a_missing_store_answers_lists_reads_and_clears_as_empty() {
        let available = Available::from_store(None);

        assert_eq!(available.list_names("tracer").unwrap(), Vec::<String>::new());
        assert_eq!(available.read("tracer", "token").unwrap(), None);
        assert!(available.clear_plugin("tracer").is_ok());
        assert!(available.clear_all().is_ok());
    }

    #[test]
    fn a_missing_store_refuses_only_saving_and_deleting() {
        let available = Available::from_store(None);

        let save_error = available.set("tracer", "token", "s3cr3t").unwrap_err();
        assert!(save_error.contains("unavailable"), "{save_error}");
        assert!(!save_error.contains("s3cr3t"), "{save_error}");
        assert!(available.delete("tracer", "token").is_err());
    }

    #[test]
    fn an_installed_store_forwards_every_call() {
        let _guard = mock_store();
        let secrets = secrets();
        let available = Available::from_store(Some(&secrets));

        available.set("tracer", "token", "s3cr3t").unwrap();
        assert_eq!(available.list_names("tracer").unwrap(), vec!["token"]);
        assert_eq!(
            available.read("tracer", "token").unwrap().as_deref(),
            Some("s3cr3t")
        );
        available.clear_plugin("tracer").unwrap();
        assert_eq!(available.list_names("tracer").unwrap(), Vec::<String>::new());
        available.clear_all().unwrap();
    }
}
