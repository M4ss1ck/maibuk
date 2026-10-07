---
status: accepted
---

# Only Rust reads the Plugin Directory, and Plugins are pinned by a directory hash

A Plugin is a folder: `manifest.json`, one JavaScript entry module, and assets. A `.zip` is only how a folder travels. When the author approves a Plugin, Maibuk pins its content hash: a Go-style `h1:` hash over the sorted list of per-file SHA-256 digests. If any file changes, the Plugin stays off until it is reviewed again, and the per-file list doubles as the diff for that review. A Plugin marked "in development" on this device skips the pin and hot-reloads. On desktop and Android, only Rust lists, reads, hashes, copies, and watches the Plugin Directory. Rust hands the webview the exact bytes it hashed, so nothing can change between the check and the load. The directory is forbidden in the webview fs scope at setup, never granted. ADR 0010 grants a Backup Directory; this ADR is the reverse. A Backup the webview can overwrite loses data, but a Plugin file the webview can overwrite is code that runs, and an "in development" Plugin is not protected by its hash.

Decided in [Plugin packaging and integrity: what the state of the art does](https://github.com/M4ss1ck/maibuk/issues/390#issuecomment-5963715536) and [Plugin Directory and secret storage on desktop, Android, and web](https://github.com/M4ss1ck/maibuk/issues/393#issuecomment-5963723956). The sources are in `docs/research/plugins-packaging.md` and `docs/research/plugins-directory-secrets.md`.

## Considered Options

- A default folder under the app data or config directory, with a forbid rule: rejected on desktop. Those folders are webview-writable, and on Windows a new file whose path differs only in case escapes a case-sensitive forbid pattern (the same hazard ADR 0010 records). It is fine on Android, which uses app-private `$APPDATA/plugins`.
- Let the webview read the folder and verify the hash itself: rejected. That leaves a gap between check and load, and it needs an fs grant to the folder.
- Signed Plugins or a registry in v1: rejected. Nothing would arbitrate who owns an id. A later registry can sign the `h1:` value, so v1 Plugins stay valid without a migration.
- Native binaries or WebAssembly-only entries: rejected. The entry is JavaScript, which may load its own hashed `.wasm`.

## Consequences

- The desktop default is `$DOCUMENT/Maibuk/Plugins`. Another folder joins through the ADR 0010 approval path, recorded in `<app config dir>.trusted/plugin-directory.json`.
- Android installs from a `.zip` through a Rust-side picker and has no hot reload in v1. Web keeps Plugins in OPFS and hashes them with Web Crypto. One shared fixture proves that both hash implementations agree.
- Built-in Plugins are copied into the Plugin Directory. On app update, a copy whose hash matches the shipped one is replaced. An edited copy is kept and marked modified.
