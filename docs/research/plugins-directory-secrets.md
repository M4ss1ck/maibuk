# Plugin Directory and secret storage on desktop, Android, and web

Research for issue [#393](https://github.com/M4ss1ck/maibuk/issues/393), map [#389](https://github.com/M4ss1ck/maibuk/issues/389). Research date: 2026-10-02. Maibuk paths are relative to the repo root at `bed1e51d`.

Standing decisions from #389 that this builds on and does not reopen: the Plugin Directory is a folder configured in Settings that holds copies of the Built-in Plugins (6); a plugin's content hash is pinned at approval and "in development" plugins skip that and hot-reload (7); plugin data lives in the Library, secrets go in the OS keychain, never in the Library or a Backup (9); every platform runs plugins (5).

Pinned sources:

| Source | Ref |
| --- | --- |
| Tauri | `2.9.5` (from `src-tauri/Cargo.lock`), source at tag `tauri-v2.9.5` |
| tauri-plugin-fs | `2.4.4` in `Cargo.lock`; source read at branch `v2` of `tauri-apps/plugins-workspace` (crate `2.6.0`) |
| MDN browser-compat-data | `8.1.4` (2026-10-01) |
| keyring-core / store crates | crates.io API, 2026-10-02 |

---

## Summary and recommendation

1. **The webview never reads or writes the Plugin Directory.** Rust lists, reads, hashes, copies, and watches it, and hands the webview the exact bytes it hashed. The directory is *forbidden* in the fs scope at setup (like the ADR 0010 approval file), not granted. This is stricter than the Backup Directory, and it has to be: a Backup the webview can overwrite is data loss, but a plugin file the webview can overwrite is code that runs, and an "in development" plugin skips the pinned hash. Delivering hashed bytes from Rust also closes the gap between "hash checked" and "file loaded".
2. **Desktop default: a user-visible folder outside every webview-writable pattern**, recommended `$DOCUMENT/Maibuk/Plugins` (Linux XDG Documents, Windows `Documents`). The app-specific folders are all webview-writable today (section 1.1), and on Windows a forbid rule can be bypassed for new files by changing case (section 1.2). Another folder is chosen through the ADR 0010 mechanism: Rust-side native picker or a Rust-worded confirmation, approval recorded in `<app config dir>.trusted/plugin-directory.json`. Changes are detected in Rust with `notify` (already a transitive option of tauri-plugin-fs), debounced, and announced to the webview as events.
3. **Android default: app-private `$APPDATA/plugins`**, forbidden in the webview fs scope at setup. The author installs a plugin with a Rust-side native file picker for a `.zip` (Tauri's dialog cannot pick folders on Android). No user-chosen SAF folder in v1: it needs a third-party plugin on its 29th major version. No hot reload on Android in v1.
4. **Web default: OPFS** (`navigator.storage.getDirectory()`, Baseline since March 2023). On Chromium (desktop 86+, Android 132+) Settings can switch to a real folder through `showDirectoryPicker()`, with the handle in IndexedDB and permission re-asked per visit unless the author picked "Allow on every visit" (Chrome 122+). Firefox and Safari: OPFS only, install from a `.zip` or a folder through `<input type="file">` (with `webkitdirectory`, supported everywhere) or drop. Change detection: `FileSystemObserver` where it exists (Chrome/Edge 133+ desktop), otherwise re-hash on window focus plus a "Reload plugins" Command.
5. **Secrets: `keyring-core` 1.0 with per-platform store crates**, all maintained by the same organization: `windows-native-keyring-store` (Credential Manager), `zbus-secret-service-keyring-store` or `dbus-secret-service-keyring-store` (Linux Secret Service), `android-native-keyring-store` (SharedPreferences encrypted with an Android Keystore key). One Rust API on every native target. Reject `tauri-plugin-stronghold` (a Tauri maintainer said it "will be deprecated and therefore removed in v3"; its engine's last release was May 2024).
6. **Web secrets have no keychain, and the UI says so.** Default: kept in memory for the session only. Opt-in "Remember in this browser": stored in IndexedDB, outside the Library and Backups, labelled as readable by anything that runs in Maibuk's page in this browser profile. Passphrase encryption and non-extractable WebCrypto keys do not change that against a script in the page; skip them in v1.

---

## Per-platform table

| | Desktop (Linux, Windows) | Android | Web |
| --- | --- | --- | --- |
| **Default directory** | `$DOCUMENT/Maibuk/Plugins`, created by Rust; Built-in Plugins copied in by Rust | `$APPDATA/plugins` (app-private, `getFilesDir()`), Built-ins copied in by Rust | OPFS `plugins/` |
| **Author changes it** | Settings row; Rust native folder picker (`pick_plugin_directory`) or typed path with Rust-worded native confirmation; approval in `<config>.trusted/plugin-directory.json` (ADR 0010 pattern) | Not changeable in v1; "Add Plugin" opens a Rust-side native file picker for a `.zip`, Rust unpacks it | Chromium: "Use a folder on this device" via `showDirectoryPicker()`, handle in IndexedDB. Others: no folder; "Add Plugin" from `.zip`, folder input, or drop |
| **Change detection** | Rust `notify` + debouncer on the approved root, recursive; event `plugins://changed { id }`; hashes re-checked in Rust | On launch and on "Reload plugins"; hot reload not offered in v1 | `FileSystemObserver` (Chrome/Edge 133+ desktop); else re-hash on `focus`/`visibilitychange` and a "Reload plugins" Command |
| **Files reach the sandbox** | Rust command returns `{ hash, files }` from one read; webview builds a Blob URL Worker. `Frame` iframes can be served from a custom scheme (`maibuk-plugin://`) for a separate origin | Same as desktop | Main thread reads OPFS/handle, hashes with `crypto.subtle.digest`, Blob URL Worker |
| **Webview fs scope** | Plugin Directory forbidden recursively at setup; never granted | Same (forbid `$APPDATA/plugins`) | No fs scope; the origin owns OPFS |
| **Secret storage** | `keyring-core` + Windows Credential Manager / Linux Secret Service store | `keyring-core` + `android-native-keyring-store` (Keystore-encrypted) | Session memory by default; opt-in IndexedDB "Remember in this browser" |

---

## 1. Desktop

### 1.1 The app-specific folders are all webview-writable today

Maibuk's desktop capability grants `fs:default`, `fs:allow-appconfig-write-recursive`, and `fs:allow-write`, `fs:allow-remove`, `fs:allow-mkdir` without a path (`src-tauri/capabilities/desktop.json`; Android has the same in `android.json`).

- `fs:default` is the set `create-app-specific-dirs`, `read-app-specific-dirs-recursive`, `deny-default` ([permissions/default.toml](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/fs/permissions/default.toml)).
- `read-app-specific-dirs-recursive` includes the permission `scope-app-recursive` ([read-app-specific-dirs-recursive.toml](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/fs/permissions/read-app-specific-dirs-recursive.toml)), which allows `$APPCONFIG/**`, `$APPDATA/**`, `$APPLOCALDATA/**`, `$APPCACHE/**`, `$APPLOG/**` and lists no commands ([app.toml](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/fs/permissions/app.toml)).
- Tauri's ACL resolver puts a permission with no allowed or denied commands into the plugin's **global** scope: `if commands.allow.is_empty() && commands.deny.is_empty() { // global scope` ([tauri-utils acl/resolved.rs#L110-L112](https://github.com/tauri-apps/tauri/blob/tauri-v2.9.5/crates/tauri-utils/src/acl/resolved.rs#L110-L112)).

So the global scope covers every app-specific folder, and `fs:allow-write` (no command scope) writes anywhere in it. A default Plugin Directory under `$APPDATA`, `$APPLOCALDATA`, or `$APPCONFIG` is writable by the webview unless Rust forbids it. ADR 0010 says "the scope starts at the app config directory"; per this source reading it also starts at the other four. **Unverified by test**: settle it with a Rust test that builds the app's resolved scope and asserts `app.fs_scope().is_allowed(app_data_dir.join("x"))`, next to `grants_only_approved_directories_and_never_the_approval` in `src-tauri/src/backup.rs`.

On Windows `$APPCONFIG` and `$APPDATA` are the same folder (`{FOLDERID_RoamingAppData}\com.massick.maibuk`), per the `dirs` mapping Tauri's `PathResolver` uses ([docs.rs tauri::path::PathResolver](https://docs.rs/tauri/2.9.5/tauri/path/struct.PathResolver.html)); unverified on a Windows machine.

### 1.2 Why the default sits outside those patterns, not inside with a forbid

`Scope::is_allowed` and `is_forbidden` canonicalize the checked path only when it exists: `if !path.exists() { Ok(path) } else { std::fs::canonicalize(path) }` ([tauri scope/fs.rs#L395-L406](https://github.com/tauri-apps/tauri/blob/tauri-v2.9.5/crates/tauri/src/scope/fs.rs#L395-L406)), and patterns match with `glob::MatchOptions` defaults apart from the separator and dot options ([#L213-L221](https://github.com/tauri-apps/tauri/blob/tauri-v2.9.5/crates/tauri/src/scope/fs.rs#L213-L221)), which are case-sensitive. On Windows (case-insensitive NTFS), a *new* file at `...\com.massick.maibuk\PLUGINS\echoes\x.js` is not canonicalized, does not match a forbid on `...\plugins\**`, and still matches the allowed `$APPCONFIG/**` prefix. Existing files canonicalize to their real case, so overwriting is blocked; adding a file is not. An "in development" plugin skips the pinned hash, so an added module would run. This is the same hazard ADR 0010 records for the approval file ("scope patterns match case-sensitively"), and the same fix: put the folder outside every allowed pattern. Keep the recursive forbid at setup anyway (as `protect_approval` does), so a later Backup Directory grant cannot expose it.

Default candidates:

| Candidate | Outside allowed patterns | Author can find and edit it | Notes |
| --- | --- | --- | --- |
| `$DOCUMENT/Maibuk/Plugins` (recommended) | Yes | Yes | On Windows `Documents` is often redirected to OneDrive; Files On-Demand placeholders could make reads slow or fail offline (unverified; settle by testing a OneDrive-backed Documents). |
| `$HOME/.maibuk/plugins` | Yes | Hidden on Linux | Familiar to developers (VS Code uses `~/.vscode/extensions`), unfriendly to authors. |
| `<app config dir>.plugins` (sibling, ADR 0010 style) | Yes | Awkward path | Mirrors `.trusted`; hard to explain in Settings. |
| `$APPDATA/plugins` + forbid | No | Hidden path | Rejected for desktop, section 1.2. Fine on Android (case-sensitive filesystem, app-private). |

### 1.3 Choosing another folder: reuse ADR 0010 as is

`src-tauri/src/backup.rs` already has every piece: `validate_directory`, `approval_dir` (the `<config>.trusted` sibling), `read_approval`/`write_approval`/`clear_approval`, `scope_paths` (given path plus real path), Rust-worded `confirmation_text` in both locales, `pick_backup_directory` (`blocking_pick_folder` with the window as parent), and `request_backup_directory`. A Plugin Directory needs the same commands with a second approval file and its own wording ("Maibuk will run plugins from this folder"). The difference is the last step: instead of `grant` (`allow_directory`), Rust records the root for its own loader and calls `forbid_directory(path, true)` for every entry of `scope_paths(path)`.

The approval matters even though the webview gets no fs access: a Rust command that reads files from a root the webview names is a read primitive, so the root must come from native UI or a recorded approval. The loader must also refuse paths that leave the root after canonicalization (symlinks), and `..` components.

### 1.4 Watching for hot reload

- `tauri-plugin-fs` has a `watch` Cargo feature (`watch = ["notify", "notify-debouncer-full"]`, [plugins/fs/Cargo.toml](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/fs/Cargo.toml)) and JS `watch`/`watchImmediate` ([Tauri docs, File System](https://v2.tauri.app/plugin/file-system/)). Its watcher resolves the path through the same global and command scope (`resolve_path(..., &global_scope, &command_scope, ...)` in [src/watcher.rs](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/fs/src/watcher.rs)), so the JS API would need the Plugin Directory in scope. Do not use it.
- Use `notify` directly in Rust: 8.2.0 (2026-08-30), 41M recent downloads, repo pushed 2026-09-28 (`notify-rs/notify`, 3.5k stars, not archived). `notify-debouncer-full` 0.7.0 (2026-05-02). The fs plugin pins `notify = "8"` and `notify-debouncer-full = "0.6"`, so the code is already in Maibuk's dependency graph only if the `watch` feature is on; it is not today.
- Watch only plugins marked "in development", map each event to its plugin folder, debounce (about 200 ms), re-hash in Rust, and emit one event per plugin. Non-development plugins are re-hashed at launch and on "Reload plugins"; a changed hash turns the plugin off until it is reviewed (decision 7).
- Linux inotify has a per-user watch limit (`fs.inotify.max_user_watches`); watching only development plugins keeps the count small. Unverified for very large `node_modules`-style folders; the manifest should name the files to load so the watcher can ignore the rest.

### 1.5 Getting files into the sandbox

- **Worker**: a Rust command (`load_plugin(id)`) reads the files once, computes the hash over those bytes, compares it with the pinned hash (skipped for development plugins), and returns `{ hash, files }`. The webview creates the Worker from a Blob URL. Maibuk already creates module Workers (`src/lib/spellcheck/SpellCheckService.ts:35`, `src/features/sync/sync-codec.ts:50`), and `tauri.conf.json` has `"csp": null`, so a Blob Worker needs no config change today; the sandbox ticket owns any CSP.
- A custom URI scheme cannot host the Worker: Workers must be same-origin with the page, and Tauri serves a custom scheme as `<scheme>://localhost` on Linux and `http://<scheme>.localhost` on Windows and Android ([docs.rs Builder::register_asynchronous_uri_scheme_protocol](https://docs.rs/tauri/2.9.5/tauri/struct.Builder.html#method.register_asynchronous_uri_scheme_protocol)), a different origin.
- **`Frame`** (the sandboxed iframe escape hatch): a custom scheme is a good fit, because it gives the frame its own origin and Rust serves only hashed files. Decide in the sandbox ticket.
- Do not use Tauri's asset protocol: it needs its own `assetProtocol.scope` grant.

### 1.6 Built-in Plugin copies

Copying Built-ins into the Plugin Directory and the "untouched copy is replaced, edited copy is kept" rule (decision 6) run in Rust at launch, before the webview loads any plugin. Rust compares each copy's hash with the hash shipped in the bundle. Nothing in this flow needs webview write access.

## 2. Android

### 2.1 Folder options

| Option | Visible to the author | Survives uninstall | Webview access | v1 |
| --- | --- | --- | --- | --- |
| App-private internal (`getFilesDir()`, Tauri `$APPDATA`) | No | No | In global scope (section 1.1), so forbid at setup | **Yes (default)** |
| App-specific external (`getExternalFilesDir()`) | Through USB on many devices (unverified); hidden from other apps on Android 10+ | No | Needs Tauri's external-storage permissions in the manifest | No: little gain |
| SAF tree (`ACTION_OPEN_DOCUMENT_TREE`) | Yes | Yes | Content URIs, persistable grant | No: needs a third-party plugin |

Sources: app-specific files "are removed" on uninstall, and with scoped storage "apps cannot access the app-specific directories that belong to other apps" ([Android, app-specific storage](https://developer.android.com/training/data-storage/app-specific)). SAF: "Your app gains access only to the files in the directory that the user selects"; grants last until restart unless `takePersistableUriPermission()` is called, and are lost when the document moves; on Android 11+ the picker refuses the storage root, SD card root, and `Download`; iterating many files "might" be slow ([Android, documents and files](https://developer.android.com/training/data-storage/shared/documents-files)).

Tauri's dialog plugin lists Android as "Does not support folder picker" and returns content URIs on Android ([Tauri docs, Dialog](https://v2.tauri.app/plugin/dialog/)). The community `tauri-plugin-android-fs` has a directory picker and persisted grants, but it is at version 29.0.0 (crates.io, 2026-07-22), 39 stars, one maintainer; 29 major versions means 29 breaking API changes to track. Reject for v1.

### 2.2 How an author gets a plugin onto the device

"Add Plugin" calls a Rust command that opens the native file picker (dialog plugin, which works for files on Android), reads the returned content URI in Rust (`tauri-plugin-fs` reads content URIs; "The filesystem plugin works with any path format out of the box", [Dialog docs](https://v2.tauri.app/plugin/dialog/)), validates and unpacks the `.zip` into `$APPDATA/plugins/<id>`. The bytes never pass through the webview, so a script cannot install a plugin without the author picking a file. The plugin then stays off until approved (decision 7).

Plugin development happens on desktop or web. A debug build allows `adb shell run-as com.massick.maibuk` to copy files into the app-private folder; that is a developer path, not an author feature (standard Android behavior, not verified on Maibuk's build).

### 2.3 Android Auto Backup

`src-tauri/gen/android/app/src/main/AndroidManifest.xml` does not set `android:allowBackup`, and the default is `true`; Auto Backup includes shared preferences and `getFilesDir()` by default, up to 25 MB per app ([Android, Auto Backup](https://developer.android.com/identity/data/autobackup)). Consequences:

- `$APPDATA/plugins` will be in Google's backup. Harmless, but a large plugin set counts against 25 MB.
- `android-native-keyring-store` keeps ciphertext in SharedPreferences. If Keystore keys are not restored on a new device (believed, not confirmed by the Auto Backup page; settle with a backup and restore on two devices or the Keystore docs), restored entries cannot be decrypted. Treat a decryption failure as "no secret saved" and ask again; never crash. Optionally exclude the keyring preferences file with `dataExtractionRules`.
- The Library itself is also in Auto Backup today. Out of scope here; worth its own issue.

## 3. Web

### 3.1 Storage options

| Option | Support (MDN BCD 8.1.4) | Visible to the author | Notes |
| --- | --- | --- | --- |
| OPFS `navigator.storage.getDirectory()` | Chrome 86, Chrome Android 109, Firefox 111, Safari 15.2 | No | "private to the origin of the page and not visible to the user"; subject to quota; "Clearing storage data for the site deletes the OPFS" ([MDN, OPFS](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system)) |
| File System Access `showDirectoryPicker()` | Chrome/Edge 86, Chrome Android 132; Firefox and Safari: no | Yes | Experimental, secure context, needs user activation ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker)) |
| IndexedDB blobs | Everywhere | No | Same visibility as OPFS without directory semantics. The Jan 2026 prototype planned this (`docs/plugin-plan.md` on `origin/feat/plugin-support`). |

OPFS wins over IndexedDB because it has the same tree shape as a real Plugin Directory, so one loader walks both a `FileSystemDirectoryHandle` from OPFS and one from `showDirectoryPicker()`. Call `navigator.storage.persist()` (supported everywhere) so the browser does not evict it.

### 3.2 What "configured in Settings" means on the web

- Default: "Stored in this browser" (OPFS). Built-in copies go there.
- Chromium only: "Use a folder on this device", `showDirectoryPicker()` with `mode: "read"` (Maibuk never writes a third-party plugin). Store the handle in IndexedDB. On a later visit `requestPermission()` needs a user gesture unless the author chose "Allow on every visit"; that option shipped in Chrome 122 and installed PWAs keep the permission without the prompt ([Chrome, persistent permissions](https://developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api)). Without permission the row says the folder needs reconnecting and offers a button; plugins from it stay off meanwhile.
- The browser's own permission prompt plays the role ADR 0010's native UI plays on desktop: a script cannot grant itself a folder.

### 3.3 Install fallback

Firefox and Safari (and Chromium authors who keep OPFS): "Add Plugin" from a `.zip` file input, a folder input (`webkitdirectory`: Chrome 7, Firefox 50, Safari 11.1, Safari iOS 18.4, Chrome Android 132), or drag and drop. Drop is pointer-only, so the file inputs are the keyboard path, as `pickTextFiles()` is for Chapter import (AGENTS.md section 2, item 1).

### 3.4 Change detection

`FileSystemObserver` is in Chrome and Edge 133+ desktop only (BCD: not in Chrome Android, Firefox, Safari; not on the standards track). It ran as an origin trial from Chrome 129 ([Chrome blog](https://developer.chrome.com/blog/file-system-observer)). Use it when present for development plugins in a picked folder; otherwise re-hash development plugins on `focus`/`visibilitychange` and offer a "Reload plugins" Command. OPFS content changes only through Maibuk, so it needs no watching.

### 3.5 Files into the sandbox

Read files on the main thread, hash with `crypto.subtle.digest("SHA-256", ...)`, create the Worker from a Blob URL. On the web a script already running in the page can write OPFS and recompute hashes; the pinned hash protects against changes made outside the page (a folder edited on disk), not against a compromised page. That matches the web build's overall trust model, where such a script can already read the Library.

## 4. Secrets

### 4.1 Native options

| Option | Platforms | Maintenance (checked 2026-10-02) | Verdict |
| --- | --- | --- | --- |
| `tauri-plugin-stronghold` | All | Crate 2.4.0 (2026-09-30), but a Tauri maintainer: "stronghold is no longer recommended and will be deprecated and therefore removed in v3" ([tauri-apps discussion #7846](https://github.com/orgs/tauri-apps/discussions/7846), FabianLars, 2023-09-18). Engine `iota_stronghold` last release 2.1.0 (2024-05-13); `iotaledger/stronghold.rs` last commit 2023-06-29. Also needs its own password, so it is not the OS keychain decision 9 asks for. | Reject |
| `keyring` crate | Win, macOS, Linux | 4.2.0 (2026-08-29), 12.7M recent downloads; `open-source-cooperative/keyring-rs` pushed 2026-09-15. README: the API moved to `keyring-core` and stores into separate crates; apps should depend on those directly ([README](https://github.com/open-source-cooperative/keyring-rs)) | Use its parts |
| `keyring-core` 1.0.0 + store crates | See below | Same org, all 1.x | **Recommended** |
| `tauri-plugin-keyring` (HuakunShen) | Desktop | Repo last pushed 2025-01-04, 20 stars | Reject |
| `tauri-plugin-keyring-store` (s00d) | Desktop | 0.2.0, created 2026-05-13, 7k recent downloads | Reject: young, adds a JS surface we do not want |
| `tauri-plugin-keystore` (impierce) | Android, iOS | 4 stars | Reject |

Store crates for `keyring-core` (crates.io, 2026-10-02):

| Platform | Crate | Version | Recent downloads | Backend |
| --- | --- | --- | --- | --- |
| Windows | `windows-native-keyring-store` | 1.1.0 (2026-05-24) | 1.8M | Credential Manager |
| Linux | `zbus-secret-service-keyring-store` | 1.0.1 (2026-08-15) | 1.8M | Secret Service over zbus (pure Rust; tokio feature fits sqlx's runtime) |
| Linux | `dbus-secret-service-keyring-store` | 1.0.1 (2026-08-15) | 456k | Secret Service over libdbus |
| Linux | `linux-keyutils-keyring-store` | 1.0.0 (2026-04-21) | 388k | Kernel keyutils |
| Android | `android-native-keyring-store` | 1.0.0 (2026-04-21) | 134k | "SharedPreferences store, securing all passwords and secrets using encryption via credentials in Android's native Keystore"; needs `ndk-context` initialized, which the README says Tauri Mobile already does ([README](https://github.com/open-source-cooperative/android-native-keyring-store)). Maibuk already depends on `ndk-context` 0.1.1. Repo pushed 2026-10-02, 15 stars. |

Platform limits and caveats:

- Windows: a generic credential's blob "cannot be larger than CRED_MAX_CREDENTIAL_BLOB_SIZE (5*512) bytes" ([CREDENTIALW](https://learn.microsoft.com/en-us/windows/win32/api/wincred/ns-wincred-credentialw)). API keys fit; refuse larger secrets with a clear error.
- Linux: the Secret Service needs a provider (GNOME Keyring, KWallet). On a desktop without one, writes fail. Fall back to session-only and say so in the row. Behavior on such a session is unverified; settle it by running the `keyring-cli` example from `keyring-rs` in a session with no provider.
- Android: Auto Backup interaction, section 2.3.

Shape: one Rust module (`src-tauri/src/secrets.rs`) with `set/get/delete(plugin_id, name)`, service name `com.massick.maibuk`, account `plugin:<id>:<name>`. Removing a plugin deletes its entries. Whether a secret ever reaches plugin code, or the host injects it into a network request the plugin asked for, is a decision for the permissions/network ticket; keeping it in Rust is possible with this design and is the stronger option.

### 4.2 Web options, honestly

| Option | Survives reload | Protects against a script in the page | Protects a copied browser profile | Friction |
| --- | --- | --- | --- | --- |
| Memory only (session) | No | Partly: gone after close | Yes | Re-enter each visit |
| IndexedDB plain ("Remember in this browser") | Yes | No | No | None |
| IndexedDB, encrypted with a non-extractable WebCrypto key also in IndexedDB | Yes | No: a script can't export the key ([MDN, CryptoKey.extractable](https://developer.mozilla.org/en-US/docs/Web/API/CryptoKey/extractable)) but can call `decrypt` with it | Little: the key sits in the same profile | None |
| Encrypted with a passphrase-derived key | Yes | No once unlocked | Yes | Passphrase each visit |
| `PasswordCredential` | Yes | No | Depends on the password manager | Chromium only (BCD: Chrome 51, no Firefox or Safari) |

Recommendation: session memory by default, opt-in plain IndexedDB with the honest label. Keep secrets out of `localStorage` so they never ride along with persisted Zustand state.

### 4.3 Existing precedent to know about

`src/features/sync/store.ts:401-409` persists the sync `passphrase` and `authToken` in localStorage through `partialize`, on every platform. That is the opposite of decision 9 for a Maibuk secret. Not in scope here; once a secrets module exists, moving them is a natural follow-up issue.

## 5. ADR 0010 implications

1. **Reused unchanged**: a folder outside Maibuk's own reaches native code only through the Rust-side picker or a Rust-worded confirmation, with the approval in the `<config>.trusted` sibling, and no `tauri-plugin-persisted-scope`. Add `plugin-directory.json` next to `backup-directory.json`.
2. **New and stricter**: the approved Plugin Directory is never added to the webview fs scope. Rust forbids it recursively at setup (default and custom) and is its only reader. This needs a new ADR (or a section in the platform ADR) because it reverses the Backup Directory's "grant on approval" step for a reason a reader would not guess: plugin files are code.
3. **Correction to record**: the fs global scope includes all five app-specific folders, not only the config folder (section 1.1). ADR 0010's reasoning holds, but its first paragraph understates the writable area. Settle with the Rust test in section 1.1 before editing the ADR.
4. **Windows casing**: forbid rules do not stop creating new, differently cased paths under an allowed prefix (section 1.2). Any protected folder must live outside every allowed pattern, which is why the desktop default is not in `$APPDATA`.
5. **Android**: the Backup Directory commands return an error on mobile; the Plugin Directory follows suit (no custom folder on Android in v1). Installing from a `.zip` uses a Rust-side picker, so the webview cannot supply plugin bytes.
6. **Web**: no fs scope exists; the browser's permission prompt for `showDirectoryPicker()` is the native-UI equivalent.

## Verification log

| Claim | Status | How to settle |
| --- | --- | --- |
| Webview can write `$APPDATA/**` etc. with Maibuk's capabilities | Read from source (ACL resolver + fs permissions), not run | Rust scope test, section 1.1 |
| Windows `$APPCONFIG == $APPDATA` | From `dirs` mapping, not run | Print both on Windows |
| Case bypass of forbid for new files on Windows | Read from `scope/fs.rs`, not run | `is_allowed` test on Windows with a differently cased new path |
| OneDrive-redirected Documents breaks reads | Unverified | Test with Files On-Demand |
| Keystore keys not restored by Auto Backup | Unverified | Backup and restore across two devices |
| Linux without Secret Service provider fails cleanly | Unverified | `keyring-cli` in a bare session |
| Tauri Mobile initializes `ndk-context` for `android-native-keyring-store` | Stated by that crate's README | Run the store on Maibuk's Android build |
| `getExternalFilesDir()` visible over USB | Unverified | Connect a device |
| Browser support numbers | MDN BCD 8.1.4, script-checked | n/a |
