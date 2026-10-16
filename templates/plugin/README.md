# Maibuk Plugin template

The one minimal host-rendered Maibuk Plugin. It declares a page with a sidebar
entry and one Command that opens it, and draws the page with the SDK's
host-rendered UI kit. Copy the folder to start a Plugin of your own.

## Quickstart

1. Copy this folder somewhere and give it your Plugin's own name.
2. `git init` in the new folder.
3. Point it at your Maibuk checkout, which writes `maibuk.local.json` and the
   editor's TypeScript configs:

   ```bash
   node scripts/setup.mjs --maibuk /path/to/maibuk
   ```

4. Check the Plugin:

   ```bash
   pnpm check
   ```

`pnpm check` runs every step in order (build, validate, typecheck, lint, test,
import boundary, package, layout) and stops at the first failure.

## The import rule

Your Plugin may import `@maibuk/plugin-sdk` (and its public subpaths), a package
you install in your own `node_modules`, or a relative file inside your own
folder. `react` and `react-dom` resolve to Maibuk's own copy. The test kit
`@maibuk/plugin-test-kit` is allowed in test files only. `pnpm check` refuses a
private `@/...` import, an absolute path, another `@maibuk/` package, a relative
path that leaves the folder, and a Node builtin in shipped source.

## Output

`pnpm check` builds into `dist/<id>/` (the manifest and the bundled entry) and
packs that folder into `dist/<id>-<version>.zip`, with the files at the zip root.

Building never installs anything into Maibuk. To run your Plugin, add the zip
from Settings → Plugins.

The full authoring guide is in the Maibuk checkout, at `docs/plugins/README.md`.
