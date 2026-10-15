# Built-in Plugins

Source for the Built-in Plugins Maibuk ships (issue #444). A Built-in is a
Plugin like any other: it takes the same manifest, Plugin Permissions, sandbox,
and API (ADR 0019); the only difference is that Maibuk bundles its compiled copy
and starts it with those Permissions pre-granted.

## Layout

Each Built-in lives in its own folder, `plugins/<id>/`, named after the Plugin
id:

```
plugins/<id>/
  manifest.json     the Plugin manifest (same schema as any Plugin)
  index.ts          the entry, or index.tsx when it draws host-rendered UI
  assets/           optional; copied verbatim into the built folder
  locales/          optional; copied verbatim (the manifest's locale files)
  *.test.ts         the Plugin's own tests, never built, never shipped
  fixtures/         optional; test inputs, never built
  GLOSSARY.md       optional; the Plugin's own terms (CODING_STANDARDS.md, Domain language)
  vendor/           optional; third-party source copied in, with its licence and provenance
```

`plugins/builtins.json` lists the ids to build and ship, in order:

```json
{ "plugins": ["maibuk-echoes"] }
```

Echoes (`maibuk-echoes`) is the first Built-in Plugin. Fixture Plugins under
`e2e/` or `src/test/` are never bundled; the build only reads this list.

## Activation

The host announces why a Plugin was activated on the Plugin's own MessagePort,
as the first message it posts: `{ kind: "maibuk:plugin-init", startReason }`.
`startReason` is one of `enable`, `launch`, `update`, `restore`, `resetLibrary`,
`databaseLoad`, `settingsReset`, `warmStart`, or `restart`, so a Plugin can tell
a Restore or a Reset from a plain launch. A raw-wire Plugin reads
`event.data.startReason` from that message; a Plugin on `@/plugin-sdk` reads
`client.activation?.startReason`. The field is optional, so a Plugin that
ignores the message keeps working.

```ts
const client = createPluginClient(port);
client.activation?.startReason; // "restore" after a Restore
```

## Custom UI Frames

Set `customUi: true` in the manifest and a page or the kit `Frame` may render
your own HTML/CSS/JS in a sandboxed `Frame` (ADR 0021: host-rendered UI is the
default, a Frame is the second path). A whole-page Frame declares
`frame: "<relative path>.html"` on a page contribution; an embedded Frame uses
`<Frame src="ui/report.html" title="Report" />`. Every file the Frame loads comes
from your *verified hashed* folder, so keep the HTML, CSS, JS, images, and fonts
inside it and reference them with relative paths. A Frame's only host channel is
`window.maibuk.port`, the `MessagePort` that connects it to your Plugin's Worker;
use it to talk to the Plugin (e.g. `createPluginClient(window.maibuk.port)` on
the Plugin side is the Worker's port, and the Frame receives the other end).

A Frame is styled with the host's semantic theme tokens: the host writes each
public `--maibuk-*` property below onto the Frame's `<html>` on load and again
whenever the theme, accent, or font changes, so use them instead of hard-coded
colors. Names are a stable Plugin-facing contract; see
`docs/agents/design.md` "Frame theme tokens" for meanings.

```
--maibuk-color-primary            --maibuk-color-card
--maibuk-color-primary-hover      --maibuk-color-card-foreground
--maibuk-color-primary-foreground --maibuk-color-destructive
--maibuk-color-secondary          --maibuk-color-destructive-hover
--maibuk-color-background         --maibuk-color-success
--maibuk-color-foreground         --maibuk-color-info-bg
--maibuk-color-muted              --maibuk-color-info-text
--maibuk-color-muted-foreground   --maibuk-color-warning-bg
--maibuk-color-border             --maibuk-color-warning-text
--maibuk-color-error-bg           --maibuk-color-success-bg
--maibuk-color-error-text         --maibuk-color-success-text
--maibuk-color-scheme             --maibuk-font-sans
--maibuk-font-serif               --maibuk-font-mono
--maibuk-font-size                --maibuk-spacing-editor-max
```

## Adding a Built-in

1. Create `plugins/<id>/` with `manifest.json` and an `index.ts` or `index.tsx`.
   Import the API from `@/plugin-sdk`, and keep the entry self-contained: the
   build produces one ESM file with nothing left external.
2. Add the Plugin id to `plugins/builtins.json`.
3. Write the Plugin's own tests beside its source.

## Building

```bash
pnpm build:plugins                       # target inferred from the environment
pnpm tsx scripts/build-builtin-plugins.ts --target web|desktop|android
```

The build writes an installable folder per Plugin to `dist/plugins/<id>/`
(manifest, bundled entry, copied assets and locales) plus `dist/plugins/index.json`,
the shipped list the app installs from. `dist/` is not committed.

Both dev lanes build the Plugins once before Vite starts, so the running app sees
the current sources: `pnpm tauri dev` runs `pnpm build:plugins --target desktop`
first, and `pnpm dev:web` runs `--target web`. Vite dev serves `dist/plugins/` at
`/plugins/` (the desktop run also re-copies it into the app's resources).

A Release build includes a Built-in only for the platforms its manifest declares:
a Plugin whose `platforms` exclude the target is skipped with
`omitted <id>: platforms exclude <target>`.

Android is unsupported in v1: Maibuk runs no Plugin on Android (ADR 0019
amendment, #447), so the `--target android` build ships no Built-in at all and
skips every Plugin with `omitted <id>: Plugins do not run on android in this
version`. A manifest may still list `android` in `platforms`; the value stays
valid and is ignored there, so a published manifest needs no change.

## Bundle-size gate

The build fails when any built entry exceeds **150 KB gzip**. The entry already
contains the SDK from `src/plugin-sdk`, so the gate covers the SDK plus the
Plugin together.

## External Plugins

A Plugin in its own repository is an External Plugin. It is the same Plugin as a
Built-in: the same manifest, sandbox, and Plugin Permissions. Only the source
location differs, and the tooling in `scripts/plugin/` builds, tests, and
packages it.

### Starting a repo

Copy `templates/plugin/`, `git init` in the copy, and point it at your Maibuk
checkout:

```bash
node scripts/setup.mjs --maibuk /path/to/maibuk
```

`templates/plugin/README.md` holds the quickstart. This section covers the
tooling the copy wires up.

### Pointing at a Maibuk checkout

Every command needs the checkout the tooling runs from. The repo resolves it in
this order:

1. the `--maibuk <path>` flag,
2. the `MAIBUK_CHECKOUT` environment variable,
3. `maibuk.local.json` in the Plugin repo.

`setup.mjs` writes `maibuk.local.json`, which is machine-specific and stays out
of git, like the `.maibuk/` folder it generates for the editor. A checkout is
usable when its `package.json` names `maibuk`, `scripts/plugin/cli.ts` and
`src/plugin-sdk/index.ts` exist, and `node_modules` is installed.

### Imports

An External Plugin imports `@maibuk/plugin-sdk` and its public subpaths, which
resolve to the checkout's `src/plugin-sdk/`, and any package it installs in its
own `node_modules` (a relative file inside the Plugin folder is fine too). Tests
may also import `@maibuk/plugin-test-kit`, never shipped source. `react` and
`react-dom` always resolve to Maibuk's own copy, in build, test, and typecheck,
so one React runs per renderer. Maibuk's `@/...` modules are private and are
refused.

### Repository scripts

Maibuk's `package.json` exposes one script per command over a Plugin path:

```bash
pnpm plugin:build <path>     # bundle into <path>/dist/<id>/
pnpm plugin:validate <path>  # validate manifest.json and locales/
pnpm plugin:test <path>      # run the Plugin's tests through the kit
pnpm plugin:package <path>   # zip dist/<id>/ into dist/<id>-<version>.zip
pnpm plugin:check <path>     # every step, stopping at the first failure
```

`<path>` resolves against the folder the command was typed in, so
`pnpm plugin:check ../my-plugin` works. An External Plugin repo wires the same
commands to its own `pnpm build`, `pnpm test`, `pnpm validate`, `pnpm package`,
and `pnpm check` through `scripts/maibuk.mjs`.

`plugin:check` runs eight steps in order and stops at the first failure,
printing `PASS <step>` or `FAIL <step>`:

1. build
2. validate: the host's manifest validator, as a third-party Plugin
3. typecheck: `tsc` with a generated tsconfig
4. lint: Maibuk's Biome over the Plugin folder
5. test: the Plugin's tests through the kit
6. boundary: the import boundary
7. package: the zip
8. layout: the packaged zip against the layout rules

It exits `0` only when every step passed, and `1` on the first failure. The
steps without their own script (typecheck, lint, boundary, layout) run through
`tsx scripts/plugin/cli.ts <command> <path>`.

### Output

A build writes `dist/<id>/`: the manifest, the bundled entry, and the copied
assets and locales. `package` zips that folder into `dist/<id>-<version>.zip`
with the files at the zip root. This is the same installable layout as a
Built-in Plugin, so Maibuk loads either one the same way, and no file in the
output contains an absolute checkout path or a source path (the layout step
fails the package when one leaks).

There is no publish command, and building never installs anything into Maibuk.
To run the Plugin, add its zip from Settings → Plugins.

### Troubleshooting

- **The checkout is refused.** The message names the source used (`--maibuk`,
  `MAIBUK_CHECKOUT`, or `maibuk.local.json`), the path tried, and what is
  missing. Point it at a real Maibuk checkout with
  `node scripts/setup.mjs --maibuk /path/to/maibuk`.
- **`node_modules is missing`.** The checkout has no installed dependencies.
  Run `pnpm install` in the Maibuk checkout.
- **The boundary refuses an import.** Each violation reads
  `file:line specifier: reason`, for example
  `index.tsx:3 @/features/plugins/relative-path: @/features/plugins/relative-path is private; import only @maibuk/plugin-sdk or a relative file inside the Plugin`.
  Import only `@maibuk/plugin-sdk` (and its subpaths), `@maibuk/plugin-test-kit`
  in tests, or a relative file inside the Plugin.
