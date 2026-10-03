# Plugin packaging and integrity (issue #390)

Research date: 2026-10-02. Map: [#389](https://github.com/M4ss1ck/maibuk/issues/389). Feeds [#400](https://github.com/M4ss1ck/maibuk/issues/400) (manifest schema and API versioning).

The standing decisions in #389 are inputs, not questions: Plugins run sandboxed in a Worker on every platform, contributions are declared in the manifest, the Plugin Directory is a folder, Maibuk pins a content hash at approval, a changed Plugin stays off until reviewed again, and a Plugin "in development" skips the pin.

## Recommendation

1. **The Plugin is a folder; a `.zip` is only a way to carry one.** The unit Maibuk installs, hashes, diffs and loads is a directory in the Plugin Directory with `manifest.json` at its root, a JS entry file, and any assets. Install from a `.zip` (one file is what a browser file picker, Android's document picker and an email attachment handle well) extracts into that folder first. Obsidian, Logseq, SiYuan and Joplin all end up with a folder on disk; Chrome and VS Code ship a zip but verify the extracted files.
2. **The pinned hash is a canonical directory hash over every file, not a hash of the archive.** Use Go's `h1:` scheme (`golang.org/x/mod/sumdb/dirhash.Hash1`): SHA-256 of each file, one line `<hex>  <path>\n` per file, lines sorted by path, SHA-256 of that summary. Keep the per-file list too: it is what the re-review diff shows. Re-zipping, a different zip tool, or file timestamps never change the hash; one changed byte in any file does.
3. **v1 has no signing and no registry, and needs neither to be safe for its threat model.** The pin answers "did these files change since I approved them?", which is the v1 question. A later registry adds a signed statement *about* the `h1:` hash (Chrome `verified_contents.json`, Go checksum database, Open VSX / Marketplace detached signatures all work this way), stored next to the content and outside the hashed set, so every v1 Plugin stays valid and simply shows as "not from the registry".
4. **JS bundles only in v1. Wasm is allowed inside a JS Plugin, not as its own entry kind.** A Plugin that wants Rust or Go ships a `.wasm` file and loads it from its JS entry; the file is hashed like any other. A first-class Wasm entry (WIT interface, Extism or the component model) waits until a Plugin needs it, because it cannot render the host React tree (decision 3) without a JS shim and browsers do not run components natively.
5. **No native-binary Plugins (go-plugin style), ever, as a packaging form.** They cannot run on the web, Android forbids `exec` of downloaded files, and they bypass the sandbox. Process access stays a `process` permission the host brokers (the Terminal case), on desktop only.

## Survey

### Comparison table

| System | Package format | Code form | Signing | Hash / integrity | Versioning fields | Host compatibility check | Sandbox model |
| --- | --- | --- | --- | --- | --- | --- | --- |
| VS Code | `.vsix`: a zip written by `vsce` with yazl, including `[Content_Types].xml` ([vsce `src/package.ts`](https://github.com/microsoft/vscode-vsce/blob/main/src/package.ts)) | JS (Node extension host; `browser` entry for web) | Marketplace signs every extension on publish with a detached CMS signature over the whole unsigned package; VS Code verifies on install ([discussion #229](https://github.com/microsoft/vscode-discussions/discussions/229), [runtime security](https://code.visualstudio.com/docs/configure/extensions/extension-runtime-security)) | Through the signature; unsigned packages skip verification and get a publisher trust dialog (1.97+) | `version` (semver, no pre-release tags), `--pre-release` flag, platform `--target` ([publishing](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)) | `engines.vscode` range, cannot be `*` ([manifest](https://code.visualstudio.com/api/references/extension-manifest)) | None: "The extension host has the same permissions as VS Code itself" ([runtime security](https://code.visualstudio.com/docs/configure/extensions/extension-runtime-security)) |
| Obsidian | Folder: `manifest.json`, `main.js`, optional `styles.css`, downloaded from the GitHub release whose tag equals `version` ([submit](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin)) | JS | None | None in the app (not found in docs); automated scan of every version, manual review for popular ones ([plugin security](https://obsidian.md/help/plugin-security)) | `id`, `version` (x.y.z), `minAppVersion` ([manifest](https://docs.obsidian.md/Reference/Manifest)) | `minAppVersion`; `isDesktopOnly` | None: "plugins will inherit Obsidian's access levels" ([plugin security](https://obsidian.md/help/plugin-security)) |
| Figma | Manifest + `main` JS file + optional `ui` HTML, published to Figma ([manifest](https://developers.figma.com/docs/plugins/manifest/)) | JS | Not documented | Not documented | `api` (Figma API version) | `api`, `editorType` | `main` runs in a minimal JS sandbox with no browser APIs; UI in an iframe; they talk by message passing ([how plugins run](https://developers.figma.com/docs/plugins/how-plugins-run/)). `networkAccess.allowedDomains` blocks other domains |
| Raycast | Source in the `raycast/extensions` monorepo; a PR is reviewed, merged, then "automatically published" ([publish](https://developers.raycast.com/basics/publish-an-extension)) | JS/TS (React, Node) | Not documented; the store builds from reviewed source | Source review + CI | `package.json` `version` | Not documented | Each extension in its own V8 isolate (worker thread) in one Node child process, RPC to the host; no extra file or network sandbox ([security](https://developers.raycast.com/information/security)) |
| Zed | Git repo added as a submodule of `zed-industries/extensions`; Zed CI packages and publishes it after merge ([publishing guide](https://zed.dev/docs/extensions/publishing/publishing-guide)) | Wasm component (`wasm32-wasip2`, Rust, `zed_extension_api`) ([developing](https://zed.dev/docs/extensions/developing-extensions)) | Not documented | Registry build from reviewed source | `extension.toml`: `id`, `version`, `schema_version`; `extensions.toml` version must match | `zed_extension_api` version table per Zed release ([extension_api README](https://github.com/zed-industries/zed/blob/main/crates/extension_api/README.md)) | Wasm in Wasmtime; manifest `capabilities` such as `process:exec` with allowed command and args, checked by the host ([`extension_manifest.rs`](https://github.com/zed-industries/zed/blob/main/crates/extension/src/extension_manifest.rs)) |
| Chrome (CRX3) | `Cr24` magic, version 3, protobuf header, then a zip ([`crx3.proto`](https://chromium.googlesource.com/chromium/src/+/main/components/crx_file/crx3.proto)) | JS + Wasm; MV3 bans remotely hosted code, JS and Wasm alike ([remote hosted code](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code)) | RSA-PSS or ECDSA P-256 proofs over `"CRX3 SignedData\x00"` + header + archive | Web Store adds `verified_contents.json`: signed per-file tree-hash roots (SHA-256 blocks) by canonical relative path; checked when files are read ([`verified_contents.h`](https://chromium.googlesource.com/chromium/src/+/main/extensions/browser/verified_contents.h), [`content_hash.h`](https://chromium.googlesource.com/chromium/src/+/main/extensions/browser/content_verifier/content_hash.h)) | `version`; Omaha update manifest ([self-hosting](https://developer.chrome.com/docs/extensions/how-to/distribute/host-on-linux)) | `minimum_chrome_version` (not checked here, unverified) | Extension origin, permissions, CSP. Id = first 128 bits of SHA-256 of the public key in letters a-p ([`id_util.cc`](https://chromium.googlesource.com/chromium/src/+/main/components/crx_file/id_util.cc)) |
| Extism | Wasm module(s) referenced by a manifest (`path`, `url`, or `data`) | Wasm, any language with a PDK | None | Optional per-module `hash` (SHA-256 hex): "if the data loaded from disk or via HTTP doesn't match an error will be raised" ([manifest](https://extism.org/docs/concepts/manifest), [`manifest/src/lib.rs`](https://github.com/extism/extism/blob/main/manifest/src/lib.rs)) | None in the manifest | Host-defined | `allowed_hosts`, `allowed_paths`, `memory.max_pages`, `timeout_ms`; the JS SDK runs in browsers using the engine's own Wasm ([js-sdk](https://github.com/extism/js-sdk)) |
| HashiCorp go-plugin | A native executable | Native binary (any language with gRPC) | None built in | `SecureConfig` checksum of the binary before launch ([README](https://github.com/hashicorp/go-plugin)) | Protocol version handshake | Handshake | OS process, RPC over a local connection; a plugin crash does not crash the host; no capability limits |
| Logseq | Zip attached to a GitHub release; listed by `packages/<id>/manifest.json` in `logseq/marketplace` ([README](https://github.com/logseq/marketplace)) | JS | None documented | None documented | `package.json` | Not documented | Per-plugin iframe (Postmate) or a shadow-DOM mode ([`LSPlugin.caller.ts`](https://github.com/logseq/logseq/blob/master/libs/src/LSPlugin.caller.ts)); how strong the iframe isolation is was not verified |
| SiYuan | `package.zip` in the repo's latest GitHub release; listed in `siyuan-note/bazaar` ([README](https://github.com/siyuan-note/bazaar)) | JS | None documented | PR check workflow on listing | `plugin.json`: `version`, `minAppVersion` | `minAppVersion`, `backends`, `frontends` | Not documented (unverified) |
| Joplin | `.jpl` = a tar of the built `dist/` folder, published to npm as `joplin-plugin-*` ([generator `webpack.config.js`](https://github.com/laurent22/joplin/blob/dev/packages/generator-joplin/generators/app/templates/webpack.config.js)) | JS | None | Build writes `_publish_hash: sha256:<jpl>`; no use of it found in the app's `RepositoryApi.ts`, so it looks informational (unverified) | `manifest_version`, `version`, `app_min_version`, `app_min_version_mobile` ([manifest](https://joplinapp.org/help/api/references/plugin_manifest)) | `app_min_version(_mobile)`, `platforms` | Separate process on desktop (hidden BrowserWindow), IPC through a sandbox proxy; `vm` in the CLI ([spec](https://joplinapp.org/help/dev/spec/plugins)) |
| Tauri plugins | Cargo crate + optional npm bindings, compiled into the app ([plugins](https://v2.tauri.app/develop/plugins/)) | Rust (+ Kotlin/Swift) | Not applicable | Not applicable | Cargo/npm versions | Build time | Not runtime-loadable; not a model for Maibuk Plugins. The Tauri updater, by contrast, signs artifacts with minisign (`minisign-verify` in [`plugins/updater/Cargo.toml`](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/updater/Cargo.toml)); verification "cannot be disabled" ([updater](https://v2.tauri.app/plugin/updater/)) |

Repository activity, from `gh api repos/<repo>` on 2026-10-02 (stars, last push): microsoft/vscode 193,367 (2026-10-03); tauri-apps/tauri 111,557 (2026-10-01); zed-industries/zed 91,210 (2026-10-03); laurent22/joplin 56,564 (2026-10-03); siyuan-note/siyuan 46,611 (2026-10-02); logseq/logseq 45,116 (2026-10-02); obsidianmd/obsidian-releases 21,966 (2026-10-03); raycast/extensions 7,772 (2026-10-02); hashicorp/go-plugin 6,097 (2026-09-28); extism/extism 5,784 (2026-09-02); eclipse-openvsx/openvsx 2,048 (2026-10-02); zed-industries/extensions 1,913 (2026-10-02); WebAssembly/component-model 1,378 (2026-10-02); bytecodealliance/jco 1,006 (2026-10-02). None is archived.

### What the survey shows

- **Sandboxing and integrity are separate axes.** The two systems with real signing (VS Code, Chrome) differ completely on sandboxing: VS Code has none, Chrome has a strong one. The notes apps (Obsidian, Logseq, SiYuan) have neither signing nor a strong sandbox and rely on listing review. Maibuk's choice of a Worker sandbox with permissions (decision 2) is closer to Figma and Chrome, and is what makes "no signing in v1" acceptable: a modified Plugin can only do what its granted permissions allow, and decision 7 already stops it until the author reviews it again.
- **Integrity only means something if all code is in the package.** Chrome MV3 bans remotely hosted JS and Wasm for this reason. A pinned hash is worthless if the Plugin can `import()` code from the network after approval. The sandbox ticket (#392) must make the Worker unable to load code from anywhere but the Plugin's own hashed files (`network:<hosts>` is for data, not code).
- **Hashing the archive versus hashing the files.** Joplin, go-plugin and Extism hash one blob. That is simple but tied to the transport: the same files zipped twice give two hashes, and nothing tells the author *which* file changed. Chrome (`verified_contents.json`) and Go modules (`h1:`) hash each file under a canonical relative path and combine the results. Maibuk needs the second kind: the Plugin Directory is a folder an author can edit (decision 6), and re-review shows a diff.
- **Compatibility is always a host-version floor plus, in the mature systems, an API version.** Obsidian and SiYuan use `minAppVersion`; Joplin adds a mobile floor; VS Code uses an `engines` range; Zed and Figma version the API separately from the app. Platform targeting exists everywhere in some form (`isDesktopOnly`, `platforms`, `backends`/`frontends`, `--target`). The exact field list belongs to #400.

## What the pinned hash covers

### Algorithm

Maibuk's Plugin hash is Go's `h1:` directory hash ([`dirhash.Hash1`](https://github.com/golang/mod/blob/master/sumdb/dirhash/hash.go)), which is documented as equivalent to

```sh
sha256sum $(find . -type f | sort) | sha256sum
```

Exactly: for each file, a line of the lowercase hex SHA-256 of its bytes, two spaces, its path, and `\n`; lines sorted by path (byte order of the UTF-8 path); SHA-256 of the concatenation; the result written as `h1:` + base64. Reasons to reuse it rather than invent one: it is specified in a few lines, has been run against every Go module since 2019 by the Go checksum database, and the per-file lines double as the file list the re-review screen needs.

### Canonical paths and the file set

The hash is only stable if every platform builds the same list. Rules, enforced at install and when computing the hash:

1. **Every regular file under the Plugin's folder is in the set**, at any depth, including `manifest.json`. No author-controlled ignore file. The host must also refuse to serve a file that is not in the set, so nothing outside the hash can run.
2. **A short fixed ignore list for OS litter only** (`.DS_Store`, `Thumbs.db`, `desktop.ini`): otherwise opening a Built-in Plugin's folder in a file manager would mark it modified (decision 6). The host never loads these names.
3. **Paths are relative, `/`-separated, Unicode NFC**, no `.` or `..` segments, no leading `/`, no `\n`. macOS and some Android file systems return decomposed names; normalizing to NFC keeps the hash equal across devices. Chrome canonicalizes relative paths for the same reason (`CanonicalRelativePath` in `verified_contents.h`).
4. **Reject, do not hash, what cannot be made portable**: symlinks, other non-regular files, and two paths that differ only by case (Windows and the Android shared-storage file systems are case-insensitive, so such a folder cannot exist identically everywhere).
5. **Empty directories and file metadata (mtime, mode) are not in the hash.** Only bytes and paths reach the Plugin.

Where it runs: in Rust on desktop and Android (file access is there), with Web Crypto `crypto.subtle.digest("SHA-256")` on the web. One shared fixture of folders and expected hashes, tested from both sides, keeps them identical (the repo already does this for CRC32C and the resampler). Whether `crypto.subtle` is available inside the Android WebView's origin was not verified; doing the Android hash in Rust avoids the question.

What is stored at approval: the `h1:` value plus the per-file list (`path -> sha256`). On a mismatch the host recomputes the list and shows added, removed and changed files next to the permission diff from decision 7.

Built-in Plugins: the build computes each Built-in's `h1:` with the same function and ships it in the app. On update, "untouched" (decision 6) means the folder's current hash equals the hash shipped with the *previous* Release.

### Install from a `.zip`

Extraction is the only point where archive details matter, and they never reach the hash. The extractor must refuse entries with absolute paths or `..` (zip slip), symlink entries, duplicate names after NFC and case folding, and must cap total uncompressed size and entry count (zip bombs). Then it writes the folder and hashes the result. The archive's own bytes, timestamps and compression are discarded.

## What a registry and signing add later without breaking v1

A future registry publishes, for each `(id, version)`, a statement containing the `h1:` hash, signed by the registry key. This is the shape of Go's checksum database and of Chrome's `verified_contents.json` (a signed list of content hashes, kept apart from the content), and of the Marketplace's detached signature.

- **Where the signature lives**: outside the hashed set (for example `<Plugin Directory>/.signatures/<id>@<version>.json` or inside the app's own storage), so adding one never changes a Plugin's hash and never invalidates an approval.
- **What it is checked against**: the same `h1:` value the pin uses. A signed Plugin whose hash matches gets a "from the registry" badge; an unsigned one is exactly what v1 has today ("installed from a file"), the way VS Code still installs unsigned `.vsix` files behind a trust dialog.
- **Algorithm**: Ed25519, for example minisign, the format the Tauri updater verifies with `minisign-verify` (Maibuk does not use the updater today, so this would be a new dependency either way); Sigstore is the heavier alternative if publisher identity, not just registry identity, is wanted.
- **What v1 must reserve so this needs no migration**: a stable `id` and semver `version` in the manifest (already fixed by #389), the hash string carrying its scheme prefix (`h1:`) so a future scheme can coexist, and the rule that nothing outside the folder's hashed files is code.

## Wasm next to JS bundles

**Not as a v1 entry kind. Allowed inside a JS Plugin from day one.**

For a separate Wasm entry:
- Any-language Plugins (Rust, Go, C) without a JS toolchain. Zed and Extism show the model works and gives capability control by construction.
- Wasm has no ambient authority: everything is an import the host chooses, which suits the permission model.

Against it in v1:
- **UI.** Decision 3 has the Plugin render React and ship the tree to the host. A Wasm module has no React and no DOM; it would need a second UI protocol or a JS shim, which is a JS Plugin with extra steps.
- **The component model is not native in browsers.** Jco exists to "transpile" components into ES modules for browsers ([jco](https://github.com/bytecodealliance/jco)). Running WIT components in WebKitGTK, WebView2, Android WebView and three browsers means shipping that toolchain's output and tracking a moving spec. Extism's JS SDK avoids the component model but brings its own PDK and ABI to support forever.
- **No pilot needs it.** Echoes is text analysis that JS does well; AI Chat is network and UI; Terminal is a `Frame` plus host-brokered `process`.
- **The JS path already covers the use case.** A JS Plugin's Worker can instantiate a `.wasm` file from its own folder (wasm-bindgen, Emscripten, TinyGo output). Maibuk's web build already runs Moonshine's WASM runtime for Dictation, so the engines are proven in its webviews. The Wasm file is hashed like any other file, and the "no remote code" rule covers it. If Maibuk later sets a CSP, the Worker needs `'wasm-unsafe-eval'` for this (Maibuk's `tauri.conf.json` has `"csp": null` today).

Adding a `wasm` entry kind later is additive: a new manifest value next to the JS entry, behind an API version bump. v1 Plugins do not change.

## Native-binary Plugins (go-plugin style)

They do not fit, for reasons that do not go away with effort:
- **Web**: a browser cannot start a process.
- **Android**: apps targeting Android 10+ "cannot invoke `execve()` directly on files within the app's home directory" ([Android 10 behavior changes](https://developer.android.com/about/versions/10/behavior-changes-10)), and Google Play forbids downloading executable code (dex, JAR, `.so`) except "code that runs in a virtual machine or an interpreter ... (such as JavaScript in a webview or browser)" ([Device and Network Abuse policy](https://support.google.com/googleplay/android-developer/answer/9888379)). A JS Plugin is inside that exception; a binary is not.
- **Desktop**: a native process has the author's full OS rights. go-plugin offers a checksum and TLS, not a sandbox, so it would void decision 2.

The Terminal need is met the other way round: Maibuk itself (Rust) owns the PTY, and a Plugin with the `process` permission asks for it through the message API, on desktop only (`platforms`).

## Not verified

- Chrome's handling of `minimum_chrome_version` at install was not checked against source.
- Whether Logseq's iframe sandbox is cross-origin (real isolation) or same-origin was not checked.
- SiYuan's plugin runtime isolation was not found in its docs.
- Whether Joplin's app ever reads `_publish_hash`: a code search of the repo found it only in build scripts, tests, types and the plugin-repo CLI, not in `RepositoryApi.ts`. A search of the whole app package would settle it.
- Whether `crypto.subtle` is exposed in Tauri's Android WebView origin. Settled by running `crypto.subtle.digest` in the Android build, or avoided by hashing in Rust.
- Figma and Zed do not document signing of published plugins; absence in docs is not proof of absence.
