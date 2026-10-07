---
status: accepted
---

# Plugin data is Library data, backed up but not synced, and secrets stay in the keychain

Each Plugin stores its data in its own namespace in the Library. Backups include that data, even when the Plugin is absent. Saving a Database File includes it too. Restoring a Backup replaces it, and Reset Library clears it. It is not synced in v1, and a change to it never schedules a Sync. Secrets, such as a bring-your-own API key, are write-only through the API. They live in the OS keychain (`keyring-core`) and never in the Library, a Backup, or a Database File. The broker injects them into network requests by name. Plugin Workers stay alive through the Tutorial, while the host refuses their Library, storage, and editor calls and suspends Library events. Built-in Plugins get no exemption. When a Plugin writes a Chapter or a Note, the write goes through the real per-entity write path with local Origin, and the Change Feed announces it to open views, Sync scheduling, and other Plugins, which each decide how to react.

Decided in [Plugins vs. the Tutorial Library, Backups, Restore, and Sync](https://github.com/M4ss1ck/maibuk/issues/398#issuecomment-5974514362) and [Plugin Directory and secret storage on desktop, Android, and web](https://github.com/M4ss1ck/maibuk/issues/393#issuecomment-5963723956) (secrets). The `dataVersion` gate is in [Plugin manifest schema and API versioning](https://github.com/M4ss1ck/maibuk/issues/400#issuecomment-5975037577).

## Considered Options

- Plugin data in device settings (localStorage), like Custom Shortcuts (ADR 0012): rejected. An author who restores a Backup would lose the Plugin's work, such as an Echoes ignore list.
- Sync Plugin data through Entity Sync in v1: rejected. Entity Sync's adapter shape is the three-way Push, Pull, or Conflict decision over Synced Items (ADR 0007), and an opaque Plugin namespace has nothing that decision could compare.
- Secrets in the Library, encrypted: rejected. A Backup would carry a key off the device, and the key to decrypt it would need a home of its own.
- Stop and restart Plugins around the Tutorial: rejected. Every persistent Plugin would need to save and restore its state. Refusing access at the broker isolates the Tutorial Library (ADR 0008) without that.

## Consequences

- View refresh must react to local-Origin Changes before Plugins may write. Today it filters to remote Origin.
- A Plugin write first Flushes the target editor and is refused if that save fails, so the author's typing is never overwritten.
- Reset settings is distinct from Reset Library. It clears grants, integrity approvals, Plugin Custom Shortcuts, and saved secrets, and leaves Plugin data alone.
- The web Library writes the whole database on every save, so Settings shows each Plugin's data size and warns once at 50 MB. There is no hard cap.
- Data written by a newer `dataVersion` is preserved and refuses activation. Data at an older version is migrated by the Plugin's own `migrateData`, never by the host.
