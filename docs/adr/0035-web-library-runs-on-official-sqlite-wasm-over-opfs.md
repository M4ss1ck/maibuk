---
status: accepted
---

# The web Library runs on the official SQLite WASM build over OPFS

Library Search needs FTS5 on every platform. Desktop and Android already have it: `tauri-plugin-sql` builds SQLite through sqlx's bundled `libsqlite3-sys`, which compiles with `SQLITE_ENABLE_FTS5`. The web build used sql.js 1.13, which ships FTS4 but not FTS5, keeps the Library in memory, and writes the whole database to IndexedDB after every write. A search index would make each of those writes larger.

The web build moves to the SQLite project's own WASM build (`@sqlite.org/sqlite-wasm`), running in a Worker on the `opfs-sahpool` VFS. FTS5 is in its stock build, it is maintained by the SQLite team, it is served with the app instead of loaded from a CDN at runtime, and OPFS persists changed pages instead of exporting the whole database on every write. The `opfs-sahpool` VFS needs no COOP/COEP headers.

## Considered Options

- A custom sql.js build with `-DSQLITE_ENABLE_FTS5`: rejected. It gives FTS5 but keeps the whole-database export on every write, which the index makes larger, and leaves a build we maintain ourselves.
- FTS5 on desktop and FTS4 on web: rejected. Two query dialects, two ranking paths, and results that differ by platform.
- An in-memory JavaScript index: rejected. It parses every document at startup and holds the text in memory, which costs most on Android.

## Consequences

- One tab at a time: `opfs-sahpool` holds an exclusive lock, so a second Maibuk tab cannot open the Library and must say so. Before this, two tabs silently overwrote each other's IndexedDB saves.
- Private windows where OPFS is unavailable fall back to an in-memory Library and tell the author it will not be kept.
- Every web query crosses into the Worker.
- Existing web Libraries move once from the IndexedDB blob to OPFS, and the IndexedDB copy is kept until the first successful OPFS open.
- A spike confirms the lock, private-window, and migration behavior before the migration ticket starts.
