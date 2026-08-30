mod tray;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            use tauri::Manager;
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.unminimize();
                let _ = win.show();
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_deep_link::init());

    #[cfg(mobile)]
    let builder = builder.plugin(tauri_plugin_deep_link::init());

    let builder = builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_clipboard_manager::init());

    #[cfg(desktop)]
    let builder = builder
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        .difference(tauri_plugin_window_state::StateFlags::VISIBLE),
                )
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ));

    builder
        .invoke_handler(tauri::generate_handler![tray::set_tray_syncing])
        .setup(|app| {
            #[cfg(desktop)]
            {
                use tauri::Manager;

                #[cfg(any(target_os = "linux", target_os = "windows"))]
                tray::setup_tray(app.handle())?;

                // The window is created hidden (visible:false in tauri.conf.json).
                // Show it unless this is an autostart/login launch (--minimized).
                let start_minimized = std::env::args().any(|arg| arg == "--minimized");
                if !start_minimized {
                    if let Some(win) = app.get_webview_window("main") {
                        let _ = win.show();
                    }
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
