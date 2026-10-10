---
status: accepted
---

# The Change Feed carries Library signals and a view-refresh hint

ADR 0003's per-entity Change stays `{ entity, id, origin, kind }`, and the same stream now carries two more logical Library signals (ADR 0023): a completed bulk operation `{ scope: "all", reason: "restore" | "resetLibrary" | "databaseLoad" }`, emitted once after Backup Restore, Reset Library, or loading a Database File succeeds and never after a failure; and Library availability `{ available, reason: "tutorial" }`, false while the Tutorial Library is active and true when the author's Library is back. An emission can also carry a view-refresh hint in a second listener argument, `{ viewUpdated: true }`, set by the write paths the stores call: the writing store re-reads its own view after the save, so view refresh skips the Change; an outside writer (a Plugin, an import, a Version restore) emits without it and every view holding the row re-reads. Failed writes emit nothing, and a partial multi-write failure describes only the rows that persisted.

Decided in [Plugins vs. the Tutorial Library, Backups, Restore, and Sync](https://github.com/M4ss1ck/maibuk/issues/398#issuecomment-5974514362), from the view-refresh gap in [Plugin API surface v1](https://github.com/M4ss1ck/maibuk/issues/396#issuecomment-5963713159), and implemented in [View refresh on local-Origin Changes, and Library lifecycle signals on the Change Feed](https://github.com/M4ss1ck/maibuk/issues/430). ADR 0003 keeps the Change's shape; this record adds the rest of the stream's contract.

## Considered options

- Refresh every local Change, stores included: rejected. Each keystroke-save would re-read the whole Book's Chapters or the whole Note library, and a store's own post-write `set` races the refresh it triggered (a create would appear twice).
- A distinct Origin value for outside writers: rejected. Origin answers "this device or another" (ADR 0003), a Plugin write is a local edit that must schedule Auto Sync, and #398 forbids mislabelling it remote.
- A `viewUpdated` field on the Change itself: rejected. The hint concerns view refresh, not the event; the Change's shape is also the future `library.changed` payload for Plugins, which re-read anyway.
- Consumers filter Tutorial sample Changes themselves: rejected. ADR 0008 isolates the sample Library by construction; consumers that act on local Changes check `isTutorialLibraryActive()` (Auto Sync does) and the availability signal tells the rest.

## Consequences

- `emitChange()` takes an optional meta; listeners that ignore it keep working. `STORE_VIEW` is the shared meta for store-originated writes.
- Every store-facing write path takes an optional trailing `ChangeFeedMeta`, and the stores pass `STORE_VIEW`; a direct write-path caller — Import, Restore, a Plugin — needs no change to reach open views.
- View refresh reacts to remote Changes as before and to local Changes without the marker; the Edit Session drops its own save's echo, so a refresh never replaces what the store just wrote.
- Bulk signals are not entity Changes: Auto Sync ignores them, and a Restore that fails leaves no completion signal.
- The Tutorial brackets entry and exit with availability; a failed entry that activated the Library returns availability on rollback, and an entry stopped before switching emits nothing.
