---
status: accepted
---

# The Library pool is app-owned inside tauri-plugin-sql

On desktop and Android the webview reached SQLite through `tauri-plugin-sql`, and that let any script in it open, read, write, or create SQLite files anywhere the user can write (#196): `load` joins the path with `PathBuf::push`, so an absolute path or `..` escapes the app config directory, and `execute`/`select` pass `ATTACH` and `VACUUM INTO` straight to SQLite. The plugin has no connect hook, so we keep it for its commands and value decoding but the app builds the Library's pool itself: a lazy pool on the fixed path `<app config dir>/maibuk.db`, inserted into the plugin's public `DbInstances` under `sqlite:maibuk.db`, with an `after_connect` that installs a SQLite authorizer and turns on `SQLITE_DBCONFIG_DEFENSIVE`. The webview gets only `execute` and `select`; `load` and `close` are not granted, and `preload` is gone so the plugin never opens an unguarded pool.

The authorizer allows `ATTACH` only for the empty filename and denies every other one, allows `DETACH`, and allows only the PRAGMAs the app uses, and only as reads (`wal_checkpoint` and `table_info` take their argument), and denies `load_extension()`. Denying `ATTACH` outright is not possible: plain `VACUUM`, which `compactLibrary()` runs, attaches `''` internally and the authorizer sees it as `SQLITE_ATTACH` (checked on SQLite 3.53.1), and `SQLITE_LIMIT_ATTACHED = 0` breaks it the same way. `VACUUM INTO` reports its target as the filename, so it is denied.

## Considered Options

- Dropping the plugin for app-owned `execute`/`select` commands: rejected, it moves value decoding and every plugin fix onto us for no extra safety.
- Forking or vendoring the plugin to add a hook: rejected, the same maintenance with three unused drivers and `load` still in the code.
- Waiting for an upstream connect hook: rejected, the hole is open now. If one ships, the pool builder moves onto it and the injection goes.
- Removing only `sql:allow-load`: not enough, `sql:default` grants `allow-load` too.

## Consequences

- The app depends on `DbInstances` and `DbPool` being public in `tauri-plugin-sql` 2.x, and on `libsqlite3-sys` matching the version sqlx links.
- A new PRAGMA in app code fails until it joins the allow-list.
- Loading a Database File that contains `ATTACH` fails with no file created, but statements before it still apply; loading is not atomic (separate issue).
