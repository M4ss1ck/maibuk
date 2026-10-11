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

use super::directory::is_safe_folder_name;

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
/// `root`, when that component is a safe, non-dot name. The folder is named
/// even when it no longer exists, so a removal reaches the webview as an
/// unload; the one exception is a loose file directly in the root.
fn plugin_folder_of(root: &Path, path: &Path) -> Option<String> {
    let relative = path.strip_prefix(root).ok()?;
    let mut components = relative.components();
    let Some(Component::Normal(first)) = components.next() else {
        return None;
    };
    let name = first.to_str()?;
    if !is_safe_folder_name(name) {
        return None;
    }
    if components.next().is_none() && root.join(name).is_file() {
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
        // A deleted folder still names the Plugin to re-read; the event for a
        // path that no longer exists must not be dropped.
        assert_eq!(
            plugin_folder_of(&root, &root.join("gone/index.js")),
            Some("gone".to_string())
        );
        assert_eq!(plugin_folder_of(&root, &root.join("loose.txt")), None);
        assert_eq!(plugin_folder_of(&root, Path::new("/elsewhere/file")), None);
        assert_eq!(plugin_folder_of(&root, &root), None);
        // Dot-prefixed internal names (staging, replaced copies) are not Plugins.
        std::fs::create_dir_all(root.join(".x.replaced-1")).unwrap();
        assert_eq!(
            plugin_folder_of(&root, &root.join(".x.replaced-1/index.js")),
            None
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn emits_a_change_when_a_plugin_folder_is_removed() {
        let root = temp_dir("remove");
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

        // Give the watcher a moment to register before the removal.
        std::thread::sleep(Duration::from_millis(300));
        std::fs::remove_dir_all(&folder).unwrap();

        let id = receiver
            .recv_timeout(Duration::from_secs(10))
            .expect("the watcher must report the removed Plugin folder");
        assert_eq!(id, "tracer");

        watcher.unwatch();
        std::fs::remove_dir_all(&root).unwrap();
    }

    /// `replace_directory` renames the installed folder to a dot-prefixed
    /// name and swaps the staging folder in; only the real id may surface.
    #[test]
    fn emits_only_the_real_id_while_replace_directory_swaps_folders() {
        use crate::plugins::directory::replace_directory;

        let root = temp_dir("replace");
        let target = root.join("tracer");
        std::fs::create_dir_all(&target).unwrap();
        std::fs::write(target.join("index.js"), "export const a = 1;").unwrap();
        let (sender, receiver) = mpsc::channel();
        let watcher = PluginWatcher::default();
        watcher
            .watch(&root, move |id| {
                let _ = sender.send(id);
            })
            .unwrap();

        // Give the watcher a moment to register before the swap.
        std::thread::sleep(Duration::from_millis(300));

        let staging = root.join(".plugins.staging-1");
        std::fs::create_dir_all(&staging).unwrap();
        std::fs::write(staging.join("index.js"), "export const a = 2;").unwrap();
        replace_directory(&staging, &target).unwrap();

        let mut ids: Vec<String> = Vec::new();
        while let Ok(id) = receiver.recv_timeout(Duration::from_secs(2)) {
            ids.push(id);
        }
        assert!(ids.contains(&"tracer".to_string()), "{ids:?}");
        assert!(ids.iter().all(|id| id == "tracer"), "{ids:?}");

        watcher.unwatch();
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
