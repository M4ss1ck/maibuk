//! The Library pool is app-owned (ADR 0017, #196).
//!
//! The path is fixed in Rust so no webview path ever reaches SQLite, and the
//! plugin has no connect hook, so setup builds the pool and injects it into
//! the plugin's public `DbInstances` under `LIBRARY_DB_KEY`.

use std::path::{Path, PathBuf};

use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
use tauri::{AppHandle, Manager, Runtime};

pub const LIBRARY_DB_KEY: &str = "sqlite:maibuk.db";

pub fn library_db_path(config_dir: &Path) -> PathBuf {
    config_dir.join("maibuk.db")
}

fn connect_options(path: &Path) -> SqliteConnectOptions {
    SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true)
}

fn build_library_pool(path: &Path) -> SqlitePool {
    SqlitePoolOptions::new().connect_lazy_with(connect_options(path))
}

pub fn install_at<R: Runtime>(
    app: &AppHandle<R>,
    config_dir: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    std::fs::create_dir_all(config_dir)?;
    tauri::async_runtime::block_on(async {
        let pool = build_library_pool(&library_db_path(config_dir));
        app.state::<tauri_plugin_sql::DbInstances>()
            .0
            .write()
            .await
            .insert(
                LIBRARY_DB_KEY.to_string(),
                tauri_plugin_sql::DbPool::Sqlite(pool),
            );
        Ok::<(), Box<dyn std::error::Error>>(())
    })
}

pub fn install<R: Runtime>(app: &AppHandle<R>) -> Result<(), Box<dyn std::error::Error>> {
    install_at(app, &app.path().app_config_dir()?)
}

// Registered right after the sql plugin: plugin setup runs before Tauri creates any window, the app setup hook does not.
pub fn init<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("library-db")
        .setup(|app, _api| install(app))
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::test::MockRuntime;

    fn temp_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("maibuk-library-db-test-{name}-{}", std::process::id()))
    }

    fn build_app() -> tauri::App<MockRuntime> {
        tauri::test::mock_builder()
            .plugin(tauri_plugin_sql::Builder::default().build())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap()
    }

    fn installed_pool(handle: &AppHandle<MockRuntime>) -> SqlitePool {
        // IPC was not used: the mock app denies plugin commands through its
        // ACL ("sql.execute not allowed. Plugin not found"), so the pool is
        // driven directly from DbInstances with the same statements the
        // webview would send.
        let state = handle.state::<tauri_plugin_sql::DbInstances>();
        let guard = tauri::async_runtime::block_on(async { state.0.read().await });
        match guard
            .get(LIBRARY_DB_KEY)
            .expect("library pool is installed")
        {
            tauri_plugin_sql::DbPool::Sqlite(pool) => pool.clone(),
        }
    }

    #[test]
    fn opens_the_library_and_reads_back_a_row() {
        let dir = temp_dir("crud");
        let _ = std::fs::remove_dir_all(&dir);
        let app = build_app();
        install_at(app.handle(), &dir).unwrap();
        let pool = installed_pool(app.handle());
        tauri::async_runtime::block_on(async {
            sqlx::query("CREATE TABLE notes (id INTEGER PRIMARY KEY, title TEXT NOT NULL)")
                .execute(&pool)
                .await
                .unwrap();
            sqlx::query("INSERT INTO notes (title) VALUES (?)")
                .bind("hello")
                .execute(&pool)
                .await
                .unwrap();
            let title: String = sqlx::query_scalar("SELECT title FROM notes")
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(title, "hello");
        });
        assert!(library_db_path(&dir).is_file());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn install_is_lazy_and_surfaces_open_failures_on_first_query() {
        let dir = temp_dir("lazy");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(library_db_path(&dir)).unwrap();
        let app = build_app();
        assert!(install_at(app.handle(), &dir).is_ok());
        let pool = installed_pool(app.handle());
        let err = tauri::async_runtime::block_on(async {
            sqlx::query("SELECT 1").execute(&pool).await.unwrap_err()
        });
        assert!(!err.to_string().is_empty());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn instances_hold_exactly_the_library_key() {
        let dir = temp_dir("key");
        let _ = std::fs::remove_dir_all(&dir);
        let app = build_app();
        install_at(app.handle(), &dir).unwrap();
        let state = app.state::<tauri_plugin_sql::DbInstances>();
        let guard = tauri::async_runtime::block_on(async { state.0.read().await });
        let mut keys: Vec<&String> = guard.keys().collect();
        keys.sort();
        assert_eq!(keys, vec![&LIBRARY_DB_KEY.to_string()]);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn plugin_setup_injects_the_pool_before_any_window() {
        let dir = temp_dir("plugin-setup");
        let _ = std::fs::remove_dir_all(&dir);
        let setup_dir = dir.clone();
        // init() itself is not registered here: it would read the real app
        // config dir. Only its shape matters, and it is the shape that runs.
        let library_db_plugin: tauri::plugin::TauriPlugin<MockRuntime> =
            tauri::plugin::Builder::new("library-db-test")
                .setup(move |app, _api| install_at(app, &setup_dir))
                .build();
        let app = tauri::test::mock_builder()
            .plugin(tauri_plugin_sql::Builder::default().build())
            .plugin(library_db_plugin)
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        installed_pool(app.handle());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
