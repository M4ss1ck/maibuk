# Development mode

Development mode reloads a Plugin each time a completed build reaches its Plugin Directory, so you can rebuild in one terminal and watch the running Plugin pick up your changes without adding the zip again.

## Turning it on

The setting is `pluginDevelopmentMode`. Its row is **Development mode** under Settings, then Plugins, with the help text: `Reloads a Plugin when a completed build reaches its folder. Skips the file-change review; permission changes still need approval.` Turning it on skips the file-change review for a folder that changes, but a new required Plugin Permission the author never granted still needs approval.

## How the watched reload works

When development mode is on, the management store subscribes to a watch on the Plugin Directory (src/features/plugins/management.ts), and a change to an enabled Plugin's folder is debounced before a reload. The reload reads the folder twice and treats the change as a completed build only when two reads agree on the folder hash, the manifest validates, and every module the entry reaches is present. The lifecycle then does the restart (src/features/plugins/lifecycle.ts).

- A failed or half-written build keeps the previous one. The two reads disagree, the hash scheme refuses the folder, the manifest does not validate, or a module is missing: in every such case the running build stays and nothing is re-pinned.
- A successful build restarts the Plugin. The lifecycle stops the old Worker and installs the new generation under the `update` reason, so the new one is the build that runs.
- Temporary state is lost. The restart creates a fresh Worker, so anything the Plugin held in memory is gone.
- Stored data is kept. The reload re-pins the hash, digests, version, and approved Plugin Permissions, but leaves the author's grants and the Plugin's stored Library data untouched.
- A new required Plugin Permission blocks the reload. If the author never granted it, the reload is refused as review-required and the previous build keeps running.
- Startup errors stay visible until the next good build. A failed startup is recorded on the approval record and shown in Settings; a successful start clears it.
- Android has no hot reload. Maibuk runs no Plugin on Android in this version, so there is no watched reload there.

At launch, development mode also subscribes the watch and routes a copy that changed while the app was closed through the same reload policy, instead of a change notification.

## Troubleshooting

The tooling fails with a message that names what to fix. The common ones:

- **The checkout is refused.** The message names the source used (`--maibuk`, `MAIBUK_CHECKOUT`, or `maibuk.local.json`), the path tried, and what is missing. A path that is not a folder reads `The Maibuk checkout named by --maibuk is not a folder: /path/to/maibuk`; a checkout missing a piece reads `The Maibuk checkout named by --maibuk is not a Maibuk checkout: /path/to/maibuk` with one `  - <problem>` line per problem, such as `package.json does not name "maibuk"`. Point it at a real Maibuk checkout:

  ```bash
  node scripts/setup.mjs --maibuk /path/to/maibuk
  ```

- **The dependencies are missing.** A structurally valid checkout with nothing installed reads `The Maibuk checkout named by --maibuk is not ready to run: /path/to/maibuk`, then `  - node_modules is missing; dependencies are not installed`, then the fix. Install them in the Maibuk checkout:

  ```bash
  pnpm install
  ```

  A `node_modules` that exists but is incomplete reports `node_modules/tsx/dist/cli.mjs is missing; dependencies are not installed` instead.

- **No source named a checkout.** A command with no flag, no environment variable, and no `maibuk.local.json` reads `No Maibuk checkout was given for the Plugin repo at <path>.` Run `node scripts/setup.mjs --maibuk /path/to/maibuk` in the Plugin folder.

- **The boundary refuses an import.** Each violation reads `file:line specifier: reason`, for example `index.tsx:3 @/features/plugins/relative-path: @/features/plugins/relative-path is private; import only @maibuk/plugin-sdk or a relative file inside the Plugin`. Import only `@maibuk/plugin-sdk` (and its public subpaths), `@maibuk/plugin-test-kit` in tests, or a relative file inside the Plugin.

- **Validation fails.** The manifest validator prints one line per problem as `file: path: message`, for example `manifest.json: version: must be a semver version` or `manifest.json: permissions.required[0]: "library:readd" is not a known Plugin Permission`. A `locales/<lang>.json` problem prints the same way. An unknown field is refused, so `permisions` in place of `permissions` reads `manifest.json: permisions: Unknown field "permisions"`.

- **The layout fails.** The packaged zip is checked for `manifest.json` at the root, every declared file present, no `.ts`, `.tsx`, or `.map` files, no test files, no `node_modules`, and no leaked absolute path. Problems read like `"index.ts" must not ship .ts, .tsx, or .map files` or `declared file "index.js" is missing`.

- **The path is wrong.** A path that is not a folder reads `The Plugin path is not a folder: <path>`. A folder with no manifest reads `No manifest.json in <path>.`, followed by the note that the path must point at the Plugin repo, not its parent. A `package` or `layout` run before the earlier step reads `<path> is missing; run the build step first` or `<path> is missing; run the package step first`.
