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

## Coverage matrix and guards

`e2e/coverage-matrix.ts` is the frozen minimum the suite proves: one row per
keyboard workflow, plus exclusions. Rows may be added; none may be removed or
weakened without the maintainer.

A row has an `id`, `area`, the `workflow` and keys it drives, its `edges`
(cancel, empty, validation, failure paths: each gets its own test), the
CONTEXT.md `terms` and shortcut-registry `shortcuts` it exercises, the App.tsx
`routes` it runs on, its seed `fixture`, `tags`, and a `status`:

| Status | Meaning |
| --- | --- |
| `planned` | No spec yet. Fails the run unless `--allow-planned` is passed. |
| `accepted` | Every listed edge has its own passing test. |
| `not-accepted` | An undecided-interaction gap. Needs `issue` (a GitHub issue URL) and a spec that keeps the test as `test.fail()` citing that URL. |

Specs declare what they cover with tags in test or describe titles:

- `@wf:<row id>` marks the tests of a row.
- `@sc:<registry id>` marks the shortcuts they press. Every shortcut a row
  lists must be tagged in a spec file that carries that row.
- `@mac-platform` also runs the test in the `mac-platform` project, and
  `@chromium-only` keeps it out of WebKit (clipboard rows only).

`pnpm test:e2e` runs `e2e/guards/run.ts` before anything else. It fails, naming
the reason, when:

- a CONTEXT.md term outside an excluded section has no row and no exclusion
  (`term-uncovered`), or a row names a term that does not exist (`unknown-term`);
- a shortcut-registry id has no row and no exclusion (`shortcut-uncovered`), or
  a row's shortcut is not tagged `@sc:` by a spec carrying the row
  (`row-shortcut-untagged`);
- an App.tsx route has no row (`route-uncovered`);
- an accepted or not-accepted row is carried by no spec (`row-no-spec`), a spec
  tags a row that does not exist (`unknown-row-tag`), or a row is still
  `planned` (`row-planned`);
- a spec uses `test.skip`, `test.fixme`, or `.only` (`skip-fixme-only`), or
  `test.fail()` without a `https://github.com/M4ss1ck/maibuk/issues/N` URL
  (`fail-without-issue`);
- a spec breaks the keyboard contract (`keyboard-contract`): pointer or
  programmatic interaction (`click`, `dblclick`, `hover`, `tap`, `dragTo`,
  `check`, `selectOption`, `fill`, `clear`, `focus`, `blur`, `setInputFiles`,
  `locator.press`, `locator.type`, `mouse`, `touchscreen`), `dispatchEvent`,
  page scripts (`evaluate`, `addInitScript`, `$eval`...), `retries`, or
  importing `@playwright/test` instead of `../support/test`;
- any e2e file other than `e2e/support/storage.ts` and `e2e/support/fault.ts`
  touches IndexedDB, localStorage, or sessionStorage (`storage-outside-support`).

The guard's own tests (`e2e/guards/coverage.test.ts`, `node:test`) run next;
each feeds it one bad fixture and expects the named rejection.

While building a slice, `pnpm test:e2e --allow-planned ...` accepts the rows
that are still `planned`. The finished suite runs without it.

### Adding a row

1. Add the row to `ROWS` with `status: "planned"`.
2. Write the spec: every test carries `@wf:<id>`; tag each shortcut it presses
   with `@sc:<id>`; one test per edge.
3. Set `status: "accepted"` once each edge passes in both engines with
   `--repeat-each=3`.

### Driving the app by keyboard

Specs locate elements by role and accessible name and assert focus with
`toBeFocused()`. `e2e/support/keyboard.ts` has the helpers:
`tabTo(page, target)` presses Tab until the target has focus,
`pressUntilFocused(page, "ArrowDown", target)` moves inside a roving group,
`expectTabContained(page, dialog)` proves a dialog keeps Tab inside. The file
chooser is the one allowed bypass: open it with a key, then
`(await page.waitForEvent("filechooser")).setFiles(path)`.

## Output

Everything generated lands in `e2e/.output/` (gitignored): the web build,
seeds, `test-results/` (screenshot on failure, trace kept for the first failure
of a test), and the HTML report.

```bash
pnpm exec playwright show-report e2e/.output/report
pnpm exec playwright show-trace e2e/.output/test-results/<test>/trace.zip
```
