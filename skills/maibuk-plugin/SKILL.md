---
name: maibuk-plugin
description: Create, change, test, or package a Maibuk Plugin, in its own repository or as a Built-in Plugin under plugins/ in the Maibuk checkout.
---

# Maibuk Plugin authoring

You are building a **Plugin**: a packaged addition to Maibuk that reaches the author's work only through the public SDK and the **Plugin Permissions** it declares. This skill holds the workflow, the UI-path rules, the boundaries, and the handoff. Everything the code can tell you (methods, props, components, permission names, theme tokens, manifest fields) lives in the Maibuk checkout; read it there, at the checkout's version. If this skill and the generated types disagree, the generated types win.

## Where things are

`<maibuk>` is the Maibuk checkout: the path in the Plugin repo's `maibuk.local.json`, or the repo root for a Built-in Plugin. Every path below is relative to it.

| Need | Read |
| --- | --- |
| Reading order for the authoring guide | `docs/plugins/README.md` |
| Template, setup, and `pnpm check` output | `docs/plugins/quickstart.md`, `templates/plugin/` |
| Manifest fields, contributions, localization, Plugin Permissions | `docs/plugins/host-rendered-ui.md` |
| Frame: when, how, theme tokens, restrictions | `docs/plugins/frame-ui.md` |
| Test kit and keyboard tests | `docs/plugins/testing.md` |
| Zip layout, versions, `apiVersion`, `dataVersion` and data migration | `docs/plugins/packaging.md` |
| Development mode and troubleshooting | `docs/plugins/development-mode.md` |
| Every Plugin API method (types are the source of truth) | `docs/plugins/api-reference.md`, `src/plugin-sdk/api.generated.ts` |
| Every host-rendered component and its props | `docs/plugins/ui-reference.md`, `src/plugin-sdk/ui.generated.ts` |
| A complete Plugin to copy patterns from | `plugins/maibuk-echoes/` (page, sidebar entry, Commands, Settings row, toolbar button, Item Menu entry, highlights, locales, tests) |

Your code imports only `@maibuk/plugin-sdk` and its public subpaths (`@maibuk/plugin-sdk/ui-serve`, `@maibuk/plugin-sdk/worker-ui`), packages installed in the Plugin's own `node_modules`, and relative files inside the Plugin folder. Test files may also import `@maibuk/plugin-test-kit`.

## Steps

### 1. Scaffold or open

- **New Plugin repo:** copy `<maibuk>/templates/plugin/` to a folder outside the checkout, give it its own id and name in `manifest.json` and `package.json`, `git init`, then run `node scripts/setup.mjs --maibuk <maibuk>`. Done when `pnpm check` passes on the untouched copy.
- **Existing Plugin:** run `pnpm check` (or `pnpm plugin:check <path>` from the checkout) before editing. Done when you know whether it was green, so a later failure is yours to explain.

### 2. Choose the UI path

**Host-rendered UI is the default.** Maibuk draws it from the component table, so focus, keyboard, theming, and screen-reader behavior come from Maibuk.

Choose a **Frame** only when the component table cannot express the surface: a canvas, a chart, a DOM-dependent third-party library, a rich widget that already exists as web code. A Frame Plugin:

- sets `customUi: true` and leaves `android` out of manifest `platforms`;
- bundles the library inside the Plugin folder, so it ships in the zip;
- styles with the host's `--maibuk-*` theme tokens from `frame-ui.md`;
- owns its own accessibility, which the handoff states.

Done when you can name the path for every surface and, for each Frame, the component-table gap that justifies it.

### 3. Declare the smallest Plugin Permission set

For each API method you call, look up the Plugin Permission it needs in `api-reference.md`. Put a permission in `permissions.required` only when the Plugin is useless without it; everything else goes in `permissions.optional`, and the code handles the denial. Done when every declared permission maps to a method the code calls, and every called method's permission is declared.

### 4. Implement

Model the code on `plugins/maibuk-echoes/` and the template: contributions in `manifest.json`, pages drawn with `ui.*`, host requests answered through the SDK client. User-visible strings start in the manifest's `defaultLanguage` and get `locales/<lang>.json` overrides when the Plugin is translated. When a release changes the shape of stored Plugin data, raise `dataVersion` and migrate it as `packaging.md` describes. Done when every requested surface exists and the code imports only what "Where things are" allows.

### 5. Test

Tests run through `@maibuk/plugin-test-kit`, the same host Maibuk runs, per `testing.md`. Each interactive host-rendered surface gets a `user-event` test that presses keys and asserts the result (the Command runs, the page opens, the setting changes). Each Command gets a test that runs it. Done when every surface and every Command has a test that would go red if it broke.

### 6. Check

Run `pnpm check` in the Plugin repo, or `pnpm plugin:check <path>` from the checkout. It builds, validates the manifest, typechecks, lints, tests, checks the import boundary, packages the zip, and checks its layout, stopping at the first `FAIL`. Fix the cause and rerun. Done when the final line reads `plugin check passed` and the command exits 0.

### 7. Hand off

Report, in this order:

1. The command you ran and its exit code, plus the zip path under `dist/`.
2. The surfaces built, the UI path of each, and the Plugin Permissions declared with the method that needs each.
3. Engines: jsdom through the test kit is checked. Every other engine (the installed desktop app, the web app, Android) is unchecked unless you ran the Plugin there yourself; name each one left unchecked.
4. For a Frame: "This Plugin uses custom UI; Maibuk does not verify its accessibility."
5. The in-app checklist for the author: install the zip from Settings → Plugins, review the permission prompt, open each surface, run each Command and Shortcut, and try Development mode reload. Mark an item done only if you ran it.

## Gaps

When the public API or the component table cannot do what was asked, stop and report the gap in the session instead of building around it. The report names:

- the capability needed;
- the closest public method or component, with its reference path;
- whether a Frame or a Plugin Permission legitimately covers it, and why or why not.

Build only from the public SDK; the author closes a gap by deciding whether to ask Maibuk for a new method or component. A gap stays open until then: an import from Maibuk's `src/` or copied SDK code fails the import boundary, and a Frame earns its place only by step 2's component-table rule, never as a way to reach Maibuk's DOM. Changing Maibuk itself, adding host APIs or kit components, publishing, and signing sit outside this skill.
