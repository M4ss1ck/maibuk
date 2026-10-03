# Plugin sandbox runtime on every Maibuk platform

Research for issue #392 (map #389). Research date: 2026-10-02. Primary sources only: WHATWG HTML, W3C CSP3, Android and WebView2 reference docs, MDN browser-compat-data, Web Platform Tests results, and the Tauri/wry source at the versions Maibuk ships. Maibuk paths are relative to the repo root at `bed1e51d`.

Pinned refs:

| Source | Ref |
| --- | --- |
| tauri | `2.9.5` (`src-tauri/Cargo.lock`), read from `~/.cargo/registry/src/*/tauri-2.9.5` |
| wry | `0.53.5` (`src-tauri/Cargo.lock`); `0.55.1` checked for the same code paths |
| WHATWG HTML | living standard, fetched 2026-10-02 |
| CSP3 | editor's draft https://w3c.github.io/webappsec-csp/, fetched 2026-10-02 |
| MDN browser-compat-data | `8.1.4` (2026-10-01) |
| Chromium `components/origin_matcher` | `main` on chromium.googlesource.com, fetched 2026-10-02 |
| WPT results | wpt.fyi `master` runs of 2026-10-02 (Chrome 157, Edge 156, Firefox 159; the Safari Preview run reported no results for these tests) |

Standing decisions from #389 are taken as given: Worker for Plugin logic, a message API gated by manifest permissions, `Frame` surfaces as sandboxed iframes, the same path for Built-in and third-party Plugins, every platform.

---

## Summary and recommendation

**Run each Plugin's logic in a dedicated Worker created inside a hidden, host-owned "sandbox frame": an `<iframe sandbox="allow-scripts">` (never `allow-same-origin`) whose `srcdoc` carries a strict CSP `<meta>` and a small bootstrap that Maibuk writes.** The bootstrap turns the Plugin bytes (sent by the host after the pinned-hash check) into a `blob:` URL and starts the Worker from it. Plugin code never runs in a document, so it never sees `window`, the DOM, or anything a webview injects into frames. All Library, editor, network, secrets, clipboard, and process access goes through one `MessagePort` to a host broker that checks grants on every call. Network is brokered too: the sandbox CSP is `connect-src 'none'` on every platform, and `network:<hosts>` grants are enforced by the broker, which can also attach BYOK secrets so the key never enters the sandbox.

What makes this the answer, per platform:

1. **The opaque origin is required on the web build, not optional.** The web Library and Backups live in the app origin's IndexedDB (`src/lib/platform/web/database.ts`, `src/lib/platform/web/backup.ts`). A Worker started from the app's own origin could open that IndexedDB directly and read or rewrite the whole Library. A Worker started from inside a sandboxed frame inherits the frame's opaque origin and cannot.
2. **CSP is the platform-level network block.** By the HTML standard, a `blob:` Worker takes the policy container (and so the CSP) of the document that created the blob URL ([HTML, "create a policy container from a fetch response"](https://html.spec.whatwg.org/multipage/browsers.html#creating-a-policy-container-from-a-fetch-response)). `connect-src` covers `fetch`, XHR, `EventSource`, `sendBeacon`, and WebSocket ([CSP3 §6.1.2](https://w3c.github.io/webappsec-csp/#directive-connect-src)). Chromium and Firefox pass the WPT test for exactly this case; WebKit is unverified (test T1).
3. **Tauri IPC is not reachable from the Worker**, on any platform: Tauri only accepts an IPC call that carries the per-launch `__TAURI_INVOKE_KEY__`, which lives in a closure inside an init script that webviews inject into documents, never into Workers.
4. **Tauri IPC *is* reachable from a sandboxed iframe on Android**, which is why Plugin code must not run in a document there. On Android, wry injects Tauri's init scripts (including the invoke key) into every frame, and every IPC message is attributed to the main frame's URL, so a sandboxed frame would get the main window's full capability set (`sql:allow-execute`, `fs:allow-write`, `process:allow-exit`...). On Windows the scripts also reach iframes, but the call is refused because a sandboxed frame sends `Origin: null`. On Linux the scripts stay in the top frame. Details in section 2. This blocks `Frame` surfaces on Android until a fix lands (section 6, options F1 to F3), and it constrains the sandbox frame's bootstrap: it must never hand the Worker a reference to anything in its window.
5. **Budgets:** CPU and startup are enforceable everywhere with `Worker.terminate()` plus a host-side watchdog; message rate and payload size are enforced by the broker (deterministic code). There is no portable per-Worker memory cap: `performance.measureUserAgentSpecificMemory()` exists only in Chromium engines and only when cross-origin isolated. The web build already is (`public/_headers` sets COOP/COEP); the Tauri builds are not. Memory is therefore best-effort in v1, with crash detection as the hard backstop.
6. **SES, ShadowRealm, QuickJS-in-Wasm:** none needed for v1. ShadowRealm is TC39 Stage 2.7 and ships nowhere. SES (`ses` 2.3.0) is a mature extra layer (MetaMask Snaps runs it inside a sandboxed iframe) but enforces by JS hardening, not by the platform. QuickJS-in-Wasm (`quickjs-emscripten` 0.32.0) is the only option with a hard memory limit, at a large speed cost. Keep it as the fallback if a memory budget becomes a hard requirement.

---

## 1. How Maibuk loads today (the attack surface the sandbox sits inside)

- `src-tauri/tauri.conf.json`: `app.security.csp` is `null`, so the Tauri app runs with no CSP. `withGlobalTauri` is unset, so `window.__TAURI__` does not exist, but `window.__TAURI_INTERNALS__` always does (Tauri injects it, see below).
- `src-tauri/capabilities/desktop.json` and `android.json` grant the `main` window `sql:allow-execute`, `fs:allow-write`, `fs:allow-remove`, `process:allow-exit`, `clipboard-manager:allow-read-text`, and more. Anything that can make an IPC call attributed to the main window gets all of that. This is the blast radius of an IPC leak.
- The web build (`public/_headers`) sets `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless` for threaded Dictation. That makes the web app cross-origin isolated in Chromium and Firefox, which matters for memory measurement (section 4) and means sandbox frames must be COEP-compatible (`srcdoc` and `blob:` frames inherit the embedder's policy, so they are; test T9 confirms).
- The web build stores the Library in IndexedDB at the app origin (`src/lib/platform/web/database.ts`), Backups too (`src/lib/platform/web/backup.ts`), and Dictation models in Cache Storage (`src/lib/platform/web/dictation/cache-model-files.ts`). Any code running at the app origin can read and write all of it.

## 2. Tauri IPC reachability from sandboxed iframes and Workers

This is the decisive question, so it is answered from the source Maibuk ships.

### 2.1 What a caller needs to make an IPC call

1. **The invoke key.** Tauri generates a random 128-bit key per launch (`tauri-2.9.5/src/lib.rs:1252`, `generate_invoke_key`). It is templated into `scripts/ipc-protocol.js:12` as a `const` inside an IIFE, deliberately outside any function so `toString()` cannot leak it (comment at lines 6 to 11). Every IPC request must carry it: `Webview::on_message` drops any request whose key does not match (`src/webview/mod.rs:1724-1745`).
2. **A transport.** Two exist. The custom-protocol path `fetch`es `ipc://localhost/<cmd>` (`http://ipc.localhost` on Windows and Android) with a `Tauri-Invoke-Key` header (`scripts/ipc-protocol.js:26-69`). The fallback path calls `window.ipc.postMessage(...)` with the key in the body (`scripts/ipc-protocol.js:70-85`), and Android always uses the fallback (`canUseCustomProtocol = osName !== 'android'`, line 21).
3. **An origin Tauri accepts.** On the custom-protocol path, Tauri parses the request's `Origin` header as a URL and refuses the request if it is missing or does not parse (`src/ipc/protocol.rs:491-499`). A sandboxed frame without `allow-same-origin` has an opaque origin, which serializes as `null` ([HTML, origin serialization](https://html.spec.whatwg.org/multipage/browsers.html#ascii-serialisation-of-an-origin)); `Url::parse("null")` fails, so Tauri answers 500. `Origin` is a forbidden request header, so page script cannot forge it. On the postMessage path, the URL comes from the native layer, not from the frame (per platform below). Tauri then classifies that URL as Local if it is the app's own protocol, `devUrl`/`frontendDist`, **or any custom URI scheme the app registers** (`src/webview/mod.rs:1680-1721`) and resolves capabilities against it.

### 2.2 Who receives the init scripts

Tauri marks every one of its own init scripts, including `__TAURI_INTERNALS__` and the invoke script that holds the key, as main-frame-only (`src/manager/webview.rs:153-212`, `main_frame_script`). Whether that flag is honored is up to wry:

| Platform | Init scripts in subframes? | Source |
| --- | --- | --- |
| Linux (WebKitGTK) | No. `for_main_only` maps to `UserContentInjectedFrames::TopFrame`. `window.ipc` is also defined top-frame only. | `wry-0.53.5/src/webkitgtk/mod.rs:718-725`, `:341` |
| Windows (WebView2) | **Yes.** wry documents "scripts are always added to subframes regardless of the `for_main_frame_only` option", because `AddScriptToExecuteOnDocumentCreated` "will apply to all future top level document and child frame navigations". | `wry-0.53.5/src/lib.rs:982`; [WebView2 docs](https://learn.microsoft.com/en-us/dotnet/api/microsoft.web.webview2.core.corewebview2.addscripttoexecuteondocumentcreatedasync) |
| Android (WebView) | **Yes.** wry ignores the flag and calls `WebViewCompat.addDocumentStartJavaScript(this, script, setOf("*"))`. Android documents that the script runs "in any frame whose origin matches allowedOriginRules", and Chromium's `*` rule matches every origin, including opaque ones (`data:` and `about:blank` in `origin_matcher_unittest.cc`). Same code in wry 0.55.1. | `wry-0.53.5/src/android/kotlin/RustWebView.kt:31`; [WebViewCompat](https://developer.android.com/reference/androidx/webkit/WebViewCompat); [Chromium origin matcher](https://chromium.googlesource.com/chromium/src/+/main/components/origin_matcher/) |
| Web build | No Tauri. Nothing injected. | |

Workers receive none of these on any platform: all three mechanisms inject into documents.

### 2.3 Verdict per context

| Context | Linux | Windows | Android | Why |
| --- | --- | --- | --- | --- |
| **Dedicated Worker** (any origin) | Not reachable | Not reachable | Not reachable | No init script runs in Workers, so no invoke key. A Worker at the *app* origin could reach the `ipc` endpoint with an accepted `Origin`, but without the key the call is dropped. Do not rely on the key alone: the Worker must also be at an opaque origin (web IndexedDB, section 1) and under `connect-src 'none'`. |
| **Sandboxed iframe, no `allow-same-origin`** | Not reachable | Not reachable (verify, T3) | **Reachable, full main-window capabilities** | Linux: no key in the frame. Windows: the frame gets its own `__TAURI_INTERNALS__` with the key; the fetch path sends `Origin: null` and is refused; the postMessage fallback calls `window.chrome.webview.postMessage`, which from a frame raises `CoreWebView2Frame.WebMessageReceived`, not `CoreWebView2.WebMessageReceived` ("runs when ... the top-level document of the WebView runs `window.chrome.webview.postMessage`", [ICoreWebView2](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2)), and wry only subscribes to the latter (`wry-0.53.5/src/webview2/mod.rs:884-904`). Android: the frame gets the key (2.2), Android injects the `ipc` JavaScript interface "into all frames of the web page, including all the iframes" ([WebView.addJavascriptInterface](https://developer.android.com/reference/android/webkit/WebView#addJavascriptInterface(java.lang.Object,%20java.lang.String))), and wry stamps every message with `webViewClient.currentUrl` (`Ipc.kt:18`), which is set in `onPageStarted` (`RustWebViewClient.kt:57`), which Android calls "once for each main frame load" ([WebViewClient](https://developer.android.com/reference/android/webkit/WebViewClient)). The call is therefore classified Local and resolved against the `main` window's capabilities. |
| **Iframe with `allow-same-origin`, or served unsandboxed from a registered custom scheme** | Reachable if the key leaks | Reachable | Reachable | The origin is the app's or a registered scheme's, which `is_local_url` treats as Local. Never do this. |

The Android row is the central finding. It is derived from source and documentation and has not been run; test T2 settles it and must run before any `Frame` ships on Android.

## 3. Network blocking in the Worker

### 3.1 The mechanism

- Worker origin: a `blob:` URL created in an opaque-origin document has that opaque origin, and so does the Worker started from it. A `data:` Worker gets a fresh opaque origin ([HTML, "run a worker"](https://html.spec.whatwg.org/multipage/workers.html#run-a-worker): "Let origin be a unique opaque origin if worker global scope's url's scheme is "data"; otherwise outside settings's origin").
- Worker CSP: for `blob:`, a clone of the blob URL entry's environment's policy container; for other local schemes (`data:`), a clone of the owner document's ([HTML](https://html.spec.whatwg.org/multipage/browsers.html#initialize-worker-policy-container)). A `<meta http-equiv="Content-Security-Policy">` in the `srcdoc` is part of that document's policy container, so the Worker inherits it.
- What `connect-src 'none'` blocks: `fetch`, XHR, `EventSource`, `sendBeacon`, WebSocket ([CSP3 §6.1.2](https://w3c.github.io/webappsec-csp/#directive-connect-src)). `importScripts` and module imports fall under `script-src`; nested Workers under `worker-src`. `RTCPeerConnection` is not exposed in Worker scopes.
- Engine evidence: WPT `content-security-policy/connect-src/worker-from-guid.sub.html` (a blob Worker must inherit `connect-src` from its creator) and `content-security-policy/inheritance/sandboxed-blob-scheme.html` pass in Chrome 157, Edge 156, and Firefox 159 on wpt.fyi. The Safari run returned no result for them, so **WebKit (Safari and WebKitGTK) is unverified** (T1). Browser-compat-data: `connect-src` Chrome 25, Firefox 50, Safari 7, Android WebView 4.4; `worker-src` Chrome 59, Firefox 58, Safari 15.5.

Sandbox frame CSP, one per Plugin start:

```
default-src 'none';
script-src 'nonce-<random>' blob: 'wasm-unsafe-eval';
worker-src blob:;
connect-src 'none';
img-src 'none'; style-src 'none'; font-src 'none'; media-src 'none';
frame-src 'none'; form-action 'none'; base-uri 'none'
```

`script-src blob:` lets the bootstrap start the Worker and also governs `importScripts(blob:...)`; the Plugin can only create blobs from data it already has, so this grants no network. `'wasm-unsafe-eval'` allows Plugins that ship Wasm without allowing network. Whether to allow `'unsafe-eval'` for bundles that use `new Function` is a manifest-format question for another ticket; it does not affect isolation.

### 3.2 Why brokered network instead of per-host CSP

Writing `network:<hosts>` grants into `connect-src` would work on Chromium and Firefox, but: revoking a grant would require restarting the Plugin (a CSP cannot be loosened or tightened after the document loads), there would be no rate limit or log, BYOK keys would have to enter the sandbox, and on Android and the web build the requests would leave from an opaque origin (`Origin: null`), which many APIs reject. A broker call (`net.fetch(url, init)` over the port, streamed back in chunks for SSE) checks the host list on every call, so revocation is immediate and the Plugin gets a refusal, not a crash (standing decision 8). On Tauri the broker can run the request in Rust; on the web it is the host page's `fetch`, subject to CORS. Which HTTP client the broker uses belongs to the network/secrets ticket.

### 3.3 Second layer (optional, cheap)

Before the Plugin's code runs, the Worker prelude can delete `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `WebTransport`, `importScripts`, `Worker`, `SharedWorker`, `indexedDB`, and `caches` from the global and its prototype chain. This is convention (a Plugin cannot get them back from another realm, because a Worker without `Worker` cannot make one), but it turns a CSP regression in some engine into a `TypeError` instead of a leak. Test T1 must pass with the prelude disabled, so the CSP is proven on its own.

## 4. Budgets

| Budget | Mechanism | Portable? |
| --- | --- | --- |
| Startup | Host timer from frame creation to the Worker's `ready` message; on expiry, terminate and report. | Yes |
| CPU / hang | Host sends a heartbeat through the bootstrap; the Worker's message loop answers. A busy loop cannot answer. After N missed beats, the bootstrap calls `worker.terminate()` and the host removes the frame. `terminate()` aborts the running script ([HTML, "terminate a worker"](https://html.spec.whatwg.org/multipage/workers.html#terminate-a-worker)). The bootstrap stays responsive because the Plugin runs on the Worker's thread, not the frame's. | Yes |
| Message rate / size | Token bucket and payload byte cap in the host broker, per Plugin. Pure code, unit-testable. | Yes |
| Idle stop | Broker tracks the last call; terminate after the idle window (standing decision 4). | Yes |
| Memory | `performance.measureUserAgentSpecificMemory()`: Chrome/Edge/Android WebView 89+, not Firefox, not Safari (browser-compat-data 8.1.4), and only when `crossOriginIsolated` ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Performance/measureUserAgentSpecificMemory)). Available on the web build in Chromium today (COOP/COEP in `public/_headers`); not on WebView2 or Android WebView inside Tauri unless the app is served cross-origin isolated (unverified; would need COOP/COEP headers on Tauri's protocol). Elsewhere: no API. Backstop on every platform: a Worker killed by the engine for OOM fires `error` on the `Worker` object; the bootstrap reports it and the host marks the Plugin stopped with the reason. | No |

Hard memory caps only exist if the Plugin runs inside an interpreter Maibuk controls (QuickJS-in-Wasm, section 5).

## 5. SES, ShadowRealm, QuickJS-in-Wasm

| Option | Status | What it adds | Cost | Verdict |
| --- | --- | --- | --- | --- |
| SES / Hardened JS (`ses` 2.3.0, Endo) | Production use: MetaMask Snaps run "in a sandboxed environment that runs Secure ECMAScript (SES)", in "an iframe with the sandbox property, so the browser sends an Origin header with the value null" ([Snaps execution environment](https://docs.metamask.io/snaps/learn/about-snaps/execution-environment/), [network access](https://docs.metamask.io/snaps/features/network-access/)) | Frozen intrinsics, `Compartment`s with explicit endowments; stops prototype pollution between Plugin modules | Lockdown time at each start, breaks libraries that patch intrinsics; enforcement is JS-level, not platform-level | Not in v1. Revisit if one sandbox ever hosts several Plugins. Snaps is the best-in-class analog for this whole design and matches it (sandboxed iframe, `Origin: null`, gated `fetch`). |
| ShadowRealm | TC39 Stage 2.7 ([tc39/proposals](https://github.com/tc39/proposals)); not shipped in stable engines | A fresh global in the same thread | n/a | Not usable. |
| QuickJS in Wasm (`quickjs-emscripten` 0.32.0) | Maintained; exposes `runtime.setMemoryLimit`, `setMaxStackSize`, `setInterruptHandler` ([README](https://github.com/justjake/quickjs-emscripten)) | Hard memory and CPU limits on every engine, no ambient APIs at all | Interpreter, no JIT: much slower than V8/JSC; adds a Wasm payload per Plugin start; React reconciler inside it is untested | Fallback only, if a hard memory budget becomes a requirement. Runs inside the same sandbox Worker, so the architecture does not change. |

## 6. `Frame` surfaces

A `Frame` is a sandboxed iframe that runs Plugin code in a document, so section 2 applies directly.

- Sandbox tokens: `allow-scripts` only. Never `allow-same-origin`, `allow-top-navigation*`, `allow-popups`, `allow-forms`, `allow-modals`. Opaque origin means no cookies, no `localStorage`, no app IndexedDB ([HTML, sandboxed origin flag](https://html.spec.whatwg.org/multipage/browsers.html#sandboxed-origin-browsing-context-flag)).
- CSP: same `<meta>` as the sandbox frame plus `style-src 'unsafe-inline'` and `img-src blob: data:` so a terminal can draw. The `csp` iframe attribute (CSP Embedded Enforcement) is Chromium-only (browser-compat-data: no Firefox, no Safari), so it cannot be the mechanism; `<meta>` in `srcdoc` works everywhere.
- **Self-navigation is an exfiltration path CSP does not close.** Plugin code in a document can set `location.href = "https://x/?" + data`. `connect-src` does not cover navigation, `navigate-to` was dropped from CSP3, and wry's navigation handlers fire for iframes differently on each platform (Windows: not at all; Linux: the navigation handler; open [wry#1593](https://github.com/tauri-apps/wry/issues/1593)). Whether the embedder's `frame-src` blocks a frame's own navigation is unverified (T6). Treat a `Frame` as able to reach the network unless T6 proves otherwise, and say so in the "custom UI" flag.
- **Android IPC leak (2.3) blocks `Frame` on Android.** Options, in order of preference:
  - **F1, upstream fix in wry:** pass the app origin (for example `http://tauri.localhost`) instead of `"*"` as `allowedOriginRules` for main-frame-only scripts. Opaque-origin frames then never match. A small, reviewable change; Maibuk would pin the wry release that has it.
  - **F2, Maibuk-side:** replace the invoke script through `tauri::Builder::invoke_system` (`tauri-2.9.5/src/app.rs:1555`) with one that returns before binding the key when `window !== window.top`. Works without upstream, but forks a security-critical Tauri script Maibuk must then track on every Tauri update.
  - **F3:** ship `Frame` on Android only after F1 or F2, and declare it unavailable on Android in the manifest's `platforms` meanwhile (Terminal is desktop-only anyway).
- The same Android fact constrains the sandbox *frame* for Worker Plugins: its bootstrap must expose nothing to the Worker but a `MessagePort`, and must treat every Worker message as data (no `eval`, no property lookups on window by name).

## 7. Per-platform table

| Platform | Isolation primitive | Network blocking | IPC leak risk | Budget enforcement |
| --- | --- | --- | --- | --- |
| Linux desktop (WebKitGTK via wry 0.53.5) | Blob Worker inside `sandbox="allow-scripts"` srcdoc frame; opaque origin | CSP `connect-src 'none'` inherited by the blob Worker per spec; **WebKit inheritance unverified (T1)**; prelude deletion as second layer | Worker: none. Frame: none (init scripts top-frame only; `Origin: null` refused) | Startup, heartbeat + `terminate()`, broker rate limits. Memory: no API; OOM `error` only |
| Windows desktop (WebView2) | Same | CSP inherited (Chromium passes WPT) | Worker: none. Frame: key present in the frame, calls refused by `Origin: null` and top-level-only `WebMessageReceived` (**verify, T3**) | Same. Memory: no API inside Tauri unless cross-origin isolated |
| Android (Android WebView via wry) | Same; note Android WebView has no site isolation, so the frame shares the app's renderer process (isolation is Blink's origin checks) | CSP inherited (Chromium) | Worker: none. **Frame: full main-window IPC (T2); blocks `Frame` until F1/F2** | Same as Windows |
| Web, Chromium | Same | CSP inherited (WPT pass) | No Tauri | Same, plus `measureUserAgentSpecificMemory` (app is cross-origin isolated) |
| Web, Firefox | Same | CSP inherited (WPT pass) | No Tauri | Same. Memory: no API |
| Web, Safari / WebKit | Same | **Unverified (T1)** | No Tauri | Same. Memory: no API |

## 8. Recommended architecture

```
host (app origin)                         sandbox frame (opaque, srcdoc + CSP meta)        Worker (opaque, inherits CSP)
-----------------                         ---------------------------------------         ------------------------------
read Plugin files from Plugin Directory
check pinned hash
create <iframe sandbox="allow-scripts"
  srcdoc=bootstrap+CSP>  ----------------> bootstrap: wait for "init"
postMessage(init, [port2], bytes) -------> new Blob(bytes) -> blob: URL
                                           new Worker(blobUrl)          ----------------> prelude removes ambient APIs
                                           forward port2 to Worker                         Plugin code runs
broker on port1  <=============== MessagePort (structured clone only) ===================> plugin API client
  - grant check per call (library:*, network:<hosts>, secrets, clipboard, process)
  - rate / size limits, idle stop, heartbeat watchdog
  - performs the call through Maibuk's own write paths and stores
```

Rules for the implementation tickets:

1. One sandbox frame plus one Worker per active Plugin. The frame is hidden, `aria-hidden`, `inert`, and outside the focus order; it never renders UI. Host-rendered UI arrives as data over the port (standing decision 3).
2. Host code sends Plugin bytes after the hash check; the sandbox never fetches Plugin files itself (no TOCTOU between check and load, and no need for a custom URI scheme, which Tauri would classify as Local).
3. Never `allow-same-origin`, never a registered custom scheme for Plugin documents, never the app origin for a Plugin Worker.
4. `connect-src 'none'` always; network only through the broker.
5. Plugin code ships as one bundled Worker script. Workers do not support import maps, and module Workers from `blob:` cannot resolve relative imports.
6. The Tutorial Library rule (ADR 0008) applies to the broker, not the sandbox: broker calls that write check `isTutorialLibraryActive()` like any other background job.

## 9. Gaps that need a test

Each test runs in every engine listed; desktop ones through `tauri-driver`/WebDriver or a debug build with a test page, web ones in the Playwright `chromium`, `webkit`, and Firefox projects, Android on an emulator through `adb`.

- **T1, CSP reaches the blob Worker (all engines, WebKit first).** In a `sandbox="allow-scripts"` srcdoc frame with `connect-src 'none'`, start a blob Worker that tries `fetch`, XHR, `new WebSocket`, `new EventSource`, `navigator.sendBeacon`, `importScripts("https://...")`, `import("https://...")`, and `new Worker("data:...")`. Pass: each fails and a `securitypolicyviolation` event fires in the Worker; a local test server receives zero requests (assert on the server log, not on the JS error). Run once with the prelude disabled. Also run the WPT file `content-security-policy/connect-src/worker-from-guid.sub.html` in WebKitGTK MiniBrowser.
- **T2, Android IPC from a sandboxed frame.** Debug APK with a test route that embeds a `sandbox="allow-scripts"` srcdoc frame running `window.__TAURI_INTERNALS__.invoke("plugin:os|platform")` and `invoke("plugin:sql|select", ...)`. Expected today: both succeed (leak confirmed). After F1/F2: `__TAURI_INTERNALS__` is undefined in the frame and a hand-written `window.ipc.postMessage` with a guessed key is dropped (Tauri logs the key mismatch).
- **T3, Windows IPC from a sandboxed frame.** Same page on WebView2. Expected: `__TAURI_INTERNALS__` exists in the frame; `invoke` rejects; the Rust side logs the `Origin` parse failure; forcing the postMessage path (frame CSP `connect-src 'none'` makes the `fetch` reject and triggers the fallback at `ipc-protocol.js:60-68`) produces no command execution.
- **T4, Linux IPC from a sandboxed frame.** Same page on WebKitGTK. Expected: `__TAURI_INTERNALS__` undefined; `window.webkit.messageHandlers.ipc.postMessage(...)` with a fabricated body is dropped.
- **T5, Worker at app origin cannot invoke (all Tauri platforms).** A Worker started from the app origin `fetch`es the `ipc` endpoint with a random `Tauri-Invoke-Key`. Expected: no command runs. This guards the invoke key as the last line if a future change starts Workers at the app origin.
- **T6, Frame self-navigation.** In a `Frame` with the recommended CSP, run `location.href = "http://127.0.0.1:<port>/leak"`, and the same through `<a href>` activation and `window.open`. Record whether the test server gets the request on each engine, with and without `frame-src` set on the embedding document. The result decides whether `Frame` Plugins need `network` disclosure regardless of grants.
- **T7, Kill a hung Plugin.** Worker runs `for(;;){}`. Assert the host detects the missed heartbeat within the budget, the Worker is terminated (CPU usage of the renderer returns to idle, measured with the OS process monitor or `chrome://` task manager equivalent), the app's main thread stays responsive (an editor keystroke lands within one frame during the hang), and the broker refuses further calls.
- **T8, OOM is reported.** Worker allocates until the engine kills it. Assert the `error` event reaches the host and the Plugin shows as stopped with a reason, on every engine; record which engines kill the Worker versus the whole renderer (Android WebView has no site isolation, so this may take the app down, which would make a memory cap a v1 requirement there).
- **T9, Web build COEP compatibility.** With `public/_headers` active (`pnpm preview:web`), the sandbox frame loads and the blob Worker starts in Chromium and Firefox; `crossOriginIsolated` is true in the host, and `measureUserAgentSpecificMemory()` attributes bytes to the Plugin's Worker.
- **T10, Opaque origin storage.** From the Worker and from a `Frame`: `indexedDB.open("maibuk")`, `caches.open(...)`, `localStorage`, `document.cookie`. Expected: each throws or sees an empty, separate store; the app's Library database is never listed.
- **T11, Broker grant revocation.** Pure unit test of the broker: revoke `network:<host>` between two calls; the second call is refused with a typed error and the Plugin keeps running.

## 10. Open risks

- **WebKit CSP inheritance into blob Workers is unverified** (T1). If it fails on WebKitGTK, the platform-level network block is gone on Linux and Safari; the prelude deletion would be the only layer, which is convention, not enforcement. Fallback: `data:` Workers (HTML says they clone the owner's policy container too), or QuickJS-in-Wasm.
- **Android IPC leak** (T2) blocks `Frame` on Android until F1 or F2. It does not block Worker Plugins.
- **Same-process isolation on Android WebView.** Without site isolation, a renderer exploit or a Spectre-class side channel in a Plugin can read app memory. Out of reach for a web sandbox; covered by standing decision 8 (the author is responsible for what they install).
- **Memory budget is best-effort** outside Chromium-with-isolation. If T8 shows an OOM in a Worker takes down the Android renderer, a hard cap (QuickJS) moves into v1 for Android.
- **Frame network disclosure** depends on T6.
- **Tauri updates can move these facts.** The invoke key, `Origin` check, frame injection behavior, and Android URL attribution are implementation details, not documented guarantees. T2 to T5 should run on every Tauri/wry bump (they are the only proof).
