---
status: accepted
---

# A Backup Directory enters the fs scope only through native UI

On desktop the fs scope is the only thing that limits where the webview can write: the capability grants `fs:allow-write` and `fs:allow-remove` without a path, and the scope starts at the app config directory. A custom Backup Directory has to join that scope, and every launch starts with an empty runtime scope. Any grant the webview can request is also available to a script injected into it (for example through note HTML or pulled sync content), so the grant must come from native UI a script cannot fake: the Rust-side folder picker, or a native confirmation dialog, worded in Rust, for a typed path. The approved directory is recorded in `<app config dir>.trusted/backup-directory.json`, a sibling of the app config directory, so launch can grant it again without asking and background Backups never open a dialog.

## Considered Options

- A Rust command that grants any path the webview sends, plus `tauri-plugin-persisted-scope`: rejected, a script could grant itself `~/.ssh` and keep the grant forever, and the plugin also persists every file ever picked for import or export.
- Recording the approval inside the app config directory and denying that file: rejected, the webview can write anywhere under that directory and scope patterns match case-sensitively, so a differently cased path reaches the same file on macOS and Windows.
- Only the folder picker, no typed paths: rejected, typing a path is part of the Settings screen and the confirmation keeps it safe.

## Consequences

- A custom directory saved before approvals existed fails with `BACKUP_DIRECTORY_NOT_APPROVED` until the author confirms it again in Settings. Background Backups and pre-sync Backups fail for it in the meantime, as they already did after a restart.
- Going back to the default directory forgets the approval. The session keeps its grant until the app restarts.
- The approval directory is also forbidden in the fs scope at setup, so no later grant (such as the config directory's parent chosen as a Backup Directory) exposes it.
