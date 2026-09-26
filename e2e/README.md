# Keyboard-first E2E suite

Playwright drives the production **web build** of Maibuk in Chromium and WebKit
using the keyboard only. It is a separate, local command: nothing in `pnpm test`,
`pnpm test:run`, `pnpm test:coverage`, the builds, the release scripts, CI, or
git hooks runs it.

The coverage guard is browser-free, so it also runs inside Vitest, which CI
already runs (`src/test/unit/e2e-coverage-guard.test.ts`): CI fails when a
route, shortcut, or CONTEXT.md term has no matrix row, or a row has no tagged
spec. Playwright itself stays a local command and never runs in CI.

## Install

```bash
pnpm install
pnpm exec playwright install chromium webkit
```

`@playwright/test` is pinned to an exact version; the browsers must match it.
After bumping it, run the install command again.

On Linux the browsers need their system libraries. `playwright install` prints
the missing one when it cannot launch a browser. Install the whole set with:

```bash
pnpm exec playwright install-deps chromium webkit
```

`install-deps` runs the package manager and asks for sudo, so run it in a
terminal you control. A slim container often also needs `libnss3`, `libnspr4`,
`libasound2`, `libatk1.0-0`, `libatk-bridge2.0-0`, `libcups2`, `libdrm2`,
`libgbm1`, `libxkbcommon0`, `libxcomposite1`, `libxdamage1`, `libxfixes3`,
`libxrandr2`, and `libpango-1.0-0`; `install-deps` covers all of them.

## Run

```bash
pnpm test:e2e                                     # everything: guard, typecheck, build, all projects
pnpm test:e2e --project=chromium                  # one browser (chromium or webkit)
pnpm test:e2e specs/books-create.spec.ts          # one file
pnpm test:e2e specs/books.spec.ts -g "Esc cancels"  # one test by title
pnpm test:e2e --grep @wf:books-create             # one matrix workflow
pnpm test:e2e --grep @sc:editor.bold              # one shortcut id
pnpm test:e2e --repeat-each=3                     # the acceptance run
pnpm test:e2e --headed                            # watch the browser
pnpm test:e2e --debug                             # Playwright Inspector
pnpm test:e2e --ui                                # UI mode
```

Arguments after `pnpm test:e2e` go straight to `playwright test`, so any
Playwright flag works. Test titles carry the matrix tags, which is why `-g` and
`--grep` reach them: `@wf:<row id>` for a workflow, `@sc:<registry id>` for a
shortcut.

`pnpm test:e2e` is `node e2e/run.mjs`. In order it runs:

1. the coverage guard (`e2e/guards/run.ts`);
2. the guard's own self-tests (`e2e/guards/coverage.test.ts`, `node:test`);
3. the e2e TypeScript check (`tsc --noEmit -p e2e`);
4. the web build into `e2e/.output/web-dist` (`VITE_BUILD_TARGET=web`);
5. `playwright test --config e2e/playwright.config.ts`.

It stops at the first failing step and prints the wall-clock time at the end.

`--allow-planned` lets the guard accept matrix rows that are still `planned`
while a slice is being built. The finished suite runs without it.

`E2E_REUSE_BUILD=1 pnpm test:e2e ...` skips step 4 when only specs changed. Use
it while iterating; a run without it rebuilds, so it never tests a stale bundle.

`E2E_PORT` overrides the preview-server port (default `4317`). Set the same
value for the server and the test run, since the `baseURL` is derived from it:

```bash
E2E_PORT=4400 pnpm test:e2e --project=chromium
```

## Projects

| Project | Engine | Runs |
| --- | --- | --- |
| `chromium` | Chromium | every spec |
| `webkit` | WebKit (the engine of the Linux and macOS desktop shells) | every spec except `@chromium-only` |
| `mac-platform` | Chromium reporting a Mac `navigator.platform` | only tests tagged `@mac-platform` |

`mac-platform` proves the platform-dependent labels (⌘, ⌥) and the Mod
bindings. It is not real macOS. Specs press `ControlOrMeta`; a spec that also
runs on `mac-platform` presses the `mod` fixture, because `ControlOrMeta`
follows the host OS while TipTap's Mod follows the reported platform.

All projects use en-US, UTC, and a 1280x800 viewport. Workers default to CPU
cores / 2, retries are 0, and a test times out after 30 s.

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
| Excluded | A row is not the only way to cover something, so an `EXCLUSIONS` entry names the reason and its `owner` (a Vitest suite, manual QA, or a follow-up issue URL). |

Specs declare what they cover with tags in test or describe titles. A tag
counts only in the title of a `test(...)` or `test.fail(...)` declaration, or of
a `test.describe(...)` whose body declares at least one test; a tag anywhere
else (a comment, a variable, an annotation) covers nothing:

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
  tags a row that does not exist (`unknown-row-tag`), a spec has a `@wf:` or
  `@sc:` tag outside a counted title (`orphan-tag`), or a row is still
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

A gap whose right interaction is undecided stays `not-accepted`: set the
`issue` field to the GitHub issue URL and keep the test as `test.fail()` citing
that same URL. The guard fails an expected failure with no issue link, and it
fails a `test.fail()` that starts passing, so a fixed gap gets its marker
removed.

### Seed fixtures

A named seed Library is one file per fixture under `e2e/support/seed/`,
registered in `SEED_LIBRARIES` (`e2e/support/seed/libraries.ts`). Each builder
runs in Node through the app's real per-entity write paths against an in-memory
Library, so a seed holds exactly what the app itself would have stored. The
file also exports the visible names its spec locates by. `empty` is a fresh
device; `tutorialProgress: "clean"` starts Tutorial specs with no progress.

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

`test.fail()` and `--repeat-each` do not change this: a passing test writes no
trace, so only the failing `<test>` directory has one. Open the HTML report in a
browser if the terminal cannot render it; it links every trace.

## Troubleshooting

**Port already in use.** The preview server runs with `--strictPort`, so a run
fails fast if `4317` is taken instead of drifting to another port. Find the
holder with `lsof -i :4317` (or `ss -ltnp | grep 4317`) and stop it, or run on
another port with `E2E_PORT=4400 pnpm test:e2e`.

**Stale build.** A run without `E2E_REUSE_BUILD=1` rebuilds the web target, so
this only happens when you opt in. Drop `E2E_REUSE_BUILD=1` after changing app
code, or delete `e2e/.output/web-dist` and run again.

**Browser-reserved keys.** Some shortcuts the app wires cannot fire in a real
browser because the browser or the OS takes them first. On the web build these
are effectively unbindable: `Ctrl+W` (close the tab) and `Ctrl+N` (new window).
A spec that needs one of them documents it and drives the same action through a
keyboard-reachable control instead. `F11`, `Mod+F`, `Mod+K`, and the `g`
sequences do reach the page and stay testable.

**WebKit clipboard limits.** WebKit cannot grant clipboard permission to the
test, so copy, paste, Paste Cleanup, and Markdown paste specs are tagged
`@chromium-only` and never run in the WebKit project. The full suite still
exercises them, and the exclusion is intentional, not a skip.

**WebKit Tab order quirks.** WebKit reports a different element order around
some browser chrome and focusable widgets, so a spec that counts exact Tab
presses can pass in Chromium and fail in WebKit. Prefer `tabTo(page, target)`
(which presses Tab until the target has focus and reports everything it visited
when it never does) over a fixed number of `Tab` presses, and assert the
focused element rather than a step count.
