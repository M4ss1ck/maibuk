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
