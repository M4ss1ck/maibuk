//! Resource Usage in the tray: Maibuk's own CPU, RAM, and storage (#668).
//!
//! Settings live in the frontend store, so Rust cannot read the toggle at
//! boot: the frontend calls `configure_tray` at startup and again whenever
//! the language, the toggle, or the Backup Directory changes. While the
//! toggle is off no sampling thread runs and the menu has no usage lines.
//! While it is on, one thread samples CPU and RAM every 2 s and another walks
//! storage every 60 s (or right away when poked after a Backup, a Dictation
//! Model download, or a Plugin install), so a slow Backup Directory never
//! delays the CPU line. The lines update in place through `set_text`; the
//! menu is never rebuilt on open, because tray-icon emits no open event on
//! Linux and a Win32 popup does not reliably repaint text changed while open.

pub mod format;
mod process;
mod storage;

use std::path::PathBuf;
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::{AppHandle, Emitter, Manager, Runtime, Wry};

use format::Labels;

const PROCESS_INTERVAL: Duration = Duration::from_secs(2);
/// CPU needs two samples; the first pair is taken this far apart so the line
/// fills well inside a second of the toggle turning on.
const FIRST_PROCESS_INTERVAL: Duration = Duration::from_millis(500);
const STORAGE_INTERVAL: Duration = Duration::from_secs(60);

/// Carries a `Summary` to Settings → Window each time the numbers change.
pub const SUMMARY_EVENT: &str = "resource-usage://changed";

pub const SHOW_ID: &str = "show";
pub const QUIT_ID: &str = "quit";
const OPEN_IDS: [&str; 4] = [
    "resource-usage:app",
    "resource-usage:data",
    "resource-usage:backups",
    "resource-usage:plugins",
];

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayConfig {
    pub labels: Labels,
    pub resource_usage: bool,
    /// The resolved Backup Directory; `None` falls back to the default.
    pub backup_directory: Option<String>,
}

#[derive(Clone, Copy, Default)]
struct Values {
    cpu: Option<f64>,
    ram: Option<(u64, f64)>,
    /// App, Data, Backups, Plugins, each as soon as its walk ends.
    storage: [Option<u64>; 4],
    /// Unknown until a whole walk has ended, so the first walk never shows
    /// a partial sum as the total.
    total: Option<u64>,
}

#[derive(Clone)]
struct Lines {
    cpu: MenuItem<Wry>,
    ram: MenuItem<Wry>,
    total: MenuItem<Wry>,
    storage: [MenuItem<Wry>; 4],
}

/// Wakes a sampling thread early (`poke`) or ends it (`stop`).
#[derive(Default)]
struct Signal {
    state: Mutex<(bool, bool)>,
    changed: Condvar,
}

impl Signal {
    /// Waits up to `timeout` or until poked. False once stopped.
    fn wait(&self, timeout: Duration) -> bool {
        let guard = self.state.lock().unwrap();
        let (mut guard, _) = self
            .changed
            .wait_timeout_while(guard, timeout, |(stopped, poked)| !*stopped && !*poked)
            .unwrap();
        guard.1 = false;
        !guard.0
    }

    fn poke(&self) {
        self.state.lock().unwrap().1 = true;
        self.changed.notify_all();
    }

    fn stop(&self) {
        self.state.lock().unwrap().0 = true;
        self.changed.notify_all();
    }

    fn stopped(&self) -> bool {
        self.state.lock().unwrap().0
    }
}

/// Runs `work` now, then again every `interval` (or `first_interval` after
/// the first run) or when poked, until stopped.
fn run_every(
    name: &str,
    signal: Arc<Signal>,
    first_interval: Duration,
    interval: Duration,
    mut work: impl FnMut(&Signal) + Send + 'static,
) {
    // Named, or the thread takes the name of the tokio worker that spawned it.
    // A failed spawn leaves its lines at the dash.
    let _ = std::thread::Builder::new()
        .name(name.into())
        .spawn(move || {
            let mut wait = first_interval;
            loop {
                work(&signal);
                if !signal.wait(wait) {
                    break;
                }
                wait = interval;
            }
        });
}

struct Run {
    process: Arc<Signal>,
    storage: Arc<Signal>,
}

/// The three totals Settings shows under the switch, worded like the tray.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Summary {
    pub cpu: String,
    pub ram: String,
    pub storage: String,
}

#[derive(Default)]
struct Shared {
    app: Mutex<Option<AppHandle<Wry>>>,
    labels: Mutex<Labels>,
    backup_directory: Mutex<Option<PathBuf>>,
    values: Mutex<Values>,
    lines: Mutex<Option<Lines>>,
    run: Mutex<Option<Run>>,
}

/// Managed state. Not generic over the runtime, so commands generic over it
/// can still poke a storage walk.
#[derive(Default, Clone)]
pub struct ResourceUsage(Arc<Shared>);

impl ResourceUsage {
    pub fn configure(&self, app: &AppHandle<Wry>, config: TrayConfig) -> tauri::Result<()> {
        *self.0.app.lock().unwrap() = Some(app.clone());
        *self.0.labels.lock().unwrap() = config.labels;
        let backup_directory = config
            .backup_directory
            .and_then(|path| crate::trusted::validate_directory(&path).ok());
        let backups_moved = {
            let mut current = self.0.backup_directory.lock().unwrap();
            let moved = *current != backup_directory;
            *current = backup_directory;
            moved
        };

        let mut run = self.0.run.lock().unwrap();
        match (config.resource_usage, run.is_some()) {
            (true, false) => *run = Some(self.start(app)),
            (false, true) => {
                if let Some(run) = run.take() {
                    run.process.stop();
                    run.storage.stop();
                }
                *self.0.values.lock().unwrap() = Values::default();
            }
            (true, true) if backups_moved => {
                if let Some(run) = run.as_ref() {
                    run.storage.poke();
                }
            }
            _ => {}
        }
        let enabled = run.is_some();
        drop(run);
        // Settings rewords its line now rather than at the next sample.
        if let Some(summary) = self.summary() {
            let _ = app.emit(SUMMARY_EVENT, summary);
        }

        if let Some(tray) = app.tray_by_id("main") {
            tray.set_menu(Some(self.menu(app, enabled)?))?;
        }
        Ok(())
    }

    /// The whole tray menu in the current language, with usage lines when on.
    pub fn menu(&self, app: &AppHandle<Wry>, enabled: bool) -> tauri::Result<Menu<Wry>> {
        let labels = self.0.labels.lock().unwrap().clone();
        let show = MenuItem::with_id(app, SHOW_ID, &labels.show, true, None::<&str>)?;
        let quit = MenuItem::with_id(app, QUIT_ID, &labels.quit, true, None::<&str>)?;
        if !enabled {
            *self.0.lines.lock().unwrap() = None;
            return Menu::with_items(app, &[&show, &quit]);
        }

        let values = *self.0.values.lock().unwrap();
        let text = texts(&labels, &values);
        let disabled = |text: &str| MenuItem::new(app, text, false, None::<&str>);
        let lines = PendingLines {
            cpu: disabled(&text.cpu)?,
            ram: disabled(&text.ram)?,
            total: disabled(&text.total)?,
            storage: [0, 1, 2, 3].map(|i| {
                MenuItem::with_id(
                    app,
                    OPEN_IDS[i],
                    &text.storage[i],
                    values.storage[i].is_some(),
                    None::<&str>,
                )
            }),
        }
        .try_into_lines()?;
        let separator = || PredefinedMenuItem::separator(app);
        let (first, second) = (separator()?, separator()?);
        let menu = Menu::with_items(
            app,
            &[
                &lines.cpu,
                &lines.ram,
                &first,
                &lines.total,
                &lines.storage[0],
                &lines.storage[1],
                &lines.storage[2],
                &lines.storage[3],
                &second,
                &show,
                &quit,
            ],
        )?;
        *self.0.lines.lock().unwrap() = Some(lines);
        Ok(menu)
    }

    pub fn is_running(&self) -> bool {
        self.0.run.lock().unwrap().is_some()
    }

    /// The current totals, or `None` while Resource Usage is off.
    pub fn summary(&self) -> Option<Summary> {
        if !self.is_running() {
            return None;
        }
        let values = *self.0.values.lock().unwrap();
        let text = texts(&self.0.labels.lock().unwrap(), &values);
        Some(Summary {
            cpu: text.cpu,
            ram: text.ram,
            storage: text.total,
        })
    }

    /// Re-walk storage now, when the lines are showing.
    pub fn refresh_storage(&self) {
        if let Some(run) = self.0.run.lock().unwrap().as_ref() {
            run.storage.poke();
        }
    }

    /// Opens a storage line's folder in the file manager. False for an id
    /// that is not a storage line.
    pub fn open(&self, app: &AppHandle<Wry>, id: &str) -> bool {
        use tauri_plugin_opener::OpenerExt;
        let Some(index) = OPEN_IDS.iter().position(|open| *open == id) else {
            return false;
        };
        let target = match index {
            0 => install_folder(app),
            1 => app.path().app_data_dir().ok(),
            2 => self.backup_directory(app),
            _ => crate::plugins::directory::plugin_directory(app).ok(),
        };
        if let Some(target) = target {
            let _ = app
                .opener()
                .open_path(target.to_string_lossy().into_owned(), None::<&str>);
        }
        true
    }

    fn start(&self, app: &AppHandle<Wry>) -> Run {
        let run = Run {
            process: Arc::default(),
            storage: Arc::default(),
        };

        let this = self.clone();
        let root = std::process::id();
        let mut meter = process::CpuMeter::default();
        run_every(
            "resource-usage-process",
            Arc::clone(&run.process),
            FIRST_PROCESS_INTERVAL,
            PROCESS_INTERVAL,
            move |signal| {
                let sample = process::sample(root);
                let cpu = meter.share(&sample);
                this.publish(signal, |values| {
                    values.cpu = cpu;
                    values.ram = sample.memory();
                });
            },
        );

        let this = self.clone();
        let app = app.clone();
        run_every(
            "resource-usage-storage",
            Arc::clone(&run.storage),
            STORAGE_INTERVAL,
            STORAGE_INTERVAL,
            move |signal| {
                let mut total = 0;
                storage::measure_each(&this.storage_roots(&app), |line, size| {
                    total += size.unwrap_or(0);
                    this.publish(signal, |values| values.storage[line] = size);
                });
                this.publish(signal, |values| values.total = Some(total));
            },
        );
        run
    }

    /// Records new values and shows them, unless the run was stopped while
    /// they were being read.
    fn publish(&self, signal: &Signal, update: impl FnOnce(&mut Values)) {
        if signal.stopped() {
            return;
        }
        let values = {
            let mut values = self.0.values.lock().unwrap();
            update(&mut values);
            *values
        };
        let text = texts(&self.0.labels.lock().unwrap(), &values);
        let app = self.0.app.lock().unwrap().clone();
        if let Some(app) = app {
            let _ = app.emit(
                SUMMARY_EVENT,
                Summary {
                    cpu: text.cpu.clone(),
                    ram: text.ram.clone(),
                    storage: text.total.clone(),
                },
            );
        }
        // set_text waits on the main thread, so no lock is held across it.
        let Some(lines) = self.0.lines.lock().unwrap().clone() else {
            return;
        };
        let _ = lines.cpu.set_text(&text.cpu);
        let _ = lines.ram.set_text(&text.ram);
        let _ = lines.total.set_text(&text.total);
        for (i, line) in lines.storage.iter().enumerate() {
            let _ = line.set_text(&text.storage[i]);
            let _ = line.set_enabled(values.storage[i].is_some());
        }
    }

    fn backup_directory(&self, app: &AppHandle<Wry>) -> Option<PathBuf> {
        self.0
            .backup_directory
            .lock()
            .unwrap()
            .clone()
            .or_else(|| Some(app.path().app_config_dir().ok()?.join("backups")))
    }

    /// App, Data, Backups, Plugins.
    fn storage_roots(&self, app: &AppHandle<Wry>) -> Vec<Vec<PathBuf>> {
        let path = app.path();
        let data = [
            path.app_config_dir(),
            path.app_data_dir(),
            path.app_local_data_dir(),
            path.app_cache_dir(),
            path.app_log_dir(),
        ];
        vec![
            install_roots(app),
            data.into_iter().flatten().collect(),
            self.backup_directory(app).into_iter().collect(),
            crate::plugins::directory::plugin_directory(app)
                .into_iter()
                .collect(),
        ]
    }
}

fn install_roots<R: Runtime>(app: &AppHandle<R>) -> Vec<PathBuf> {
    install_roots_of(
        appimage(),
        std::env::current_exe().ok(),
        app.path().resource_dir().ok(),
        cfg!(debug_assertions),
    )
}

/// The AppImage file for an AppImage install. Otherwise the executable, its
/// resource folder, and on Linux the native libraries the deb and rpm put in
/// `/usr/lib/maibuk` (`bundle.linux` in tauri.conf.json, loaded by
/// `moonshine_ffi`); NSIS keeps everything in the resource folder. A dev
/// build's resource folder is `target/debug`, the whole Cargo build output,
/// so there only the copied `bundle.resources` count.
fn install_roots_of(
    appimage: Option<PathBuf>,
    exe: Option<PathBuf>,
    resource_dir: Option<PathBuf>,
    dev: bool,
) -> Vec<PathBuf> {
    if let Some(appimage) = appimage {
        return vec![appimage];
    }
    let resource_dir = resource_dir.map(|dir| if dev { dir.join("plugins") } else { dir });
    let libraries = exe
        .as_deref()
        .filter(|_| cfg!(target_os = "linux"))
        .and_then(|exe| exe.parent()?.parent())
        .map(|prefix| prefix.join("lib/maibuk"));
    exe.into_iter()
        .chain(resource_dir)
        .chain(libraries)
        .collect()
}

fn install_folder<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    match appimage() {
        Some(appimage) => appimage.parent().map(PathBuf::from),
        None => app.path().resource_dir().ok(),
    }
}

fn appimage() -> Option<PathBuf> {
    if !cfg!(target_os = "linux") {
        return None;
    }
    std::env::var_os("APPIMAGE")
        .map(PathBuf::from)
        .filter(|path| path.is_file())
}

struct Texts {
    cpu: String,
    ram: String,
    total: String,
    storage: [String; 4],
}

fn texts(labels: &Labels, values: &Values) -> Texts {
    let templates = [&labels.app, &labels.data, &labels.backups, &labels.plugins];
    Texts {
        cpu: labels.cpu_line(values.cpu),
        ram: labels.ram_line(values.ram),
        total: labels.size_line(&labels.storage, values.total),
        storage: [0, 1, 2, 3].map(|i| labels.size_line(templates[i], values.storage[i])),
    }
}

/// `Lines` built item by item; the storage items are fallible as a group.
struct PendingLines {
    cpu: MenuItem<Wry>,
    ram: MenuItem<Wry>,
    total: MenuItem<Wry>,
    storage: [tauri::Result<MenuItem<Wry>>; 4],
}

impl PendingLines {
    fn try_into_lines(self) -> tauri::Result<Lines> {
        let [app, data, backups, plugins] = self.storage;
        Ok(Lines {
            cpu: self.cpu,
            ram: self.ram,
            total: self.total,
            storage: [app?, data?, backups?, plugins?],
        })
    }
}

/// Configure the tray menu's language and Resource Usage. Async so it runs
/// off the main thread: building menu items waits on the main thread.
#[tauri::command]
pub async fn configure_tray(
    app: AppHandle<Wry>,
    state: tauri::State<'_, ResourceUsage>,
    config: TrayConfig,
) -> Result<(), String> {
    state.configure(&app, config).map_err(|e| e.to_string())
}

/// The totals Settings shows under the switch; `None` while off.
#[tauri::command]
pub fn resource_usage_summary(state: tauri::State<'_, ResourceUsage>) -> Option<Summary> {
    state.summary()
}

/// Re-walk storage after the frontend wrote a Backup. No-op while off.
#[tauri::command]
pub fn refresh_tray_storage(state: tauri::State<'_, ResourceUsage>) {
    state.refresh_storage();
}

/// Re-walk storage after a Rust-side write (a Plugin install, a Dictation
/// Model download). No-op while off or where the state is not managed.
pub fn refresh_storage<R: Runtime>(app: &AppHandle<R>) {
    if let Some(state) = app.try_state::<ResourceUsage>() {
        state.refresh_storage();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Instant;

    fn counter() -> (Arc<AtomicUsize>, impl FnMut(&Signal) + Send + 'static) {
        let runs = Arc::new(AtomicUsize::new(0));
        let r = Arc::clone(&runs);
        (runs, move |_: &Signal| {
            r.fetch_add(1, Ordering::SeqCst);
        })
    }

    fn wait_for(what: impl Fn() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(5);
        while !what() {
            assert!(Instant::now() < deadline, "timed out");
            std::thread::yield_now();
        }
    }

    #[test]
    fn a_run_samples_immediately_then_on_its_short_first_interval() {
        let signal = Arc::new(Signal::default());
        let (runs, work) = counter();
        let started = Instant::now();
        run_every(
            "test",
            Arc::clone(&signal),
            Duration::from_millis(50),
            Duration::from_secs(60),
            work,
        );
        wait_for(|| runs.load(Ordering::SeqCst) >= 1);
        wait_for(|| runs.load(Ordering::SeqCst) >= 2);
        assert!(
            started.elapsed() < Duration::from_secs(1),
            "lines fill within a second"
        );
        signal.stop();
    }

    #[test]
    fn a_poke_runs_the_work_again_before_the_interval() {
        let signal = Arc::new(Signal::default());
        let (runs, work) = counter();
        run_every(
            "test",
            Arc::clone(&signal),
            Duration::from_secs(60),
            Duration::from_secs(60),
            work,
        );
        wait_for(|| runs.load(Ordering::SeqCst) == 1);
        signal.poke();
        wait_for(|| runs.load(Ordering::SeqCst) == 2);
        signal.stop();
    }

    #[test]
    fn a_stopped_run_never_samples_again() {
        let signal = Arc::new(Signal::default());
        let (runs, work) = counter();
        run_every(
            "test",
            Arc::clone(&signal),
            Duration::from_millis(1),
            Duration::from_millis(1),
            work,
        );
        wait_for(|| runs.load(Ordering::SeqCst) >= 1);
        signal.stop();
        // A wait returns false once stopped, so the loop has at most one
        // run in flight when stop lands.
        let after_stop = runs.load(Ordering::SeqCst);
        assert!(!signal.wait(Duration::from_millis(1)));
        std::thread::sleep(Duration::from_millis(50));
        assert!(runs.load(Ordering::SeqCst) <= after_stop + 1);
    }

    #[test]
    fn an_appimage_install_is_the_appimage_file_alone() {
        let roots = install_roots_of(
            Some("/home/a/Apps/Maibuk.AppImage".into()),
            Some("/tmp/.mount_x/usr/bin/maibuk".into()),
            Some("/tmp/.mount_x/usr/lib/Maibuk".into()),
            false,
        );
        assert_eq!(roots, [PathBuf::from("/home/a/Apps/Maibuk.AppImage")]);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn a_deb_install_counts_the_executable_resources_and_native_libraries() {
        let roots = install_roots_of(
            None,
            Some("/usr/bin/maibuk".into()),
            Some("/usr/lib/Maibuk".into()),
            false,
        );
        let expected: [PathBuf; 3] = [
            "/usr/bin/maibuk".into(),
            "/usr/lib/Maibuk".into(),
            "/usr/lib/maibuk".into(),
        ];
        assert_eq!(roots, expected);
    }

    #[test]
    fn a_dev_build_counts_its_binary_and_bundled_resources_not_the_cargo_output() {
        let roots = install_roots_of(
            None,
            Some("/src/maibuk/src-tauri/target/debug/maibuk".into()),
            Some("/src/maibuk/src-tauri/target/debug".into()),
            true,
        );
        assert!(roots.contains(&PathBuf::from("/src/maibuk/src-tauri/target/debug/maibuk")));
        assert!(roots.contains(&PathBuf::from("/src/maibuk/src-tauri/target/debug/plugins")));
        assert!(!roots.contains(&PathBuf::from("/src/maibuk/src-tauri/target/debug")));
    }

    #[test]
    fn the_total_is_unknown_until_a_whole_walk_ends() {
        const MB: u64 = 1024 * 1024;
        let mid_walk = Values {
            cpu: Some(0.03),
            ram: Some((412 * MB, 0.026)),
            storage: [Some(98 * MB), None, None, None],
            total: None,
        };
        let text = texts(&Labels::default(), &mid_walk);
        assert_eq!(
            text.total, "Storage —",
            "never a partial sum shown as the total"
        );
        assert_eq!(text.storage[0], "App 98 MB");
        assert_eq!(text.storage[1], "Data —");
        assert_eq!(text.cpu, "CPU 3%");
    }
}
