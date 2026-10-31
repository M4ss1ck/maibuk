mod android_exit;
mod backup;
mod dictation;
mod library_db;
mod plugins;
#[cfg(any(target_os = "linux", target_os = "windows"))]
mod resource_usage;
mod tray;
mod tray_host;
mod trusted;
#[cfg(any(target_os = "linux", target_os = "windows"))]
mod updater;
#[cfg(desktop)]
mod window_background;
#[cfg(desktop)]
mod window_restore;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut context = tauri::generate_context!();
    #[cfg(all(any(target_os = "linux", target_os = "windows"), debug_assertions))]
    updater::apply_endpoint_override(
        context.config_mut(),
        std::env::var("MAIBUK_UPDATER_ENDPOINT").ok(),
    );

    let builder = tauri::Builder::default();

    #[cfg(desktop)]
    let builder = builder
        .manage(window_restore::PendingWindowRestore::default())
        .manage(plugins::watch::PluginWatcher::default())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            window_restore::show_main_window(app);
        }))
        .plugin(tauri_plugin_deep_link::init())
        .on_page_load(|webview, payload| {
            if payload.event() == tauri::webview::PageLoadEvent::Finished
                && webview.label() == "main"
            {
                window_background::reveal_main_window(tauri::Manager::app_handle(webview));
            }
        });

    #[cfg(mobile)]
    let builder = builder.plugin(tauri_plugin_deep_link::init());

    let builder = builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(library_db::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_http::init())
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

    // Update ships for the Linux and Windows NSIS builds (ADR 0037); the web,
    // Android, and the Arch package never reach it, and the adapter reports
    // `unknown` elsewhere.
    #[cfg(any(target_os = "linux", target_os = "windows"))]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

    builder
        .manage(dictation::commands::DictationState::default())
        .invoke_handler(tauri::generate_handler![
            tray::set_tray_syncing,
            #[cfg(any(target_os = "linux", target_os = "windows"))]
            resource_usage::configure_tray,
            #[cfg(any(target_os = "linux", target_os = "windows"))]
            resource_usage::refresh_tray_storage,
            #[cfg(any(target_os = "linux", target_os = "windows"))]
            resource_usage::resource_usage_summary,
            #[cfg(desktop)]
            window_background::set_window_background,
            android_exit::exit_app,
            library_db::library_execute_atomic,
            backup::pick_backup_directory,
            backup::request_backup_directory,
            backup::restore_backup_directory,
            backup::forget_backup_directory,
            plugins::list_plugin_folders,
            plugins::read_plugin_folder,
            plugins::replace_builtin_plugin_folder,
            plugins::pick_plugin_directory,
            plugins::request_plugin_directory,
            plugins::forget_plugin_directory,
            plugins::add_plugin_from_zip,
            plugins::remove_plugin_folder,
            #[cfg(desktop)]
            plugins::add_plugin_from_folder,
            #[cfg(desktop)]
            plugins::open_plugin_directory,
            #[cfg(desktop)]
            plugins::watch_plugin_directory,
            #[cfg(desktop)]
            plugins::unwatch_plugin_directory,
            #[cfg(desktop)]
            plugins::endpoint::plugin_endpoint_sync,
            #[cfg(desktop)]
            plugins::endpoint::plugin_endpoint_respond,
            #[cfg(desktop)]
            plugins::endpoint::plugin_endpoint_chunk,
            #[cfg(desktop)]
            plugins::endpoint::plugin_endpoint_end,
            #[cfg(desktop)]
            plugins::files::plugin_files_pick,
            #[cfg(desktop)]
            plugins::files::plugin_files_read,
            #[cfg(desktop)]
            plugins::files::plugin_files_stat,
            #[cfg(desktop)]
            plugins::files::plugin_files_release,
            #[cfg(desktop)]
            plugins::files::plugin_files_list,
            #[cfg(desktop)]
            plugins::files::plugin_files_clear_plugin,
            #[cfg(desktop)]
            plugins::files::plugin_files_clear_all,
            #[cfg(any(target_os = "linux", target_os = "windows"))]
            plugins::secrets::plugin_secret_set,
            #[cfg(any(target_os = "linux", target_os = "windows"))]
            plugins::secrets::plugin_secret_delete,
            #[cfg(any(target_os = "linux", target_os = "windows"))]
            plugins::secrets::plugin_secret_list_names,
            #[cfg(any(target_os = "linux", target_os = "windows"))]
            plugins::secrets::plugin_secret_read,
            #[cfg(any(target_os = "linux", target_os = "windows"))]
            plugins::secrets::plugin_secret_clear_plugin,
            #[cfg(any(target_os = "linux", target_os = "windows"))]
            plugins::secrets::plugin_secret_clear_all,
            dictation::commands::dictation_is_supported,
            dictation::commands::dictation_load,
            dictation::commands::dictation_start,
            dictation::commands::dictation_stop,
            dictation::commands::dictation_set_context,
            dictation::commands::dictation_unload,
            dictation::commands::dictation_input_device,
            dictation::commands::dictation_models_install,
            dictation::commands::dictation_models_cancel,
            dictation::commands::dictation_models_is_complete,
            dictation::commands::dictation_models_remove
        ])
        .setup(|app| {
            backup::protect_approval(app.handle())?;

            // The Plugin Directory must exist for the author to drop Plugins
            // into, and must never be readable or writable by the webview
            // (ADR 0020). Both are best-effort: a device without a Documents
            // folder still launches, with no Plugins installed.
            if let Err(error) = plugins::directory::ensure(app.handle()) {
                eprintln!("Plugin Directory unavailable: {error}");
            }
            if let Err(error) = plugins::directory::protect(app.handle()) {
                eprintln!("Plugin Directory protection failed: {error}");
            }

            // The desktop keychain backs Plugin secrets (ADR 0023). Opening it
            // is best-effort: a device whose keychain is missing keeps every
            // secret command reporting that, and still launches.
            #[cfg(any(target_os = "linux", target_os = "windows"))]
            plugins::secrets::init();

            #[cfg(desktop)]
            {
                use tauri::Manager;

                // The Plugin Endpoint keeps one port across launches, so an
                // address an author pasted into an Agent still works after a
                // restart (ADR 0031). Without an app data folder it still
                // picks a port for this run.
                let endpoint = match app.path().app_data_dir() {
                    Ok(data) => {
                        plugins::endpoint::EndpointState::new(data.join("plugin-endpoint-port"))
                    }
                    Err(error) => {
                        eprintln!("Plugin Endpoint port not kept: {error}");
                        plugins::endpoint::EndpointState::default()
                    }
                };
                app.manage(endpoint);

                // File Grants (ADR 0036) live in an app data file beside the
                // other device-local Plugin records, never in the Library, so
                // Backups and Sync do not carry them. Without an app data folder
                // they last for this run.
                let grants = match app.path().app_data_dir() {
                    Ok(data) => {
                        plugins::files::GrantStore::new(data.join(plugins::files::GRANTS_FILE))
                    }
                    Err(error) => {
                        eprintln!("File Grants not kept: {error}");
                        plugins::files::GrantStore::in_memory()
                    }
                };
                app.manage(grants);

                #[cfg(any(target_os = "linux", target_os = "windows"))]
                {
                    app.manage(resource_usage::ResourceUsage::default());
                    let handle = app.handle().clone();
                    tray_host::when_ready(move || {
                        if let Err(error) = tray::setup_tray(&handle) {
                            eprintln!("Tray icon unavailable: {error}");
                        }
                    });
                }

                // The window is created hidden (visible:false in tauri.conf.json)
                // and shown once its page has loaded (`on_page_load` above):
                // WebKitGTK paints a new WebView white until then, whatever its
                // background color (#624). The color still paints the window
                // the theme resolved to last time, or the stylesheet default
                // when the frontend never reported one.
                if let Some(win) = app.get_webview_window("main") {
                    let color = app
                        .path()
                        .app_data_dir()
                        .ok()
                        .and_then(|dir| window_background::read_background(&dir))
                        .unwrap_or_else(|| {
                            let dark = matches!(win.theme(), Ok(tauri::Theme::Dark));
                            window_background::default_background(dark)
                        });
                    let _ = win.set_background_color(Some(color));
                    let handle = app.handle().clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(window_background::REVEAL_FALLBACK);
                        window_background::reveal_main_window(&handle);
                    });
                }
                window_restore::complete_startup(app.handle());
            }

            Ok(())
        })
        .run(context)
        .expect("error while running tauri application");
}
