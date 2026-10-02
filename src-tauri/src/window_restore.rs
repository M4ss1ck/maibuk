use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Manager};

#[derive(Default)]
pub struct PendingWindowRestore(AtomicBool);

/// Replay an activation that arrived before Ready created the main window.
pub fn complete_startup(app: &AppHandle) {
    if app
        .state::<PendingWindowRestore>()
        .0
        .swap(false, Ordering::AcqRel)
    {
        show_main_window(app);
    }
}

/// Restore the existing window after an explicit tray or launcher activation.
pub fn show_main_window(app: &AppHandle) {
    let handle = app.clone();
    // Resolve on the event loop. If Ready has not created the window yet,
    // retain the request until setup completes; a queued task alone can run
    // before Ready and silently lose a launcher activation.
    if let Err(error) = app.run_on_main_thread(move || {
        let Some(win) = handle.get_webview_window("main") else {
            handle
                .state::<PendingWindowRestore>()
                .0
                .store(true, Ordering::Release);
            return;
        };

        #[cfg(target_os = "linux")]
        {
            use gtk::glib::translate::ToGlibPtr;
            use gtk::prelude::*;

            let window = match win.gtk_window() {
                Ok(window) => window,
                Err(error) => {
                    eprintln!("Failed to restore main window: {error}");
                    return;
                }
            };

            // Tao queues show/unminimize but checks GTK visibility and minimized
            // state before queuing focus. Use GTK on its main thread so showing
            // happens before presenting, including when the window is hidden.
            window.show_all();
            window.deiconify();

            let timestamp = window
                .window()
                .and_then(|native| native.downcast::<gdkx11::X11Window>().ok())
                .map(|native| {
                    // GDK_CURRENT_TIME can reuse this window's last input time,
                    // which Cinnamon rejects after another app has been used.
                    // The server-time query requires property change events.
                    let gdk_window = native.upcast_ref::<gtk::gdk::Window>();
                    gdk_window.set_events(
                        gdk_window.events() | gtk::gdk::EventMask::PROPERTY_CHANGE_MASK,
                    );
                    // SAFETY: this is a realized X11 GDK window, used on the
                    // GTK main thread, with property events enabled above.
                    unsafe { gdkx11::ffi::gdk_x11_get_server_time(native.to_glib_none().0) }
                })
                .unwrap_or(gtk::gdk::ffi::GDK_CURRENT_TIME as u32);

            window.present_with_time(timestamp);
        }

        #[cfg(not(target_os = "linux"))]
        {
            if let Err(error) = win
                .unminimize()
                .and_then(|_| win.show())
                .and_then(|_| win.set_focus())
            {
                eprintln!("Failed to restore main window: {error}");
            }
        }
    }) {
        eprintln!("Failed to schedule main window restore: {error}");
    }
}
