# Quickstart

This page takes you from a clean Maibuk checkout to a Plugin that passes its own check, with no prior knowledge of Maibuk.

## Prerequisites

- Node.js: a current LTS release. Maibuk's CI pins `lts/*`.
- pnpm 11.8.0, the version in the root package.json `packageManager` field.

## Get Maibuk

Clone Maibuk and install its dependencies:

```bash
git clone https://github.com/M4ss1ck/maibuk.git
cd maibuk
pnpm install
```

## Copy the template outside the checkout

Copy templates/plugin/ to a folder of its own, outside the Maibuk checkout, then make the copy its own git repository:

```bash
cp -r /path/to/maibuk/templates/plugin /path/to/my-plugin
cd /path/to/my-plugin
git init
```

Give the copy its own Plugin id and name in manifest.json, for example `"id": "my-plugin"`. The template ships the id `hello-plugin`, which every copy would otherwise share. The template's test reads the id from manifest.json, so nothing else has to change; rename `name` in package.json too if you like.

## Point it at the checkout

```bash
node scripts/setup.mjs --maibuk /path/to/maibuk
```

setup.mjs writes `maibuk.local.json` with the absolute checkout path, generates the editor's TypeScript configs into `.maibuk/`, and links the Maibuk Plugin authoring skill when the checkout carries it. Every later command needs the checkout; the tooling resolves it with the `--maibuk <path>` flag, then the `MAIBUK_CHECKOUT` environment variable, then `maibuk.local.json`, in that order. A checkout is usable when its package.json names `maibuk`, `scripts/plugin/cli.ts` and `src/plugin-sdk/index.ts` exist, and `node_modules` is installed.

## Check it

```bash
pnpm check
```

`pnpm check` runs eight steps in order and stops at the first failure. A passing run prints one `PASS` line per step and one closing line:

```text
PASS build (1234ms)
PASS validate (12ms)
PASS typecheck (2345ms)
PASS lint (456ms)
PASS test (3456ms)
PASS boundary (34ms)
PASS package (56ms)
PASS layout (23ms)
plugin check passed (8 steps)
```

Each line names the step, in the order build, validate, typecheck, lint, test, boundary, package, layout; the number in parentheses is that step's runtime in milliseconds, so the exact figures vary. A failing run stops at the first `FAIL <step>` and prints that step's details below it. scripts/plugin/steps.ts holds what each step does and scripts/plugin/cli.ts holds how the lines are printed.

## Tour of the template

- manifest.json: the Plugin manifest. It declares the id `hello-plugin`, one Command `openHello`, one page `hello`, and a sidebar entry for that page.
- index.tsx: the entry. It draws the `hello` page with the SDK's host-rendered `ui.*` components and answers the host's requests, including the Command run.
- index.test.tsx: the Plugin's own test, which drives the page with the test kit. See [Testing](testing.md).
- package.json: the scripts that call the Maibuk tooling for this repository (`pnpm check`, `pnpm build`, `pnpm test`, `pnpm validate`, `pnpm package`).
- scripts/: setup.mjs and maibuk.mjs, the two plain-Node scripts that resolve the checkout and launch its CLI. They run before any dependency is installed.
- biome.json and tsconfig.json: the editor's configuration. `maibuk.local.json` and `.maibuk/` are generated and stay out of git.

The template has no locales/ folder. Add one when you translate the manifest strings into another language; see [Host-rendered UI](host-rendered-ui.md).

## Run it in Maibuk

`pnpm check` leaves a zip at `dist/<id>-<version>.zip`, for example `dist/my-plugin-0.1.0.zip`. In Maibuk, open Settings, then Plugins, and choose Add Plugin to install the zip. See [Packaging](packaging.md) for the output layout and how the author reviews the requested Plugin Permissions.

To reload the Plugin each time you rebuild while you develop, turn on Development mode; see [Development mode](development-mode.md).

## The same check from the Maibuk checkout

From the Maibuk checkout you can run the tooling over a Plugin path without being in the Plugin folder:

```bash
pnpm plugin:check /path/to/my-plugin
pnpm plugin:build /path/to/my-plugin
pnpm plugin:validate /path/to/my-plugin
pnpm plugin:test /path/to/my-plugin
pnpm plugin:package /path/to/my-plugin
```

`pnpm plugin:check <path>` runs every step and stops at the first failure, exactly like `pnpm check` inside the Plugin. `pnpm plugin:build`, `pnpm plugin:validate`, `pnpm plugin:test`, and `pnpm plugin:package` each run one step. The Plugin path resolves against the folder you typed the command in.
