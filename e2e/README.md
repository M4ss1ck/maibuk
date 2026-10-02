# Keyboard-first E2E suite

Playwright drives the production **web build** of Maibuk in Chromium and WebKit
using the keyboard only, plus a phone project that proves the touch paths. It is a separate, local command: nothing in `pnpm test`,
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
pnpm fetch:dictation --test-assets   # the Dictation specs' models and test audio
pnpm e2e:voice-audio                 # Piper TTS audio for the Voice Command spec
```

`pnpm e2e:voice-audio` records nothing of the author: it installs Piper in
`.cache/piper-venv` and synthesizes the Voice Command phrases the fake
microphone plays (`vendor/moonshine/e2e-voice/<name>.wav`, 16 kHz mono). Run it
once before `specs/voice-commands-app.spec.ts`; it skips files that exist.

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
pnpm test:e2e --project=voice                     # the audio specs, one at a time
pnpm test:e2e --project=phone                     # the touch specs on a phone
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
5. the runner sweeping leftovers from a killed run, starting the web build on
   a free port (`vite preview`, its own process group) and passing its URL as
   E2E_BASE_URL, then `playwright test --config e2e/playwright.config.ts`.

It stops at the first failing step and prints the wall-clock time at the end.

**Teardown.** The web server stops and the run directory is deleted when the
run passes or fails, on Ctrl+C (Playwright stops first, then the server; a
second Ctrl+C stops at once), on SIGTERM or SIGHUP, and on a crash of the
runner. A runner killed outright (SIGKILL) cannot clean up; the next run
sweeps what it left: it deletes `e2e/.output/preview/run-<pid>/`, killing the
recorded preview only if that pid still runs `vite preview`; a run whose
runner is alive is left alone.

`--allow-planned` lets the guard accept matrix rows that are still `planned`
while a slice is being built. The finished suite runs without it.

`--no-preflight` skips the guard, its self-tests and the typecheck; used by
the `pnpm screenshots` "before" run.

`E2E_REUSE_BUILD=1 pnpm test:e2e ...` skips step 4 when only specs changed. Use
it while iterating; a run without it rebuilds, so it never tests a stale bundle.

The preview runs on a free port each run, so two runs (and the Sync lane) can
run at once and a leftover never blocks a run. Running
`playwright test --config e2e/playwright.config.ts` by hand fails at once with
"No web server".

## Projects

| Project | Engine | Runs |
| --- | --- | --- |
| `chromium` | Chromium | every spec except the audio specs |
| `voice` | Chromium with the fake microphone, one worker | the audio specs: `voice-*.spec.ts` and `dictation*.spec.ts` |
| `webkit` | WebKit (the engine of the Linux and macOS desktop shells) | every spec except `@chromium-only` |
| `mac-platform` | Chromium reporting a Mac `navigator.platform` | only tests tagged `@mac-platform` |
| `phone` | Chromium as a Pixel 7: 412x839 viewport, touch, `isMobile` | only tests tagged `@touch` |

`voice` runs the specs that play audio into the Dictation model, one at a
time, while the other projects run in parallel. The recognizer works in real
time: starved of CPU by parallel tests it drops audio and mishears (a run heard
"Go to Notes" as "Bowdoin oats"), so a spec that plays audio belongs in a file
named `voice-*.spec.ts` or `dictation*.spec.ts`. `--project=chromium` no longer
runs them; add `--project=voice`.

`mac-platform` proves the platform-dependent labels (⌘, ⌥) and the Mod
bindings. It is not real macOS. Specs press `ControlOrMeta`; a spec that also
runs on `mac-platform` presses the `mod` fixture, because `ControlOrMeta`
follows the host OS while TipTap's Mod follows the reported platform.

`phone` proves what AGENTS.md section 2, item 7 requires of touch screens:
`(pointer: coarse)` matches and `hover:` never applies, so a control revealed only on hover stays hidden
there. It is Chromium only: the long-press and swipe helpers send touch points
over CDP. Desktop projects never run `@touch` tests.

All projects use en-US and UTC; the desktop ones use a 1280x800 viewport. Workers default to CPU
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
- `@touch` runs the test only in the `phone` project, and lets it use touch
  input (see "Driving the app by touch").

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
  programmatic interaction (`click`, `dblclick`, `hover`, `dragTo`,
  `check`, `selectOption`, `fill`, `clear`, `focus`, `blur`, `setInputFiles`,
  `locator.press`, `locator.type`, `mouse`), `dispatchEvent`, page scripts
  (`evaluate`, `addInitScript`, `$eval`, `newCDPSession`...), `retries`, or
  importing `@playwright/test` instead of `../support/test`; or touch input
  (`tap`, `touchscreen`, importing `../support/touch`) outside a `@touch` test;
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

### Driving the app by touch

A `@touch` spec drives the phone the way a finger does and locates elements by
role and accessible name like every other spec. Touch input is allowed only
there: `locator.tap()` and `page.touchscreen` anywhere in a spec whose every
test is `@touch` (its helpers included), or inside a single `@touch` test of a
mixed spec. `e2e/support/touch.ts`, which only a spec whose every test is
`@touch` may import, adds what Playwright lacks:

- `longPress(page, target)` holds past React Aria's 500 ms threshold, then
  cancels the touch. Chromium's emulated touch has no long-press gesture, so a
  lifted finger would also become a tap (a compatibility mousedown and click)
  that a phone never sends after a long-press.
- `swipe(page, from, to)` moves a finger without holding first.

Emulated touch starts no HTML5 drag, so the phone project cannot reorder by
dragging a handle. `phone-drag-handle` proves the handle owns the gesture (a
long-press there opens no Item Menu, a swipe from the row body moves nothing);
the drag itself stays with the Vitest suites (see the matrix exclusion).

## Sync lane

Sync runs against a real server, so it has its own lane (issue #222): the
specs in `specs/sync/` drive the web build against a local PocketBase 0.25.0
with the [maibuk-sync](https://github.com/M4ss1ck/maibuk-sync) migrations.
`pnpm test:e2e` ignores them, and like the rest of the suite the lane never
runs in CI.

```bash
pnpm test:e2e:sync                                  # everything, both browsers
pnpm test:e2e:sync --project=chromium               # one browser
pnpm test:e2e:sync specs/sync/sync-conflict.spec.ts # one file
pnpm test:e2e:sync --grep @wf:sync-faults           # one matrix workflow
pnpm test:e2e:sync --repeat-each=3                  # the acceptance run
```

The runner supports Linux and macOS: it stops its servers by process group,
which Windows does not have. One command does the whole job on a clean machine (after the browser install
above): the guard, its self-tests and the e2e typecheck, `pnpm
fetch:sync-server`, the web build, then the server and Playwright
(`playwright.sync.config.ts`). The runner serves the web build itself, on a
free port, so both lanes can run at once. It runs at most four workers: each test drives two or three browser
contexts, and more workers starved a 16-core, 32 GB machine. Arguments pass to `playwright test`; `E2E_REUSE_BUILD=1` skips the
build.

**The server.** `pnpm fetch:sync-server` downloads the PocketBase release zip
for the host and each `pb_migrations/` file of maibuk-sync at a pinned commit,
checks every file against its pinned SHA-256, and caches them in
`vendor/sync-server/` (git-ignored). `run-sync.mjs` then starts PocketBase on
a free 127.0.0.1 port with a fresh data directory under
`e2e/.output/sync-server/run-<pid>/`, creates a superuser with a random
password, and hands Playwright the URL and that superuser through the
environment (`E2E_SYNC_URL`, `E2E_SYNC_SUPERUSER_*`). Running
`playwright test --config e2e/playwright.sync.config.ts` by hand fails at once
with "No sync server": there is no server without the runner.

**Teardown.** The web server and PocketBase stop and the data directory is
deleted when the run
passes or fails, on Ctrl+C (Playwright stops first, then the server; a second
Ctrl+C stops at once), on SIGTERM or SIGHUP, and on a crash of the runner. A
runner killed outright (SIGKILL) cannot clean up; the next run sweeps what it
left: it kills that PocketBase (only if the pid still is PocketBase) and
deletes the directory.

**Fixtures** (`support/sync.ts`). Every test gets a fresh Sync Account,
deleted afterwards, with a random password and Passphrase; nothing in the lane
prints them, a token, or note content. `openDevice()` opens another device: a
new browser context, hermetic and seeded like `page`. "Sync automatically" is
off on every device unless a spec sets `test.use({ autoSync: true })`, so an
idle run cannot race the step under test. The keyboard helpers sign in, enter
the Passphrase, run Sync from Settings, pick a Scope or Direction, and read
the Sync log. Network faults are route interceptions on the objects API
(`failObjectsApi`, `holdObjectsApi`) and `context.setOffline`; a failed
pre-sync Backup is `failBackupWrites` in `support/fault.ts`.

**Artifacts** land in `e2e/.output/sync/` (report and test results). A
failing test's trace holds that test's throwaway account and its Library.

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

## Screenshots for a PR

A PR that changes what the app renders shows it (AGENTS.md, section 2, item 9).
The spec that reaches the state takes the picture:

```ts
import { capture } from "../support/capture";

await capture(page, "editor-color-split-buttons", { around: [textColor, highlightOptions] });
```

`capture` does nothing unless `E2E_CAPTURE_DIR` is set, so the suite runs as
before. When set, it saves `<name>.<project>.light.png` and `.dark.png`,
switching the theme through the emulated color scheme; `around` crops to those
elements plus 24px. Call it before the test's layout assertions, so the "before"
run still captures when the branch fixes what those assertions check.

```bash
pnpm screenshots -g "narrow, whole half"                 # chromium
pnpm screenshots --grep @wf:settings-primary-color --project=webkit
SCREENSHOTS_OUT=/tmp/x SCREENSHOTS_BASE=origin/main pnpm screenshots -g "..."
```

`scripts/pr-screenshots.sh` checks out the merge-base with the base branch in a
temporary worktree, shares the local `node_modules/` and downloaded `vendor/`
assets with it, lays this branch's `e2e/` over it, and runs the selected
tests there (failures are reported, not fatal); then it runs them on the branch
through `pnpm test:e2e`, which must pass. It writes
`/tmp/<branch>/screenshots/{before,after}/`, a `screenshots.md` table for the PR
body, and `attach-args.txt`. Look at each image, then:

```bash
cat body.md /tmp/<branch>/screenshots/screenshots.md > /tmp/pr-body.md
gh pr create --title "..." --body-file /tmp/pr-body.md $(cat /tmp/<branch>/screenshots/attach-args.txt)
```

`gh` (2.99 or later) uploads each `--attach` file to GitHub and rewrites the
body's `![...](path)` references to it, so no image is committed.

## Menu positioning regression gate

A native `<button>` inside React Aria's `MenuTrigger` does not register its
positioning reference. Its fixed `top` and `left` can be correct while the
Popover receives no calculated offsets and falls back to `position: fixed;
top: 0; left: 0`.
Pass that button's ref as the Popover's `triggerRef`, or use a React Aria
Button that registers the trigger automatically. Keep the anchor inside the
viewport, including when a tall image extends below the screen, so React Aria
can flip the menu into the available space. Image keyboard opening claims the
event in capture phase; the text menu respects that claim.

`src/test/unit/menu-positioning.test.ts` checks native menu anchors throughout
`src/` in the regular CI test lane. The editor and image menu E2E rows also
assert actual browser geometry after keyboard opening; pointer and keyboard
opening share the same positioning path. A visibility assertion alone cannot
catch this defect. Their capture points provide light/dark before-and-after
screenshots.

## Troubleshooting

**Port already in use.** The main lane picks a free port every run, so this
cannot come from a previous run. A killed run's server is swept by the next run.

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
