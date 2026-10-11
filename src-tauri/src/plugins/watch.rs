//! Watching the Plugin Directory on desktop (ADR 0020).
//!
//! Rust owns the folder, so Rust watches it: `notify` reports a change under a
//! Plugin folder, debounced, and the webview is told the folder name. Android
//! has no hot reload in v1. Nothing here grants the webview any access; the
//! watch is Rust reading its own directory.

use std::path::{Component, Path};
use std::sync::Mutex;
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, RecommendedCache};

/// A burst of writes from one save lands as one change.
const DEBOUNCE: Duration = Duration::from_millis(200);

/// The managed watcher. One per app: watching a second directory replaces the
/// first.
#[derive(Default)]
pub struct PluginWatcher {
    inner: Mutex<Option<Debouncer<RecommendedWatcher, RecommendedCache>>>,
}

impl PluginWatcher {
    /// Watches `root` recursively and calls `on_change` with each Plugin
    /// folder name that changed, once per debounced burst.
    pub fn watch(
        &self,
        root: &Path,
        on_change: impl Fn(String) + Send + 'static,
    ) -> Result<(), String> {
        let mut guard = self.inner.lock().map_err(|e| e.to_string())?;
        *guard = None;
        let watched = root.to_path_buf();
        let mut debouncer = new_debouncer(DEBOUNCE, None, move |result: DebounceEventResult| {
            let Ok(events) = result else {
                return;
            };
            let mut changed: Vec<String> = Vec::new();
            for event in events {
                for path in &event.paths {
                    if let Some(id) = plugin_folder_of(&watched, path) {
                        if !changed.contains(&id) {
                            changed.push(id);
                        }
                    }
                }
            }
            for id in changed {
                on_change(id);
            }
        })
        .map_err(|e| e.to_string())?;
        debouncer
            .watch(root, RecursiveMode::Recursive)
            .map_err(|e| e.to_string())?;
        *guard = Some(debouncer);
        Ok(())
    }

    /// Stops watching, if anything was watched.
    pub fn unwatch(&self) {
        if let Ok(mut guard) = self.inner.lock() {
            *guard = None;
        }
    }
}

/// The Plugin folder a changed path belongs to: its first component under
/// `root`, when that component is a folder (a loose file at the root is not a
/// Plugin).
fn plugin_folder_of(root: &Path, path: &Path) -> Option<String> {
    let relative = path.strip_prefix(root).ok()?;
    let mut components = relative.components();
    let Some(Component::Normal(name)) = components.next() else {
        return None;
    };
    let name = name.to_str()?;
    if !root.join(name).is_dir() {
        return None;
    }
    Some(name.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::mpsc;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("maibuk-plugin-watch-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn maps_a_changed_path_to_its_plugin_folder_and_ignores_loose_files() {
        let root = temp_dir("mapping");
        std::fs::create_dir_all(root.join("tracer")).unwrap();
        std::fs::write(root.join("loose.txt"), "x").unwrap();

        assert_eq!(
            plugin_folder_of(&root, &root.join("tracer/index.js")),
            Some("tracer".to_string())
        );
        assert_eq!(
            plugin_folder_of(&root, &root.join("tracer")),
            Some("tracer".to_string())
        );
        assert_eq!(plugin_folder_of(&root, &root.join("loose.txt")), None);
        assert_eq!(plugin_folder_of(&root, Path::new("/elsewhere/file")), None);
        assert_eq!(plugin_folder_of(&root, &root), None);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn emits_a_change_when_a_plugin_file_is_edited() {
        let root = temp_dir("edit");
        let folder = root.join("tracer");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(folder.join("index.js"), "export const a = 1;").unwrap();
        let (sender, receiver) = mpsc::channel();
        let watcher = PluginWatcher::default();
        watcher
            .watch(&root, move |id| {
                let _ = sender.send(id);
            })
            .unwrap();

        // Give the watcher a moment to register before the write.
        std::thread::sleep(Duration::from_millis(300));
        std::fs::write(folder.join("index.js"), "export const a = 2;").unwrap();

        let id = receiver
            .recv_timeout(Duration::from_secs(10))
            .expect("the watcher must report the edited Plugin folder");
        assert_eq!(id, "tracer");

        watcher.unwatch();
        std::fs::remove_dir_all(&root).unwrap();
    }
}
