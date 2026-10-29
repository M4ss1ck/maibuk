---
status: accepted
---

# Plugins run sandboxed behind a broker, and Built-in Plugins take the same path

Maibuk runs Plugins, its own and the author's. A Plugin's code runs in a `blob:` Worker started inside a hidden, host-owned `<iframe sandbox="allow-scripts" srcdoc>`. The iframe never gets `allow-same-origin`, and its CSP refuses every network path. The host checks the pinned hash (ADR 0020), posts the Plugin's bytes to the Worker, and gives it one `MessagePort`. Every Library, editor, network, clipboard, secret, or process access is a message to a host broker. On every call, the broker checks the Plugin Permission the manifest declared and the author granted. Its own storage, notifications, and navigation need no Permission and are rate-limited instead. Network requests go through the broker, so API keys never enter the sandbox. A revoked Permission refuses the next call with a typed error, and the Plugin keeps running. Built-in Plugins get no private access to stores. They use the same loader, sandbox, manifest, Permissions, and public API as any other Plugin. The only difference is that they ship pre-granted, and those grants are still listed and revocable. The tests for a Built-in Plugin therefore prove the same harness that third-party Plugins get.

Decided in [Plugin sandbox runtime on every Maibuk platform](https://github.com/M4ss1ck/maibuk/issues/392#issuecomment-5963763999) and verified on every engine in [Verify the Plugin sandbox and remote UI on WebKitGTK and Android (T1-T3)](https://github.com/M4ss1ck/maibuk/issues/407#issuecomment-5975568807). The lifecycle and readiness rules are in [Commands, Shortcuts, and Voice Commands contributed by Plugins](https://github.com/M4ss1ck/maibuk/issues/397#issuecomment-5974199143) and [Plugin performance budget: numbers and measurement](https://github.com/M4ss1ck/maibuk/issues/401#issuecomment-5975738585). Those comments hold the detail; this record holds the shape.

## Considered Options

- Plugins in the main webview with full access (Obsidian): rejected. A Plugin could read every Book and call Tauri IPC, and "the author is responsible" would be the only protection.
- Private store access for Built-in Plugins: rejected. The pilot would test a harness that third parties never get, and a Built-in Plugin edited in the Plugin Directory would be trusted code anyone can change.
- An in-Worker JavaScript isolate (SES, ShadowRealm, QuickJS) in v1: rejected. The browser sandbox already isolates the code, and an isolate adds a runtime and its cost. QuickJS returns only if Android Worker memory needs a hard cap.

## Consequences

- The sandbox frame's bootstrap is fixed host code. It creates the Worker, forwards one port, and never evaluates Plugin bytes or loads Plugin HTML, on any platform. A gate test enforces this.
- A Plugin declares a `persistent` or `on-demand` lifecycle. A Plugin is ready when its setup finishes and it answers the first health check, and only then are its Commands usable. There is no invocation queue or replay. An on-demand Plugin starts as soon as one of its surfaces becomes reachable (context warm start).
- Broker limits protect Maibuk only: startup time, heartbeat, call rate, Remote UI size, and message size. A tripped limit stops the Plugin with a reason the author can read.
- No Plugin can call Maibuk's Commands (`runCommand` is not in v1). Plugins contribute Commands, and Maibuk runs them.

## Amendment: Android runs no Plugin in v1 (2026-10-13)

Superseded by the 2026-10-16 amendment below (Android runs Plugins in a memory-capped QuickJS, by opt-in).

The conformance:plugins T8 run on the Android emulator showed a Plugin allocating in yielding chunks growing the WebView renderer to 1.8 GB; lowmemorykiller killed it, and Chromium's `aw_browser_terminator` then killed the whole app (logcat in #492). A Plugin can therefore take down the Android app, so v1 does not run Plugins on Android: no Plugin — Built-in or added — is listed as runnable, enabled, started, or contributes Commands or panels there (#447). The manifest schema still accepts `"android"` in `platforms`, ignored in v1, so a published manifest stays valid and forward compatible. This is the QuickJS trigger named under Considered Options: Android support waits for a hard Worker memory cap (#492).

## Amendment: Android runs Plugins in a memory-capped QuickJS, by opt-in (2026-10-16)

Decided in the #492 grilling; this replaces the 2026-10-13 amendment once it ships. On Android only, the sandbox Worker evaluates the Plugin's module graph in QuickJS compiled to Wasm (`quickjs-emscripten-core` with the quickjs-ng sync variant) instead of handing it to the WebView's engine. The iframe, Worker, port, broker, Permissions, and limits stay as above; only the evaluator changes. Each Plugin gets its own 64 MB QuickJS heap, and the Wasm memory maximum is that cap plus fixed interpreter headroom, so a Plugin that allocates past it stops with the existing `out-of-memory` reason and the renderer survives. Desktop and web keep the native Worker.

The QuickJS shim provides a fixed set of globals: timers, `queueMicrotask`, `performance.now`, `URL`, `TextEncoder`/`TextDecoder`, `console`, and a `MessagePort`-shaped bridge for the SDK and Remote DOM. `Intl` and `WebAssembly` are absent; a Plugin that needs them bundles its own.

Android is opt-in: a Plugin runs there only when its manifest's `platforms` lists `"android"`. A manifest without `platforms` means desktop and web. `pnpm plugin:check` loads a Plugin that lists `"android"` under the same QuickJS shim, so an author without a device learns what is missing before publishing. The Built-in `maibuk-echoes` opts in, so a Built-in proves the whole path on Android. Android has no latency or launch budget in v1; conformance measures and reports QuickJS start time and call latency without gating on them.

Considered and rejected: native QuickJS in Rust (`rquickjs`), which needs a second broker transport over IPC and puts Rust in the trust boundary; QuickJS on every platform, which makes every desktop Plugin pay the interpreter cost; parity by hiding `Intl` and `WebAssembly` from desktop Workers, which takes working globals away from desktop Plugins for no gain; a separate Android WebView, because every WebView in an app shares one renderer process. An `onRenderProcessGone` handler that keeps the app alive when the renderer dies is defense in depth, tracked on its own, and does not lift the Android ban.

## Amendment: the capped QuickJS engine ships in the sandbox Worker (2026-10-16)

#516 ships the amendment above: on Android Plugins now run in a 64 MB capped QuickJS engine inside the same sandbox Worker, so the iframe, Worker, port, broker, Permissions, and limits are unchanged and a Plugin that reaches the cap stops with the existing `out-of-memory` reason while the renderer survives.


## Amendment: a Plugin can warm on intent, not on a listed surface (2026-10-29)

An on-demand Plugin warm-started at every launch from any reachable surface, so the Reader Built-in started although its author never opened it, and its idle heap failed the #653 gates. Two surfaces were listed at launch with no intent: the sidebar entry (`sidebar:<page>`, marked by `PluginSidebarSurfaces`) and a Command whose Context is on screen (`context`, marked by `PluginCommands`). A Command in the `global` Context is on every screen, so one global Command warm-starts its Plugin on every launch. Applying warm-on-intent to the sidebar alone would not have fixed the Reader for that reason.

A Plugin now declares `warmStart`: `surface` (the default, unchanged) or `intent`. An `intent` Plugin is not warmed or kept warm by its sidebar entry or a Command's Context. It warms on its page mounting, on an intent (hover, focus, or press on its sidebar entry, `lifecycle.intend`), or when one of its Commands runs (`runPluginCommandWarm`, which starts the Plugin first). Its Commands and Item Menu entries stay enabled while it is stopped. Running one warm-starts it. A stopped `intent` Plugin does not restart from a listed surface. Only `intent` Plugins change. Surface tracking is the same for every Plugin; only the warm rule reads `warmStart`.

Warm-on-intent was not made global. Making `sidebar` and `context` non-warming for every on-demand Plugin would change Echoes at launch: its Item Menu entry "Find echoes" is disabled while its Plugin is stopped (`usePluginItemMenuActions`, `isDisabled: status !== "ready"`), and Echoes today is warm from its global "Open Echoes" Command. Echoes keeps `surface`; the Reader sets `"warmStart": "intent"` in `plugins/maibuk-reader/manifest.json`. The manifest field is a `"surface" | "intent"` enum; `intent` on a `persistent` Plugin is refused.

**Stop when the page closes.** An `intent` Plugin does not wait out the five-minute idle window after its page closes. It stops `INTENT_IDLE_STOP_MS` (3 seconds) after its last page closes, or after a hover-only warm that never opened a page. Its idle timer is the same one the five-minute stop uses (`armIdle` in `src/features/plugins/lifecycle.ts`), with the shorter window. The stop waits while the host still has open work on the Plugin: a Command run, another host request, an Endpoint answer, or a Plugin call whose handler has not finished (`PluginBroker.hasOpenWork`, which ignores the heartbeat's health check). A page, Frame, or Settings row that is open always keeps it warm. The stop is a normal `idle` stop: no stop toast and no restart. Reopening the page warms it again. Surface and persistent Plugins keep the five-minute window and never read `warmStart`. The Reader saves its Reading Position as Plugin calls (`storage.set`, then the shelf write). `back` awaits that save before it navigates away; `closed` does not wait, so the open-work check is what keeps the Plugin running until the save's calls settle.
