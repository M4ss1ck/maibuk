#[cfg(any(target_os = "linux", target_os = "windows"))]
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

#[cfg(any(target_os = "linux", target_os = "windows"))]
fn show_main_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.set_focus();
    }
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show Maibuk", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "quit" => {
                // Quit bypasses the window close event the plugin saves on;
                // persist the latest window state explicitly first.
                use tauri_plugin_window_state::{AppHandleExt, StateFlags};
                let _ = app.save_window_state(
                    StateFlags::all().difference(StateFlags::VISIBLE),
                );
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

/// Swap the tray icon while a sync is running. No-op on platforms without a
/// tray. Errors are ignored: a failed icon swap must never break sync.
#[tauri::command]
pub fn set_tray_syncing(app: tauri::AppHandle, syncing: bool) {
    #[cfg(any(target_os = "linux", target_os = "windows"))]
    {
        if let Some(tray) = app.tray_by_id("main") {
            let icon = if syncing {
                Some(tauri::include_image!("icons/tray-syncing.png"))
            } else {
                app.default_window_icon().cloned()
            };
            let _ = tray.set_icon(icon);
        }
    }
    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    let _ = (app, syncing);
}
