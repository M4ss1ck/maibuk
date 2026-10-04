# Plugin sandbox and remote UI on real engines (T1-T3)

Run date: 2026-10-03. Ticket: #407, map: #389. This records three runs that settle claims the earlier research ([sandbox runtime](plugins-sandbox-runtime.md), [remote UI](plugins-remote-ui.md)) could only make from source. The T1 and T3 probe code is on branch `research/plugins-engine-verification` (`research/plugin-engines/`). Machine-readable results for the future `conformance:plugins` lane: [plugins-engine-verification.results.json](plugins-engine-verification.results.json).

## Results

| Test | Question | Result |
| --- | --- | --- |
| T1 | Does `connect-src 'none'` in a sandboxed `srcdoc` frame reach the `blob:` Worker it starts? | **Pass on every engine**: WebKitGTK 2.52.6 (Tauri Linux), Playwright WebKit 26.5, Chromium 151, Firefox 153, Android System WebView 113. No network path reached the server. |
| T2 | Can a sandboxed, opaque-origin frame call Tauri IPC? | **Linux: no. Android: withheld pending private disclosure to the Tauri maintainers.** The Worker has no IPC on either platform. |
| T3 | Remote DOM keystroke echo latency on WebKitGTK and Android WebView | p95 1-2 ms with an empty tree, 8 ms (WebKitGTK) and 11 ms (Android emulator) with 1,000 updating rows at typing pace. One new finding: the echo rule from #391 loses text in bursts (below). |

### What changes

- **T1 pass**: the network part of the sandbox decision stands. CSP stays the platform-level network block on every engine, and the prelude deletion stays a second layer.
- **T2**: `Frame` is off on Android in v1. A Plugin that declares a `Frame` surface does not offer it on Android (the manifest's `platforms`, option F3 in the sandbox research). Revisit once that disclosure is resolved.
- **The sandbox frame never runs Plugin code, on any platform.** Its bootstrap is fixed host code: it creates the Worker from the Plugin's bytes and forwards one `MessagePort`. It must never evaluate Plugin code itself, load Plugin HTML, or relay Worker messages into anything that reaches `window`. An implementation ticket carries this as a gate test (the bootstrap source contains no `eval`, `Function`, script injection, or `importScripts` of Plugin bytes in the frame realm), and the T2 probe joins the periodic `conformance:plugins` lane.
- **T3**: the host-owned input rule needs one correction (next section). The latency numbers feed [Plugin performance budget](https://github.com/M4ss1ck/maibuk/issues/401).

## T1: CSP reaches the blob Worker

**Setup.** The probe page creates a hidden `<iframe sandbox="allow-scripts" srcdoc>`. Its `<meta>` CSP is `default-src 'none'; script-src 'unsafe-inline' blob:; worker-src blob:; connect-src 'none'`. (The sandbox research's policy lacked `script-src 'unsafe-inline'`, which the frame's own bootstrap script needs. The real host needs it too, or a hash of the bootstrap.) The frame starts a `blob:` Worker that tries nine paths to a local collector: `fetch`, XHR, WebSocket, EventSource, `sendBeacon`, `importScripts`, dynamic `import()`, a nested `data:` Worker that fetches, and a nested `blob:` Worker that fetches. No prelude ran, so the CSP was tested alone.

**Control.** A second frame is identical except that it has no CSP. Every verdict is read from the collector's request log: a path is *blocked* when the control frame's request arrived and the CSP frame's did not. The main document's own fetch to the collector also had to arrive, which shows the origin (`tauri://localhost`, `http://tauri.localhost`) can reach it at all.

| Engine | Runs | fetch | XHR | WebSocket | EventSource | importScripts | import() | nested data: | nested blob: |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| WebKitGTK 2.52.6, Tauri 2.9.5 / wry 0.53.5, Linux | 2 | blocked | blocked | blocked | blocked | blocked | blocked | blocked | blocked |
| Playwright WebKit 26.5 | 2 | blocked | blocked | blocked | blocked | blocked | blocked | blocked | blocked |
| Chromium 151 | 2 | blocked | blocked | blocked | blocked | blocked | blocked | blocked | blocked |
| Firefox 153 | 2 | blocked | blocked | blocked | blocked | blocked | blocked | blocked | blocked |
| Android System WebView 113, Tauri Android, API 34 emulator | 2 | blocked | blocked | blocked | blocked | blocked | blocked | blocked | blocked |

`sendBeacon` does not exist in a dedicated Worker on any engine, so it is not a path.

**Side finding.** WebKit (both WebKitGTK and Playwright WebKit) does not dispatch `securitypolicyviolation` events inside the Worker. Chromium and Android dispatched 7, Firefox 3. The requests are still refused. The broker must not depend on violation events to notice a Plugin probing the network.

**Not run:** the WPT file `worker-from-guid.sub.html` in the WebKitGTK MiniBrowser. The probe covers the same case in the real Tauri webview with a server-side check, which is stronger evidence for Maibuk.

## T2: Tauri IPC from a sandboxed frame

Same probe page, built into the app (`VITE_PLUGIN_PROBE=1` redirect). Each sandboxed frame records what it can see and tries Tauri IPC; the frame's Worker does the same.

- **Linux (WebKitGTK 2.52.6, tauri 2.9.5, wry 0.53.5):** the frame has no `__TAURI_INTERNALS__`. A message posted without the invoke key is refused (`__TAURI_INVOKE_KEY__ expected … but received …`), and the custom-protocol IPC URL is refused on its `Origin` header.
- **Android:** the result is withheld pending private disclosure to the Tauri maintainers. Details are added here after a fix ships. Until then `Frame` stays off on Android.
- **Both platforms:** the Worker inside the frame has no `__TAURI_INTERNALS__` and no `ipc`.

## T3: Remote DOM keystroke echo

This is the [remote UI prototype](plugins-remote-ui.md) rebuilt to the same shape: one remote text field, one text node, N remote rows whose labels change on every keystroke, React 19.2.3 on both sides, and `BatchingRemoteConnection`. The driver differs: a Tauri webview has no Playwright, so every engine was driven the same way. The input's value is set through the native setter, and an `input` event is dispatched for each of the 70 characters, at 100 ms intervals ("typing pace") or 0 ms ("burst"). Latency runs from the host `onChange` to the host layout effect that sees the echo. Each row is 3 runs: medians of p50 and p95, the worst max, and the startup range (Worker created to first remote element committed). WebKit clamps `performance.now()` to 1 ms.

| Engine | Rows / key interval / echo rule | p50 / p95 / max (ms) | Startup (ms) | Final text correct |
| --- | --- | --- | --- | --- |
| WebKitGTK (Tauri Linux) | 0 / 100 / last | 1 / 2 / 3 | 20–29 | 3/3 |
| WebKitGTK | 200 / 100 / last | 3 / 4 / 6 | 28–31 | 3/3 |
| WebKitGTK | 1000 / 100 / last | 7 / 8 / 15 | 50–54 | 3/3 |
| WebKitGTK | 1000 / 0 / last | 7 / 20 / 24 | 47–51 | 3/3 |
| WebKitGTK | 1000 / 0 / in-flight | 8 / 22 / 24 | 46–50 | 3/3 |
| Android WebView 113 (emulator) | 0 / 100 / last | 0.8 / 1.1 / 2.6 | 28–34 | 3/3 |
| Android | 200 / 100 / last | 2.1 / 4.5 / 6 | 38–44 | 3/3 |
| Android | 1000 / 100 / last | 7.3 / 11.3 / 18 | 70–73 | 3/3 |
| Android | 1000 / 0 / last | 26.6 / 32.4 / 35.8 | 72–78 | **0/3** |
| Android | 1000 / 0 / in-flight | 26.8 / 35.4 / 38.9 | 75–83 | 3/3 |
| Chromium 151 (same driver) | 0 / 100 / last | 0.4 / 0.7 / 2.1 | 32–36 | 3/3 |
| Chromium | 1000 / 100 / last | 4.8 / 6.2 / 10 | 53–54 | 3/3 |
| Chromium | 1000 / 0 / last | 4.7 / 10.3 / 12 | 51–57 | 2/3 |
| Playwright WebKit 26.5 | 1000 / 0 / last | 18 / 20 / 34 | 46–49 | **0/3** |
| Firefox 153 | 1000 / 0 / last | 11 / 20 / 27 | 60–69 | 2/3 |

The full table (every engine, 0/200/1,000 rows, both intervals, both rules) is in the results JSON. The desktop numbers agree with #391's (Chromium 1,000 rows at typing pace: p95 6.2 ms here, 11.5 ms there, on a busier machine), so the native-setter driver and Playwright's keyboard measure the same thing.

**Android numbers are from an x86_64 emulator on a 16-core desktop.** They show that the Android WebView path works and how it compares to desktop. They do not predict a mid-range phone. No physical device was attached. Settle that in the performance budget ticket, or the first `conformance:plugins` run on a phone.

### Correction to the host-owned input rule

#391 settled "the host owns text input values": the host applies a remote `value` only when it differs from what the host last sent. In bursts over a large tree that rule loses text. An echo of an *older* value arrives after a newer keystroke. It differs from the last value sent, so the host applies it and rolls the field back. At 0 and 200 rows the final text was always right. At 1,000 rows it was wrong in 1 of 3 runs on Chromium and Firefox and 3 of 3 on Playwright WebKit and Android; WebKitGTK happened to stay correct in its 3 runs. At typing pace it never happened.

The fix that held in all 15 burst runs at 1,000 rows (every engine): the host keeps the list of values it has sent that have not echoed yet. A remote `value` in that list is an echo: drop it and every value sent before it. Only a value not in the list is a Plugin-initiated change and is applied. A sequence number on each `input` event, echoed back by the SDK, is the same rule with less memory. That is the shape the kit's text field should take. Latency is unchanged (table above).

## Verification log

| Claim | How it was checked | Status |
| --- | --- | --- |
| T1 blocks all eight paths per engine | Collector request log, control frame must reach, 2 runs per engine (10 runs) | Verified |
| WebKit sends no CSP violation events in Workers | Event count in the Worker: 0 on WebKitGTK and Playwright WebKit (4 runs), 7/7/3 on Chromium/Android/Firefox | Verified |
| Linux frame cannot call IPC | No `__TAURI_INTERNALS__`; keyless post refused (stderr line); custom protocol refused on `Origin` | Verified on WebKitGTK 2.52.6 |
| T3 latency per engine | 3 runs per row, same driver on every engine | Verified for these engines. Android is an emulator, not a phone. |
| Burst rollback with the #391 rule, fixed by the in-flight rule | 15 runs per rule at 1,000 rows across 5 engines | Verified |
| Android T2 | Withheld pending private disclosure | Added after a fix ships |
| Windows (T3 of the sandbox research) | Not in this ticket | Unverified |
