//! The Library pool is app-owned (ADR 0017, #196).
//!
//! The path is fixed in Rust so no webview path ever reaches SQLite, and the
//! plugin has no connect hook, so setup builds the pool and injects it into
//! the plugin's public `DbInstances` under `LIBRARY_DB_KEY`.
//! Every pooled connection installs a SQLite authorizer and turns on
//! SQLITE_DBCONFIG_DEFENSIVE. Plain VACUUM attaches the empty filename ''
//! internally, so ATTACH '' is allowed while every other ATTACH target is
//! denied (#196, ADR 0017).

use std::ffi::CStr;
use std::os::raw::{c_char, c_int, c_void};
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

fn attach_allowed(filename: Option<&CStr>) -> bool {
    match filename {
        Some(name) => name.to_bytes().is_empty(),
        None => false,
    }
}

extern "C" fn authorize(
    _user: *mut c_void,
    action: c_int,
    arg1: *const c_char,
    _arg2: *const c_char,
    _db: *const c_char,
    _trigger: *const c_char,
) -> c_int {
    if action == libsqlite3_sys::SQLITE_ATTACH {
        let filename = if arg1.is_null() {
            None
        } else {
            // SAFETY: SQLite passes a valid null-terminated string or null
            // for the filename argument of SQLITE_ATTACH.
            Some(unsafe { CStr::from_ptr(arg1) })
        };
        if attach_allowed(filename) {
            libsqlite3_sys::SQLITE_OK
        } else {
            libsqlite3_sys::SQLITE_DENY
        }
    } else {
        // DETACH and every other action stay allowed.
        libsqlite3_sys::SQLITE_OK
    }
}

async fn guard_connection(conn: &mut sqlx::SqliteConnection) -> Result<(), sqlx::Error> {
    let mut handle = conn.lock_handle().await?;
    let db = handle.as_raw_handle().as_ptr();
    unsafe {
        // SAFETY: db is a live open SQLite handle borrowed from the locked
        // connection guard, which outlives this block. Both calls only set
        // per-connection guards and transfer no ownership.
        let auth_rc = libsqlite3_sys::sqlite3_set_authorizer(
            db,
            Some(authorize),
            std::ptr::null_mut(),
        );
        if auth_rc != libsqlite3_sys::SQLITE_OK {
            return Err(sqlx::Error::Configuration(
                "failed to install the Library SQLite authorizer".into(),
            ));
        }
        let defensive_rc = libsqlite3_sys::sqlite3_db_config(
            db,
            libsqlite3_sys::SQLITE_DBCONFIG_DEFENSIVE,
            1 as c_int,
            std::ptr::null_mut::<c_int>(),
        );
        if defensive_rc != libsqlite3_sys::SQLITE_OK {
            return Err(sqlx::Error::Configuration(
                "failed to enable SQLITE_DBCONFIG_DEFENSIVE on the Library connection".into(),
            ));
        }
    }
    Ok(())
}

fn build_library_pool(path: &Path) -> SqlitePool {
    SqlitePoolOptions::new()
        .after_connect(|conn, _meta| Box::pin(async move { guard_connection(conn).await }))
        .connect_lazy_with(connect_options(path))
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

    fn outside_is_empty(outside: &Path) -> bool {
        std::fs::read_dir(outside).map(|mut d| d.next().is_none()).unwrap_or(false)
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

    #[test]
    fn attach_variants_and_vacuum_into_are_denied() {
        let dir = temp_dir("guard-attach");
        let outside = temp_dir("guard-attach-outside");
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&outside);
        std::fs::create_dir_all(&outside).unwrap();
        let app = build_app();
        install_at(app.handle(), &dir).unwrap();
        let pool = installed_pool(app.handle());
        tauri::async_runtime::block_on(async {
            let direct = format!("ATTACH '{}' AS x", outside.join("x.db").display());
            assert!(sqlx::query(&direct).execute(&pool).await.is_err());

            let bound_path = outside.join("p.db").to_string_lossy().to_string();
            assert!(
                sqlx::query("ATTACH ? AS x")
                    .bind(bound_path)
                    .execute(&pool)
                    .await
                    .is_err()
            );

            let concat = format!("ATTACH '{}' || '.db' AS x", outside.join("c").display());
            assert!(sqlx::query(&concat).execute(&pool).await.is_err());

            let uri = format!("ATTACH 'file:{}?mode=rwc' AS x", outside.join("u.db").display());
            assert!(sqlx::query(&uri).execute(&pool).await.is_err());

            assert!(
                sqlx::query("ATTACH ':memory:' AS m")
                    .execute(&pool)
                    .await
                    .is_err()
            );

            let vacuum_into = format!("VACUUM INTO '{}'", outside.join("y.db").display());
            assert!(sqlx::query(&vacuum_into).execute(&pool).await.is_err());
        });
        assert!(outside_is_empty(&outside));
        std::fs::remove_dir_all(&dir).unwrap();
        std::fs::remove_dir_all(&outside).unwrap();
    }

    #[test]
    fn vacuum_and_wal_checkpoint_succeed() {
        let dir = temp_dir("guard-compact");
        let _ = std::fs::remove_dir_all(&dir);
        let app = build_app();
        install_at(app.handle(), &dir).unwrap();
        let pool = installed_pool(app.handle());
        tauri::async_runtime::block_on(async {
            sqlx::query("CREATE TABLE t (id INTEGER PRIMARY KEY, body TEXT)")
                .execute(&pool)
                .await
                .unwrap();
            for i in 0..10 {
                sqlx::query("INSERT INTO t (body) VALUES (?)")
                    .bind(format!("row {i}"))
                    .execute(&pool)
                    .await
                    .unwrap();
            }
            sqlx::query("DELETE FROM t WHERE id <= 5")
                .execute(&pool)
                .await
                .unwrap();
            sqlx::query("VACUUM").execute(&pool).await.unwrap();
            // The compactLibrary() sequence ends with a WAL checkpoint.
            sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
                .fetch_all(&pool)
                .await
                .unwrap();
        });
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn empty_attach_and_detach_succeed_and_vacuum_still_works() {
        let dir = temp_dir("guard-empty-attach");
        let _ = std::fs::remove_dir_all(&dir);
        let app = build_app();
        install_at(app.handle(), &dir).unwrap();
        let pool = installed_pool(app.handle());
        tauri::async_runtime::block_on(async {
            // ATTACH and DETACH must share one connection: the pool may hand
            // consecutive statements to different connections.
            let mut conn = pool.acquire().await.unwrap();
            sqlx::query("ATTACH '' AS e")
                .execute(&mut *conn)
                .await
                .unwrap();
            sqlx::query("DETACH e").execute(&mut *conn).await.unwrap();
            sqlx::query("VACUUM").execute(&pool).await.unwrap();
        });
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn every_pooled_connection_denies_attach() {
        let dir = temp_dir("guard-pool");
        let outside = temp_dir("guard-pool-outside");
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&outside);
        std::fs::create_dir_all(&outside).unwrap();
        let app = build_app();
        install_at(app.handle(), &dir).unwrap();
        let pool = installed_pool(app.handle());
        tauri::async_runtime::block_on(async {
            let mut first = pool.acquire().await.unwrap();
            let mut second = pool.acquire().await.unwrap();
            let mut third = pool.acquire().await.unwrap();
            let attack = format!("ATTACH '{}' AS x", outside.join("x.db").display());
            assert!(
                sqlx::query(&attack)
                    .execute(&mut *first)
                    .await
                    .is_err()
            );
            assert!(
                sqlx::query(&attack)
                    .execute(&mut *second)
                    .await
                    .is_err()
            );
            assert!(
                sqlx::query(&attack)
                    .execute(&mut *third)
                    .await
                    .is_err()
            );
        });
        assert!(outside_is_empty(&outside));
        std::fs::remove_dir_all(&dir).unwrap();
        std::fs::remove_dir_all(&outside).unwrap();
    }

    #[test]
    fn database_file_import_stops_at_attach_without_applying_later_statements() {
        let dir = temp_dir("guard-import");
        let outside = temp_dir("guard-import-outside");
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&outside);
        std::fs::create_dir_all(&outside).unwrap();
        let app = build_app();
        install_at(app.handle(), &dir).unwrap();
        let pool = installed_pool(app.handle());
        tauri::async_runtime::block_on(async {
            // Mirrors the TS adapter importData loop: one statement at a
            // time, stopping at the first error. Loading is non-atomic
            // until #344, so earlier statements stay applied.
            let statements = [
                "CREATE TABLE notes (id INTEGER PRIMARY KEY, title TEXT)".to_string(),
                "INSERT INTO notes (title) VALUES ('a')".to_string(),
                "INSERT INTO notes (title) VALUES ('b')".to_string(),
                format!("ATTACH '{}' AS x", outside.join("i.db").display()),
                "INSERT INTO notes (title) VALUES ('c')".to_string(),
            ];
            let mut stopped_at: Option<usize> = None;
            for (index, statement) in statements.iter().enumerate() {
                if sqlx::query(statement).execute(&pool).await.is_err() {
                    stopped_at = Some(index);
                    break;
                }
            }
            assert_eq!(stopped_at, Some(3));
            let count: i64 = sqlx::query_scalar("SELECT count(*) FROM notes")
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(count, 2);
        });
        assert!(outside_is_empty(&outside));
        std::fs::remove_dir_all(&dir).unwrap();
        std::fs::remove_dir_all(&outside).unwrap();
    }

    #[test]
    fn attach_allowed_matches_the_authorizer_rule() {
        assert!(!attach_allowed(None));
        assert!(attach_allowed(Some(c"")));
        assert!(!attach_allowed(Some(c"x.db")));
        assert!(!attach_allowed(Some(c":memory:")));
    }
}
