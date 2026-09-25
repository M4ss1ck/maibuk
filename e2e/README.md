# Keyboard-first E2E suite

Playwright drives the production **web build** of Maibuk in Chromium and WebKit
using the keyboard only. It is a separate, local command: nothing in `pnpm test`,
`pnpm test:run`, `pnpm test:coverage`, the builds, the release scripts, CI, or
git hooks runs it.

## Install the browsers (once)

```bash
pnpm install
pnpm exec playwright install chromium webkit
```

`@playwright/test` is pinned to an exact version; the browsers must match it.
After bumping it, run the install command again.

## Run

```bash
pnpm test:e2e                                     # everything: typecheck, build, all projects
pnpm test:e2e --project=chromium                  # one browser
pnpm test:e2e specs/books-create.spec.ts          # one file
pnpm test:e2e -g "Esc cancels"                    # tests whose title matches
pnpm test:e2e --grep @wf:books-create             # one matrix workflow
```

Arguments after `pnpm test:e2e` go straight to `playwright test`.
Each run rebuilds the web target into `e2e/.output/web-dist` so it never tests a
stale bundle. When only specs changed, `E2E_REUSE_BUILD=1 pnpm test:e2e ...`
skips the build.

## Projects

| Project | Engine | Runs |
| --- | --- | --- |
| `chromium` | Chromium | every spec |
| `webkit` | WebKit (the engine of the Linux and macOS desktop shells) | every spec |
| `mac-platform` | Chromium reporting a Mac `navigator.platform` | only tests tagged `@mac-platform` |

`mac-platform` proves the platform-dependent labels (⌘, ⌥) and the Mod
bindings. It is not real macOS. Specs press `ControlOrMeta`; a spec that also
runs on `mac-platform` presses the `mod` fixture, because `ControlOrMeta`
follows the host OS while TipTap's Mod follows the reported platform.

All projects use en-US, UTC, and a 1280x800 viewport.

## How a test starts

`e2e/support/test.ts` is the only `test` specs import. Every test gets:

- a fresh browser context (fresh IndexedDB and localStorage);
- a **seed Library** (`test.use({ library: "oneBookThreeChapters" })`), built
  in Node through the app's real write paths (`e2e/support/seed/`) and written
  into the web adapter's IndexedDB store before the app boots. `empty` (the
  default) is a fresh device with no Library;
- **Tutorial progress**: `dismissed` by default, so the first-launch offer does
  not cover empty-Library specs; Tutorial specs use `tutorialProgress: "clean"`;
- a **hermetic network**: every request that is not the preview server is
  aborted. The sql.js wasm is served from `node_modules`, and the update check
  gets an empty tag list.

Seeded names live in `e2e/support/seed/names.ts`, so specs never import app code.

## Output

Everything generated lands in `e2e/.output/` (gitignored): the web build,
seeds, `test-results/` (screenshot on failure, trace kept for the first failure
of a test), and the HTML report.

```bash
pnpm exec playwright show-report e2e/.output/report
pnpm exec playwright show-trace e2e/.output/test-results/<test>/trace.zip
```
