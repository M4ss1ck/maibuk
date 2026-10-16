//! Defer tray creation on Linux until a StatusNotifierItem host is on the bus.
//!
//! libayatana-appindicator 0.5.93 has a startup race. When the indicator is
//! created while `org.kde.StatusNotifierWatcher` has no owner, it arms a 100ms
//! timer that creates a legacy XEmbed `GtkStatusIcon` fallback. If the watcher
//! appears and the SNI registration succeeds inside that window, the
//! registration callback has no fallback to remove and does not cancel the
//! timer, so the timer then adds the XEmbed icon next to the SNI one and
//! nothing ever removes it. At login, autostart launches the app at the same
//! moment as Cinnamon's `xapp-sn-watcher`, which lands in that window: the
//! panel shows two icons for one process.
//!
//! [`when_ready`] builds the tray only once the watcher owns its name, so the
//! indicator never sees it missing and never arms the timer. If no watcher
//! shows up within [`FALLBACK_AFTER`] (a desktop with only an XEmbed tray), it
//! builds anyway and the fallback icon is the correct one.

use std::cell::RefCell;

#[cfg(target_os = "linux")]
const WATCHER_NAME: &str = "org.kde.StatusNotifierWatcher";

#[cfg(target_os = "linux")]
thread_local! {
    static PENDING: RefCell<Option<std::rc::Rc<Gate>>> = const { RefCell::new(None) };
}

#[cfg(target_os = "linux")]
pub const FALLBACK_AFTER: std::time::Duration = std::time::Duration::from_secs(5);

/// Runs its action at most once, then runs every registered cleanup.
/// Both triggers (watcher appeared, fallback timeout) share one gate.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
struct Gate {
    action: RefCell<Option<Box<dyn FnOnce()>>>,
    cleanups: RefCell<Vec<Box<dyn FnOnce()>>>,
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
impl Gate {
    fn new(action: impl FnOnce() + 'static) -> Self {
        Self {
            action: RefCell::new(Some(Box::new(action))),
            cleanups: RefCell::new(Vec::new()),
        }
    }

    fn on_fire(&self, cleanup: impl FnOnce() + 'static) {
        self.cleanups.borrow_mut().push(Box::new(cleanup));
    }

    /// Returns true only for the call that actually ran the action.
    fn fire(&self) -> bool {
        let Some(action) = self.action.borrow_mut().take() else {
            return false;
        };
        for cleanup in self.cleanups.borrow_mut().drain(..) {
            cleanup();
        }
        action();
        true
    }
}

/// Call `build` from the main thread (Tauri's `setup` hook). On Linux it runs
/// later on the GTK main loop; elsewhere it runs immediately.
#[cfg(target_os = "linux")]
pub fn when_ready(build: impl FnOnce() + 'static) {
    use gtk::gio::{self, BusNameWatcherFlags, BusType};
    use gtk::glib;
    use std::rc::Rc;

    let gate = Rc::new(Gate::new(build));

    // gio requires Send + Sync callbacks even though it dispatches them on
    // this thread's main context, so the watcher callback captures nothing and
    // reaches the gate through a main-thread-local slot instead.
    PENDING.with(|slot| *slot.borrow_mut() = Some(Rc::clone(&gate)));
    let watcher = gio::bus_watch_name(
        BusType::Session,
        WATCHER_NAME,
        BusNameWatcherFlags::NONE,
        |_, _, _| {
            if let Some(gate) = PENDING.with(|slot| slot.borrow_mut().take()) {
                gate.fire();
            }
        },
        |_, _| {},
    );

    // Whichever trigger wins tears down the other. A timeout source that has
    // fired is already gone, so it clears its own slot before firing and the
    // cleanup only removes it when the watcher won.
    let timeout_slot: Rc<RefCell<Option<glib::SourceId>>> = Rc::new(RefCell::new(None));
    let on_timeout = Rc::clone(&gate);
    let own_slot = Rc::clone(&timeout_slot);
    let timeout = glib::timeout_add_local_once(FALLBACK_AFTER, move || {
        own_slot.borrow_mut().take();
        on_timeout.fire();
    });
    *timeout_slot.borrow_mut() = Some(timeout);

    gate.on_fire(move || gio::bus_unwatch_name(watcher));
    gate.on_fire(|| PENDING.with(|slot| drop(slot.borrow_mut().take())));
    gate.on_fire(move || {
        if let Some(id) = timeout_slot.borrow_mut().take() {
            id.remove();
        }
    });
}

#[cfg(not(target_os = "linux"))]
pub fn when_ready(build: impl FnOnce() + 'static) {
    build();
}

#[cfg(test)]
mod tests {
    use super::Gate;
    use std::cell::Cell;
    use std::rc::Rc;

    #[test]
    fn gate_runs_action_once_across_both_triggers() {
        let runs = Rc::new(Cell::new(0));
        let r = Rc::clone(&runs);
        let gate = Gate::new(move || r.set(r.get() + 1));

        assert!(gate.fire(), "first trigger runs the builder");
        assert!(!gate.fire(), "second trigger is a no-op");
        assert_eq!(runs.get(), 1);
    }

    #[test]
    fn gate_runs_cleanups_before_action_and_only_once() {
        let log = Rc::new(std::cell::RefCell::new(Vec::new()));
        let l = Rc::clone(&log);
        let gate = Gate::new(move || l.borrow_mut().push("build"));
        let l = Rc::clone(&log);
        gate.on_fire(move || l.borrow_mut().push("unwatch"));
        let l = Rc::clone(&log);
        gate.on_fire(move || l.borrow_mut().push("remove-timeout"));

        gate.fire();
        gate.fire();
        assert_eq!(*log.borrow(), ["unwatch", "remove-timeout", "build"]);
    }
}
