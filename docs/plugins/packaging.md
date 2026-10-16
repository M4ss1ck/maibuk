# Packaging

`pnpm package` in the Plugin repository, or `pnpm plugin:package <path>` from the Maibuk checkout, packs the built Plugin into the zip an author installs. This page covers the output layout, what the layout step checks, and how versions map to the Plugin API.

## Output layout

A build writes `dist/<id>/`: the manifest, the bundled entry, and any copied assets and locales. `package` zips that folder into `dist/<id>-<version>.zip`, with the files at the zip root, so manifest.json sits beside the entry. The zip is deterministic: files are stored sorted by path with one fixed modification time, so two runs over the same folder produce byte-identical bytes and a diff between releases means a real change.

This is the same installable layout a Built-in Plugin ships in, so Maibuk loads either one the same way.

## What the layout step checks

The layout step (scripts/plugin/layout.ts) checks the packaged zip against the rules a package must follow:

- manifest.json is at the root and is valid JSON.
- Every file the manifest declares is present: the entry, each page's `frame`, and a sidebar entry's or toolbar button's `icon` when it is a relative .svg path rather than a Lucide icon name.
- No `.ts`, `.tsx`, or `.map` file ships.
- No test file ships.
- Nothing inside node_modules ships.
- No file contains a forbidden absolute path. The check forbids the Maibuk checkout and the Plugin source, so no file in the output contains an absolute checkout path or a source path.

## No publish command

There is no publish command, and building never installs anything into Maibuk. The zip is the whole deliverable.

## Sharing and installing the zip

Share `dist/<id>-<version>.zip`. To run the Plugin, open Settings, then Plugins, and choose Add Plugin to install the zip. Installing a zip this way is a third-party install: Maibuk shows the requested Plugin Permissions, and the author approves them before the Plugin is enabled. Removing a Plugin stops it and deletes its files, approval, startup error, and saved credentials; its row stays.

## Versions and Plugin API compatibility

The manifest carries the Plugin's own `version`, the `apiVersion` range it needs, an optional `minAppVersion`, and an optional `dataVersion`. The Plugin API has its own semver, independent of Maibuk's Release number; before API 1.0 a minor is breaking, so `^0.3` pins 0.3.x.

`checkPluginCompatibility` (src/features/plugins/manifest-compat.ts, with the range parser in src/features/plugins/semver.ts) compares the manifest against the host's API version and the app Release, and returns one plain message:

- `Needs Plugin API <range>; this app provides <version>` when every version the range admits is newer than the host's API.
- `Built for Plugin API <range>; this app provides <version>` when the host's API has moved past what the range admits.
- `Needs Maibuk <minAppVersion> or newer; this app is <version>` when `minAppVersion` is above the app Release.

A Plugin the host cannot run stays listed and off with that explanation; its data is kept. The permission diff between an old and a new manifest compares the required and optional sets per string, so a Plugin Permission that moves from optional to required is flagged even though its name is unchanged.

The optional `dataVersion` is the Plugin's data format version, defaulting to 1. Data written by a newer version is preserved and activation is refused rather than downgraded.

When you raise `dataVersion`, the host asks the Plugin to migrate its stored data once, before it is ready, by sending the `migrateData` host request (`PLUGIN_MIGRATE_DATA_REQUEST`, src/plugin-sdk/protocol.ts) with `{ from }`, the version that wrote the data; src/features/plugins/lifecycle.ts runs this gate before ready. Answer it in the `client.onHostRequest` handler (src/plugin-sdk/index.ts); a throw leaves the data and its version record untouched and refuses activation.

```ts
client.onHostRequest((method, params) => {
  if (method === PLUGIN_MIGRATE_DATA_REQUEST) {
    const { from } = params as { from: number };
    // Read the namespace through the API, rewrite it for the current dataVersion, then:
    return null;
  }
  throw new Error(`No handler for ${method}`);
});
```
