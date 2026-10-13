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
```

`plugins/builtins.json` lists the ids to build and ship, in order:

```json
{ "plugins": [] }
```

The list starts empty; issue #451 adds `maibuk-echoes`. Fixture Plugins under
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
