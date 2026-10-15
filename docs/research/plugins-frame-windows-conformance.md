# Windows WebView2 Frame conformance (manual run)

The custom-UI `Frame` is **off on Windows** until this run is recorded (#454, D6;
issue #402: "Recorded manual run until a Windows runner exists"). Nothing here
runs in CI. There is one decision to make while you read it: the recorded
`platforms.windows` slot is what flips the gate, and the app reads it at **build
time**, so a Windows build made after you commit it is the first one where the
Frame mounts.

The conformance lane (`pnpm conformance:plugins`, see `e2e/README.md` → "Plugin
conformance lane") measures Linux and Android on the real engines and has no
Windows runner, so this is the manual counterpart: the same recorded-results
idea, with a human running six checks on a real WebView2.

## 1. Build and run the Windows shell

Prerequisites: Windows 10/11 (x64), the WebView2 Evergreen runtime (it ships with
Edge), Rust with the `x86_64-pc-windows-gnu` target, Node, and pnpm.

```bash
pnpm install
pnpm tauri dev        # dev shell; open DevTools with F12 (or right-click → Inspect)
# or a release shell:
pnpm build:windows    # then run the .exe it produces
```

## 2. Add the probe Plugin

The probe is one Plugin whose whole page is a Frame (`customUi: true`, a page that
declares `frame`). Create these three files under
`e2e/fixtures/plugin-sources/frame-probe/`:

`manifest.json`

```json
{
  "manifestVersion": 1,
  "id": "frame-probe",
  "name": "Frame probe",
  "description": "A one-page Plugin whose page is a custom-UI Frame, for the Windows WebView2 Frame conformance (#454).",
  "author": "Maibuk",
  "version": "1.0.0",
  "apiVersion": "^0.1",
  "entry": "index.js",
  "platforms": ["desktop"],
  "customUi": true,
  "lifecycle": "on-demand",
  "defaultLanguage": "en",
  "permissions": { "required": [], "optional": [] },
  "contributes": {
    "commands": [
      { "id": "openProbe", "label": "Open Frame probe", "contexts": ["global"], "navigates": true }
    ],
    "pages": [
      { "id": "probe", "title": "Frame probe", "command": "openProbe", "frame": "ui/index.html" }
    ],
    "sidebarEntries": [{ "page": "probe", "icon": "layout-grid" }]
  }
}
```

`index.tsx` (the Worker entry — just needs to become ready; the Frame is the page)

```tsx
import { servePluginUi } from "@/plugin-sdk/worker-ui";
import { createPluginClient } from "@/plugin-sdk";

if (
  typeof self !== "undefined" &&
  typeof WorkerGlobalScope !== "undefined" &&
  self instanceof WorkerGlobalScope
) {
  self.onmessage = (event) => {
    const port = event.ports?.[0];
    if (!port) return;
    const client = createPluginClient(port);
    servePluginUi(client, {
      pages: {},
      onHostRequest: (method) => {
        if (method === "health.check") return "pong";
        throw new Error(`No handler for ${method}`);
      },
    });
    self.postMessage({ kind: "maibuk:plugin-ready" });
  };
}
```

`ui/index.html` (the Frame document; it prints what it can and cannot reach)

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <style>
      body {
        margin: 0;
        padding: 1rem;
        font-family: ui-sans-serif, system-ui, sans-serif;
        color: var(--maibuk-color-foreground);
        background: var(--maibuk-color-background);
      }
      h1 { color: var(--maibuk-color-primary) }
    </style>
  </head>
  <body>
    <h1>Frame probe</h1>
    <button id="probe" type="button">Frame focus target</button>
    <pre id="report"></pre>
    <script>
      const hostDom = (() => {
        try { void parent.document.body; return "reached"; } catch { return "blocked" }
      })();
      document.getElementById("report").textContent = JSON.stringify(
        {
          tauriInternals: typeof window.__TAURI_INTERNALS__,
          tauriIpc: typeof window.ipc,
          hostDom,
          primary: getComputedStyle(document.documentElement)
            .getPropertyValue("--maibuk-color-primary").trim(),
        },
        null,
        2
      );
    </script>
  </body>
</html>
```

Build it and install it in Settings → Plugins:

```bash
pnpm exec tsx -e "import('./scripts/build-plugin.ts').then(({ buildPlugin }) => buildPlugin({ sourceDir: 'e2e/fixtures/plugin-sources/frame-probe', manifestPath: 'e2e/fixtures/plugin-sources/frame-probe/manifest.json', outDir: '.frame-probe-build' })).then(() => console.log('built .frame-probe-build'))"
```

Then **Settings → Plugins → Add Plugin → pick the built folder** (`.frame-probe-build`),
approve it, enable it, and open its sidebar entry.

## 3. Run the six checks

Run each with the Frame open and its DevTools console active (F12, pick the Frame's
frame in the context selector). These mirror the conformance lane's rules
(`src/features/plugins/conformance/checks.ts`) applied to a Frame.

| id | check | how to see it pass |
| --- | --- | --- |
| `frame-no-network` | no request leaves the Frame | DevTools → Network stays empty; in the Frame console `fetch("https://example.com")`, `new WebSocket("wss://example.com")`, and `new EventSource("https://example.com")` all reject (the Frame CSP keeps `connect-src 'none'`) |
| `frame-no-tauri-ipc` | no Tauri IPC from the Frame | the probe's report shows `"tauriInternals": "undefined"` and `"tauriIpc": "undefined"`; `window.__TAURI_INTERNALS__?.invoke(...)` throws |
| `frame-no-host-dom` | no host DOM access | the probe's report shows `"hostDom": "blocked"`; `parent.document` and `top.document` throw (opaque origin) |
| `frame-theme-tokens` | a theme switch updates tokens | note `"primary"` in the report, switch the app theme (Settings → Appearance, or the theme toggle), and re-check: the Frame's `<html>` `--maibuk-*` custom properties changed (Frame DevTools → Elements → `<html>` → Styles). Change the accent and the font too |
| `frame-notice-visible` | the custom-UI notice shows | "Custom UI: accessibility not verified by Maibuk" is visible above the Frame |
| `frame-keyboard` | keyboard reaches the Frame | Tab from the control before the Frame lands focus on the Frame (`document.activeElement` in the host is the iframe); Tab again reaches the probe button inside it |

## 4. Record it (this flips the gate)

Add a `windows` slot inside `platforms` in
`docs/research/plugins-conformance.results.json`, beside `linux` and `android`.
Use the WebView2 runtime version (the `Edg/<version>` token in the Frame's
`navigator.userAgent`, or `edge://version`) — never the app version. Example entry:

```json
"windows": {
  "ranAt": "2026-10-15T14:30:00.000Z",
  "engine": {
    "name": "tauri-webview2",
    "version": "131.0.2903.86",
    "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.2903.86"
  },
  "device": "Windows 11 24H2 (x64)",
  "appVersion": "0.11.0",
  "commit": "f350f161",
  "ranBy": "Andy",
  "exit": 0,
  "checks": [
    { "id": "frame-no-network", "status": "pass", "detail": "no request left the Frame; connect-src 'none'" },
    { "id": "frame-no-tauri-ipc", "status": "pass", "detail": "__TAURI_INTERNALS__ and window.ipc undefined" },
    { "id": "frame-no-host-dom", "status": "pass", "detail": "parent.document threw" },
    { "id": "frame-theme-tokens", "status": "pass", "detail": "theme and accent switches updated --maibuk-*" },
    { "id": "frame-notice-visible", "status": "pass", "detail": "the custom-UI notice showed above the Frame" },
    { "id": "frame-keyboard", "status": "pass", "detail": "Tab reached the Frame and then the probe button" }
  ]
}
```

`appVersion` is `package.json`'s version; `commit` is `git rev-parse --short HEAD`
on the checkout you built. Every one of the six ids above is required and must
have `status: "pass"` for the gate to open (`exit` is `0` when they all pass,
`1` when any failed; a failed run is still a valid record to commit).

Confirm the record's shape and that it still pins `Cargo.lock`:

```bash
node scripts/plugin-conformance-gate.mjs
```

It must print `plugin conformance gate: Cargo.lock matches …`. Commit the
results file. The build-time read means the next Windows build mounts the Frame;
the whole Plugin keeps working either way.
