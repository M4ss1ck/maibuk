# Keyboard-first E2E suite

Playwright drives the production **web build** of Maibuk in Chromium and WebKit
using the keyboard only, plus a phone project that proves the touch paths. It is a separate, local command: nothing in `pnpm test`,
`pnpm test:run`, `pnpm test:coverage`, the builds, the release scripts, CI, or
git hooks runs it.

The coverage guard is browser-free, so it also runs inside Vitest, which CI
already runs (`src/test/unit/e2e-coverage-guard.test.ts`): CI fails when a
route, shortcut, or GLOSSARY.md term has no matrix row, or a row has no tagged
spec. CI also typechecks the e2e project (`tsc --noEmit -p e2e`), the same
command step 3 below runs, so a broken e2e config or spec type fails there.
Playwright itself stays a local command and never runs in CI.

## Install

```bash
pnpm install
pnpm exec playwright install chromium webkit firefox
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

The WebKit build also needs `libavif16` (`sudo apt-get install libavif16`).
`install-deps` runs the package manager and asks for sudo, so run it in a
terminal you control. A slim container often also needs `libnss3`, `libnspr4`,
`libasound2`, `libatk1.0-0`, `libatk-bridge2.0-0`, `libcups2`, `libdrm2`,
`libgbm1`, `libxkbcommon0`, `libxcomposite1`, `libxdamage1`, `libxfixes3`,
`libxrandr2`, and `libpango-1.0-0`; `install-deps` covers all of them.

## Run

```bash
pnpm test:e2e                                     # everything: guard, typecheck, build, all projects
pnpm test:e2e --project=chromium                  # one browser (chromium or webkit)
pnpm test:e2e --project=firefox                   # the @sandbox group in Firefox
pnpm test:e2e --project=voice                     # the audio specs, one at a time
pnpm test:e2e --project=phone                     # the touch specs on a phone
pnpm test:e2e specs/books-create.spec.ts          # one file
pnpm test:e2e specs/books.spec.ts -g "Esc cancels"  # one test by title
pnpm test:e2e --grep @wf:books-create             # one matrix workflow
pnpm test:e2e --grep @sc:editor.bold              # one shortcut id
pnpm test:e2e --grep @sandbox                     # the Plugin sandbox lane: chromium, webkit, firefox
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
| `webkit` | WebKit (the engine of the Linux and macOS desktop shells) | every spec except `@chromium-only`; a test that seeds or installs Plugins gets a persistent context (see Troubleshooting) |
| `firefox` | Firefox | only tests tagged `@sandbox` (the Plugin sandbox's engine coverage) |
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

`phone` proves what `CODING_STANDARDS.md` ("Keyboard and accessibility", item 7) requires of touch screens:
`(pointer: coarse)` matches and `hover:` never applies, so a control revealed only on hover stays hidden
there. It is Chromium only: the long-press and swipe helpers send touch points
over CDP. Desktop projects never run `@touch` tests.

`firefox` is limited to the `@sandbox` group, so `pnpm test:e2e --grep @sandbox`
runs the Plugin sandbox lane on Chromium, WebKit, and Firefox. A change to the
Plugin sandbox, broker, or remote UI renderer runs that lane locally and says so
in the PR (`CODING_STANDARDS.md`, E2E).

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
  aborted, and the update check gets an empty tag list.

Seeded names live in `e2e/support/seed/names.ts`, so specs never import app code.

## Coverage matrix and guards

`e2e/coverage-matrix.ts` is the frozen minimum the suite proves: one row per
keyboard workflow, plus exclusions. Rows may be added; none may be removed or
weakened without the maintainer.

A row has an `id`, `area`, the `workflow` and keys it drives, its `edges`
(cancel, empty, validation, failure paths: each gets its own test), the
GLOSSARY.md `terms` and shortcut-registry `shortcuts` it exercises, the App.tsx
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
  `@chromium-only` keeps it out of WebKit (clipboard rows, and tests that need a
  CDP-only helper such as `withCpuThrottle`).
- `@touch` runs the test only in the `phone` project, and lets it use touch
  input (see "Driving the app by touch").

`pnpm test:e2e` runs `e2e/guards/run.ts` before anything else. It fails, naming
the reason, when:

- a GLOSSARY.md term outside an excluded section has no row and no exclusion
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

## Frame-rate lane

`pnpm bench:frames` checks that the app holds its frame budget during the
interactions authors perform (issue #372). It sits beside the other periodic
lanes (`bench:palette`, `bench:dictation`): run it before a release and
before and after a jank fix, never in CI, because frame timing on a shared
runner is noise. It prints a budget table per scenario, writes a JSON report
to `.bench/frames-<source>.json`, exits 1 when a scenario misses its budget,
and exits 2 when it could not measure at all (no display, no web build, no
adb device, an author's Library on the device, no tauri-driver or
WebKitWebDriver for the desktop source).

```bash
pnpm bench:frames                                   # Chromium, every scenario, headed
pnpm bench:frames --scenario typing                 # one scenario (repeatable, or a,b)
pnpm bench:frames --repeat 5                        # more runs per scenario
pnpm bench:frames --cpu-throttle 4                  # Chromium 4x slower: a mid-range phone
pnpm bench:frames --headless                        # Chromium's new headless mode
pnpm bench:frames --source probe --headless         # WebKit through the rAF probe
pnpm bench:frames --source android                  # the installed debug app over adb
pnpm bench:frames --source desktop --reuse-build    # the Linux release app (WebKitGTK) over WebDriver
pnpm bench:frames --reuse-build --raw               # skip the build; keep raw captures
pnpm bench:frames --list                            # scenarios, warm-ups, and what each measures
pnpm exec tsx scripts/frame-bench-budget.ts .bench/frames-chromium.json  # re-check a report
```

**Sources.** Each turns a measured window into the same normalized sample
set, which the frame report (`src/test/support/frames/frame-report.ts`)
judges:

- `chromium`: the compositor's own `PipelineReporter` trace events over CDP,
  measured in vsync slots; the refresh interval is the compositor's BeginFrame
  spacing. Long animation frames come with the scripts that ran in them.
- `probe`: an in-page `requestAnimationFrame` recorder, for engines with no
  tracing protocol (WebKit; also `--engine chromium` to cross-check). The
  refresh interval is a quiet page's rAF cadence. Headless WebKit ticks rAF on
  a ~16 ms timer instead of a display, so its numbers say less than a headed
  run (the default, `--source probe`), which is the representative WebKit
  number. Headed WebKit presents at about 60 Hz even on a faster display, so
  the probe judges it against a ~16 ms interval where Chromium on the same
  monitor gets the display's own. It needs Playwright's system libraries once
  per machine (`sudo pnpm exec playwright install-deps webkit`); without them
  the lane exits 2 and prints that command.
- `android`: `dumpsys gfxinfo com.massick.maibuk framestats` (IntendedVsync to
  FrameCompleted, flagged rows dropped), with the refresh period from
  SurfaceFlinger. The lane drives the app's WebView over CDP, so it needs a
  debug build (`pnpm tauri android build --debug --apk true`), and one device
  or `ANDROID_SERIAL`. It swaps a seed Library into the install before each
  scenario, so it only measures a test install: the first time, the Library
  there must hold no Books, Chapters, Notes, or Canvases, and the lane then
  marks the install as its own. Sidebar resize and the Settings outline do not
  exist at phone width and are skipped there. A frame's duration here is
  Android's own measure, IntendedVsync to FrameCompleted (render time), not the
  cadence the web sources read, so compare Android runs with Android runs.

- `desktop`: the probe, inside the real Linux shell. Playwright's WebKit is
  not the WebKitGTK build the shell ships, so this source builds the Tauri
  release binary under the bench identifier (`com.massick.maibuk.bench`) and
  drives it through `tauri-driver` and `WebKitWebDriver`. Input is WebDriver
  Actions, which go through WebKit's own input pipeline (trusted wheel,
  pointer, and key events), never synthetic DOM events. Every launch gets a
  fresh temporary `HOME`/XDG tree with the scenario's seed copied in as its
  Library, so the author's install is unreachable. WebDriver has no init
  scripts, so the probe is injected after each load. Prerequisites, found on
  `PATH`, in `~/.cargo/bin`, or through `TAURI_DRIVER` / `WEBKIT_WEBDRIVER`:
  `cargo install tauri-driver --locked` and
  `sudo apt install webkit2gtk-driver` (its version must match
  `libwebkit2gtk-4.1`), plus a display. The report records the WebKitGTK
  version, the display server (X11 or Wayland), and the build profile. The
  scenario drivers are the same code as every other source: they act on
  `e2e/frames/frame-page.ts`, which Playwright and WebDriver
  (`src/test/support/frames/webdriver.ts`, with role queries resolved in the
  page by `src/test/support/frames/locate.ts`) both implement. Plugin
  scenarios are skipped here (no Plugin Directory is seeded; bench:plugins
  `--engine webkitgtk` measures Plugins on this engine). Judge desktop runs
  with the probe's caveats below, and compare them with desktop runs.

  `--reuse-build` reuses the binary only when the stamp beside it
  (`src-tauri/target/release/maibuk.frames-stamp.json`) names this lane, HEAD
  plus a digest of uncommitted app-source edits, and the binary's size and
  mtime: bench:plugins writes the same path with its in-app driver baked in,
  and that build must never be measured here.

  One WebKitWebDriver quirk the client works around: a wheel source
  dispatches only the change from its previous action's delta, so every
  wheel tick is sent on a fresh source.

The probe counts every rAF tick of the measured window as a frame, idle ticks
included, so on a sparse interaction (one keystroke every 83 ms) its dropped
percentage is diluted compared with Chromium's, which counts only the frames
the page asked for. Compare probe runs with probe runs.

Every source also records each keystroke and when the next frame starts (the
typing and palette budgets judge it), and long animation frames where the
engine reports them (Chromium and Android WebView; elsewhere a frame over
50 ms stands in, without attribution). The lane builds the web app with source
maps, so a failing scenario names the code behind its longest frames as
`src/lib/shortcuts.ts:87 (event) via DOMWindow.onkeydown 150.5 ms`, or a
package path for a dependency. The Android source names the bundle only.

**Budget.** One table, `src/test/support/frames/budget.ts`, frozen with its
rationale: p95 frame time at or under one refresh interval of the display
being measured (a 180 Hz display is judged against 5.6 ms, never 16.7), dropped
frames (over 1.5 intervals) under 1%, no long animation frame over 50 ms,
keystroke to next frame within one interval for typing and the palette, and at
least 60 frames, or the scenario is `not-measured`, which fails. A scenario may
differ only there, and every difference carries a written reason
(`frame-bench-check.test.ts` enforces it).

**Scenarios.** They are measurements, not E2E specs: the keyboard contract
and the pre-run guard cover `e2e/specs/` only, so a driver may use the mouse,
the wheel, and `page.evaluate` where the interaction measured needs them.
`src/test/support/frames/scenarios.ts` declares them (seed,
warm-up, measured window, repetitions, sources that skip them, and why);
`e2e/frames/drivers.ts` performs them, by keyboard where the interaction is
keyboard, and by wheel or mouse drag where the interaction is a pointer
gesture (scroll, Canvas pan and zoom, the sidebar edge). Canvas panning is a
mouse drag of the pane, since React Flow zooms on the wheel. The Settings
scenario scrolls the page rather than jumping by keyboard: a jump moves focus
to the section heading, with no keyboard way back to the outline but Tab
through every control, while scrolling makes each section current in turn and
the outline moves at every change. The arrow scenarios (`arrow-leave-notes`,
`arrow-leave-chapters`) Shift+F6 into a long list and ArrowRight out of it,
twenty times; the page times each arrow it acts on from keydown until the
focus target is decided, excluding the focus change
(`window.__maibukArrowLeaveMs`, set by the driver), and the report judges its
p95 as the handler-time line. Their in-window focus checks use CSS locators,
since a role query walks the whole 500-row list and its cost would land in
the measured frames. `pane-slide` presses F6 every 250 ms to slide the Pane
frame. `notes-filter-toggle` opens the Notes list's Filters Popover and
presses Space twenty times on the excluded `task` Tag, so a third of 2,000
Notes leave the list and come back. They run on the `perfLongChapter`,
`perfDenseCanvas`, `perfManyNotes` (500 Notes), `perfTaggedNotes` (2,000
tagged Notes) and `perfManyChapters` (100 Chapters) seeds
(`support/seed/perf-libraries.ts`), built through the real write paths like
every other seed. Repetitions run back
to back after one warm-up; the table shows every run and the pooled verdict.
`frame-scenarios.test.ts` fails when a scenario names a seed, budget, or driver
that does not exist.

Two scenarios render a `fixture-bench` Plugin, so they run on the `chromium`
source only: the `probe` (Playwright WebKit) and `android` sources seed no
Plugin Directory (the probe's ephemeral WebKit context has no OPFS, and the
Android WebView seeds no web one),
and each carries that `skip` reason. `plugin-remote-ui` wheels the Plugin's
1,000-row Remote UI table while scrolling, on the default budget, and records no
keystrokes: keystroke echo belongs to `bench:plugins`, not here.
`typing-with-highlights` types the 120-character burst in `perfLongChapter`
while the Plugin paints about 500 highlight ranges, judged like `typing` (each
keystroke's frame starts within one refresh interval). `typing-with-echoes`
types the same burst with spell check and Echoes highlights on (toggled with
its Default Shortcut), so Echoes' at most 2,000 painted ranges are judged the
same way.

**Comparing runs.** The report records the source, engine and version, mode
(headed, new-headless, headless, device), device, refresh rate, CPU
throttling, app version, and commit (`-dirty` with local changes). Compare two
reports only when those match. For a jank fix, run the scenario on `main` and
on the branch and paste both tables into the PR. `--raw` keeps each run's raw
trace, framestats, or probe dump under `.bench/frames-raw/<source>/`: the
input a parser fixture is refreshed from.

## Plugin conformance lane

`pnpm conformance:plugins` measures the real Plugin sandbox on the native
engines (issue #447). It builds the app with the test-only flag
`VITE_PLUGIN_CONFORMANCE=1`, whose route drives the *real* runtime, sandbox,
Worker, broker, and lifecycle against the `fixture-hostile` Plugin and a healthy
`fixture-healthy` neighbour, and posts every check to a local collector. It
proves T2 (no Tauri IPC from the sandboxed frame or the Worker), T7 (the busy
loop is stopped as unresponsive), T8 (the yielding allocation stops the Worker
with a memory reason while the host renderer and the healthy neighbour survive),
and every escape (the Plugin gets a typed refusal, a stop, or an ignored forged
reply, and the collector logs no request from it). It sits beside the other
periodic lanes (`bench:frames`, `bench:palette`): run it before a release and
whenever Tauri or wry moves, never in CI.

It needs a display and WebKitGTK (`libwebkit2gtk-4.1-dev`, `pkg-config
webkit2gtk-4.1`) for the Linux half, and one adb device (or `ANDROID_SERIAL`)
for the Android half. The Android half only measures a test install: the device
must hold no author Library, and the lane claims the install as its own through
the frame-rate lane's `claimTestInstall` (a fresh install gets a Library from a
launch first). To reset a throwaway test emulator, `adb -s <serial> shell pm
clear com.massick.maibuk`.

```bash
pnpm conformance:plugins --platform linux --record    # Linux (WebKitGTK)
pnpm conformance:plugins --platform android --record  # the adb device (Android QuickJS)
pnpm conformance:plugins --platform all               # every available platform
pnpm conformance:plugins --platform linux --skip-build --out .bench
pnpm conformance:plugins --help
```

Flags: `--platform linux|android|all` (default `all`, skipping an unavailable
one), `--record` (merge each measured run into the committed results),
`--skip-build` (reuse the last build), `--out <dir>` (default `.bench`), and
`--timeout <minutes>` (default 10).

Exit codes: 0 every check passed, 1 a check failed, 2 it could not measure (no
display, no device, a build failure, a timeout before any result, or an
`unmeasured` check). It never runs in CI.

**Reports and logs.** Each platform's run is written to
`.bench/plugins-conformance-<platform>.json` (`--out`), and the app's own output
(Linux stderr, Android logcat) to `e2e/.output/conformance/<started>/`. With
`--record`, a *measured* run (exit 0 or 1) merges into
`docs/research/plugins-conformance.results.json`; an exit-2 run never does, and
a failure while the host is supported still records, keeping exit 1, so the file
shows it. Android is judged on the same checks as Linux, T1 to T8, so an Android
run records its exit like any other platform. A run that measured the QuickJS
engine also records its `startMs` and `callLatencyMs` timings, with no gate on
them.

**Version gate.** The recorded results pin the Tauri and wry versions read from
`src-tauri/Cargo.lock` (`scripts/plugin-conformance-gate.mjs`, run by its vitest
gate). A bump to either version fails the gate until a fresh `pnpm
conformance:plugins --record` refreshes the file: a result is only valid on the
engine it was measured on, so rerun on any Tauri or wry bump.

**Android runs Plugins that list "android" in `platforms` (#517).** The product
runs a Plugin on Android only when its manifest lists "android"
(`manifestRunsOn` in `src/features/plugins/host-platform.ts`), in the memory-capped
QuickJS engine (#492, #516): the 64 MB cap is hard, so a Plugin that exhausts its
heap stops with `out-of-memory` and the WebView renderer survives. Custom Frame UI
stays off on Android. The Android conformance run is judged on T1 to T8 like
Linux: T8 must stop the hostile Plugin with exactly `out-of-memory` while a healthy
Plugin beside it keeps answering. The lane's seam reports the true Android directory
kind, and the hostile and healthy fixtures list `"android"` in their manifest
`platforms`, so the real launch scan starts them. A measured Android run records the engine's start time and call latency (no
gate on them, decision-401).

## Plugins bench lane

`pnpm bench:plugins` measures the browser Plugin budget (issue #448) against
frozen budgets (`scripts/plugins-bench-budget.mjs`). It sits beside the other
periodic lanes (`bench:frames`, `bench:palette`, `conformance:plugins`): run it
before a release and whenever a Plugin's start path moves, never in CI, because
browser timing on a shared runner is noise. Six rows are judged, all in
milliseconds:

- **launch delta**: a launch with 20 on-demand clones against a no-Plugin
  baseline, as the difference of their medians.
- **persistent delta**: a launch with 3 persistent Plugins against the same
  baseline, judged the same way. Both deltas must stay within
  `max(5% of the baseline median, 20 ms)`.
- **start-to-ready**, per on-demand Built-in Plugin: the p95 of the
  `plugin.start:<id>` measure, from opening a surface to the Plugin ready, at or
  under 150 ms. On Chromium it runs on `fixture-everything-on-demand`, on the
  Echoes Built-in (measured explicitly until [#451](https://github.com/M4ss1ck/maibuk/issues/451) lists it in `plugins/builtins.json`), and on every on-demand
  id in `plugins/builtins.json` (none today).
- **Command to effect**: a Plugin Command's Shortcut press to its first visible
  effect, p95 at or under 100 ms.
- **Remote UI echo**: one keystroke's echo committed to the DOM with a
  1,000-row page, p95 at or under 16 ms.
- **Remote UI burst**: the same echo typed in a burst, p95 at or under 50 ms.

**Engines.** `chromium` builds the web app with `VITE_PLUGIN_BENCH=1` into a
directory of its own (`e2e/.output/plugins-bench-web`, so the flag never leaks
into the E2E build) and runs the Playwright bench specs in `e2e/plugins-bench/`.
`webkitgtk` measures the real engine of the Linux desktop shell. Playwright's
WebKit is a different build from the WebKitGTK the shell ships, so the lane drives
the **real Tauri Linux debug binary** instead: built once with
`VITE_PLUGIN_BENCH=1` and `VITE_PLUGIN_BENCH_DRIVER=1` under its own app
identifier and product name (`com.massick.maibuk.bench`), so it never touches
the author's install. Every launch gets a fresh temporary `HOME`/XDG tree, so it
is a fresh device with its own Plugin Directory, seeded with the fixture's bytes
and the approval records the scenario needs; the gated in-app driver
(`src/features/plugins/bench/`) reads the per-launch seed, measures, and posts
to a local collector. The
WebKitGTK samples use synthetic events (a dispatched Shortcut, keystrokes
through the native input value setter), since no Playwright drives that lane;
the report records the native `build` profile (debug or release). It needs a
display and WebKitGTK, like the conformance lane's Linux half.

**Measurement choices.** Echo and burst end when the echo is committed to the
DOM, not at the next frame: the frame tail is the display's phase noise, and
keystroke-to-frame alignment belongs to `bench:frames`, whose
`plugin-remote-ui` and `typing-with-highlights` scenarios cover it. Launch
discards two warm-up loads, so a cold first start never decides the delta, and
echo/burst discard two warm-up keystrokes, so a cold first Remote UI update
never decides p95. Every row is a nearest-rank p95 (sort, index
`ceil(0.95n) - 1`), except the two launch deltas, which compare medians.

**Echoes rows (Chromium only).** On `perfLongChapter` with Echoes highlights
on: `echoHighlightUpdate` is the host main-thread time per `setHighlights`
apply (budget 10 ms), `echoWorkerRecompute` is Echoes' own detection and range
building in its Worker (50 ms), and `echoRefreshLatency` runs from the last
keystroke to the highlight update (350 ms: spell check's 300 ms debounce plus
Worker time). The host marks are gated by `benchMarksEnabled()`; Echoes keeps
a bounded ring of its recompute times for the bench to read.

```bash
pnpm bench:plugins                                 # both engines, chromium first
pnpm bench:plugins --engine chromium               # the web build only
pnpm bench:plugins --engine webkitgtk --samples 10 # the native Linux lane
pnpm bench:plugins --headless                      # Chromium without a window
pnpm bench:plugins --engine chromium --reuse-build # serve the last build
```

Each engine writes `.bench/plugins-<engine>.json` (the WebKitGTK report's own
`engine` field is `webkit`). The command exits 0 when every budget holds, 1 when
a budget is missed, and 2 when it could not measure (no display, no web build,
no Linux binary, a harness failure). A missing prerequisite is an `unmeasured`
reason rather than a crash, and it takes precedence over a miss, so an
incomplete run never reads as a pass or a fail. Re-check a saved report without
rerunning:

```bash
node scripts/plugins-bench-budget.mjs .bench/plugins-chromium.json
```

## Reader performance lane

`pnpm bench:reader` checks that Reader (`plugins/maibuk-reader/`, issue #653)
costs the app nothing it can measure, and that reading does not stall it. It
sits beside the other periodic lanes (`bench:frames`, `bench:plugins`): run it
before a release and whenever Reader's loaders, its Frame, or its Worker
bridge move. It never runs in CI. Every gate is relative to the same build with
Reader disabled or unused, so the numbers are deltas and ratios.

The gates (`scripts/reader-bench-budget.mjs`):

1. **Idle start-up and heap.** Reader disabled against enabled-never-opened,
   measured the way `bench:plugin-start` and the Plugins bench measure: two
   warm-up starts thrown away, then 20 samples (`--samples`). A start runs from the page load to the Books nav (and the
   Reader nav too when enabled, so the launch scan is inside it). The heap is
   read after a forced GC on that page. The gate is that the median delta is
   within `max(5% of the disabled median, 20 ms)` for start-up and
   `max(5%, 1 MiB)` for the heap, the noise rule the Plugins bench uses.
2. **No jank.** No Reader long task over 50 ms while opening, turning 20
   pages, and searching a 50 MB PDF and a 320-section EPUB. The bench installs
   `PerformanceObserver('longtask')` in the top frame before any app code
   (`addInitScript`). Attribution: an entry whose attribution names an
   `iframe` container is the Reader Frame's work, because the bench checks
   the page has exactly one iframe while a Document is open; an entry
   attributed to the host window that overlaps one of the bench's action
   windows is the host's Reader code (the broker, the Shelf, the port bridge,
   which the bench does nothing else during); any other host task is reported
   and not gated. A Worker's work never appears as a long task, which is the
   point of the Worker. The raw entries are kept in the report.
3. **Memory returns.** The JS heap 30 s after leaving Reader is at most 110% of
   the heap before opening. The heap is read after a forced GC through the
   page's CDP session (`HeapProfiler.collectGarbage`, `Runtime.getHeapUsage`),
   so Chromium only.
4. **Editor untouched.** The editor typing scenario of `bench:frames` runs
   once before the reading session and once after it. The gate is the
   after-run's own frame budget verdict; the before-run is printed beside it.

Recorded, not gated: the start-up to the Books nav alone, disabled and enabled,
so a start-up failure says whether the time is Reader's launch scan (the Reader
nav appears only after it) or the app's own first paint. Then the first page (Enter to the Frame's page indicator
showing page 1) and the page turn (key press to the indicator changing,
nearest-rank median and p95). Both include the Playwright round trip, so
they measure what a reader feels, not the Frame alone.

The fixtures are generated at bench time by the same generators as the
committed fixtures (`plugins/maibuk-reader/scripts/generate-fixtures.mjs`,
`buildLargePdf`, `buildLargeEpub`) into a temporary folder that is removed
after the run. Nothing large is committed. The PDF is 96 pages with an
uncompressed 420x420 RGB image each (51 MB); the EPUB has 320 sections. The
file picker double serves the PDF by route (`served: true` in
`e2e/support/file-picker.ts`), so its bytes never become a base64 decode on
the main thread.

```bash
pnpm bench:reader                  # Chromium's headless mode, the full lane (default)
pnpm bench:reader --headed         # a headed window; keyboard focus can stall in it
pnpm bench:reader --reuse-build    # serve the last E2E build (run build:plugins first)
pnpm bench:reader --samples 40     # more start-up samples (default 20)
pnpm bench:reader --spike          # the threading spike (below), not the gates
```

The lane runs headless by default, the same as the E2E suite whose reader
spec it reuses: in a headed window the Tab key stopped reaching the Frame
during the document run, so headed numbers would measure the window manager,
not Reader.

It writes `.bench/reader.json` (the report) and prints the gate and trace
tables. The command exits 0 when every gate holds, 1 when a gate fails, and 2
when a measurement could not be taken (a missing prerequisite, a harness
failure, a Playwright failure). Re-check a saved report without rerunning:

```bash
node scripts/reader-bench-budget.mjs .bench/reader.json
```

**Threading spike.** `pnpm bench:reader --spike` parses the same 50 MB PDF
twice: once with pdf.js core inline in the Plugin Worker (the flag
`__maibukDebugPdfCoreInline` is set in the Plugin Worker by the bench, never by
the app) and once in the nested Worker that ships. It samples how late a 5 ms
timer in the Plugin Worker runs during the open, and writes
`.bench/reader-spike.json`. The results are recorded in
`plugins/maibuk-reader/vendor/README.md` under "Threading spike".

## MCP Server Agent eval

`pnpm eval:mcp` checks that a real Agent can use the MCP Server Built-in Plugin
(`plugins/maibuk-mcp/`, issue #595). For each of seven tasks it runs one headless
Claude Code session against a fixture Library, then reads the Library back and
judges the result. It costs money, because every task is a real model session
(about $0.01 to $0.10 per task on `sonnet`). It never runs in CI. Run it before
a release and whenever a tool's shape, its description, or the server
instructions change.

**What runs.** The real MCP Server Plugin runs on the Plugin test kit
(`createTestHost`, which uses the real broker and method table over an
in-memory Library), loaded through Vite SSR. A real HTTP listener on
`127.0.0.1` sits in front of its Plugin Endpoint at `/plugin/maibuk-mcp/mcp`.
Claude Code connects to it with the same server name, URL, and Bearer Key as
the Claude Code snippet the Plugin page shows. Each task gets a fresh copy of
the fixture and an empty working folder. Claude Code runs with `--tools ""`
(no built-in tools, so the Agent can reach the Library only through MCP),
`--strict-mcp-config`, and `--no-session-persistence`. The runner refuses to
start when `CI` is set. The fakes are the
in-memory Library and the listener: the app's Rust listener (Origin, Host, and
port checks) is covered by its own tests.

| Task | Prompt asks for | The Library must show afterwards | Budget |
| --- | --- | --- | --- |
| 1 | The Note tagged `keeper`, read it | Nothing changed; the tagged Note was read, not the decoy whose title says keeper; the answer names Ottilie Marsh and 31 years | 3,014 |
| 2 | Append a scene to "Storm" | The old HTML kept byte for byte, then the two scene paragraphs; no whole replace; one Checkpoint | 3,114 |
| 3 | Fix the one typo in "Arrival" | The HTML equals the original with that one word fixed, formatting intact; `edit_chapter`, never `write_chapter` | 3,414 |
| 4 | Create "Interlude", then move it after "Arrival" | The Chapter exists with its text, and the order is Arrival, Interlude, Storm, The Lamp Room, Epilogue | 3,114 |
| 5 | Replace "The Lamp Room" whole while the author types | The stale replace was refused, then the Chapter was re-read and written (a whole replace or edits); the new version and the author's typed paragraph are both in the Chapter | 3,314 |
| 6 | Rename a Book in read-only mode | Only the six read tools were offered; nothing changed; the answer says it cannot write | 1,429 |
| 7 | Find the passage "bell on the reef" with search, then read it | Nothing changed; `search_library` ran before `read_chapter` of "Arrival"; the answer quotes "There was no bell on the reef." | 3,314 |

In task 5 the author's typing is simulated. Right after the Agent's first
read of the Chapter, the eval records unsaved editor text
(`setPendingEdit`), and the next write flushes it, the same way the app's
pending-edits flush does. Each task also checks that no other Chapter
changed.

**Budgets** are MCP tokens: what the MCP Server puts in the model's context,
counted from the wire as characters over four. That is the same proxy
`docs/research/mcp-server-token-efficiency.md` uses for definitions. The
tool definitions and the server instructions count once per session; every
call's arguments and result count every time. A task passes when every check
holds and its MCP tokens stay within its budget. Each budget is the fixed cost,
plus the expected path, plus room for one orienting or repeated call:

- The fixed cost is 2,514 (2,394 for the 13 tool definitions, 120 for the
  instructions), or 979 in read-only mode.
- On this fixture, `list_books` costs about 30, `get_book` about 100, a
  tag-filtered `list_notes` about 27, `read_note` about 96, a 204-word
  `read_chapter` about 315, a two-hit `search_library` about 85, and a write's
  answer about 25.

The reasoning for each task sits beside its number in
`src/test/support/mcp-eval/tasks.ts`. The budgets were fixed before the first
paid run.

These numbers count what the server sends, not the Agent's whole bill. The
report also prints Claude Code's own session tokens (input, cache writes, cache
reads, and output, summed over every turn) and the cost. That figure is mostly
Claude Code's base prompt, about 17,000 tokens per turn, so it measures the
client more than the server.

**Proven without a paid run.** `src/test/integration/mcp-eval-tasks.test.ts`
drives the same harness with a scripted Agent and runs in CI:

- For each task, the expected path passes every check within its budget.
- A plausible wrong path fails the check meant to catch it. Examples: reading
  the decoy Note, a whole replace for a typo, dropping the author's paragraph.
- The fixed cost equals what the server sends, so a change to the definitions
  or the instructions fails until the budgets are re-derived.

The counting, parsing, and report rules have unit tests in
`src/test/unit/support/mcp-eval-report.test.ts`.

**Prerequisites.** Claude Code (`claude`) must be on `PATH` and logged in. The
eval runs on that login. It does not use `--bare`, which reads only
`ANTHROPIC_API_KEY`.

```bash
pnpm eval:mcp                      # all seven tasks on sonnet
pnpm eval:mcp --task 3,5           # some tasks
pnpm eval:mcp --model opus         # another model
pnpm eval:mcp --help               # every option
```

It prints one row per task (PASS or FAIL, MCP tokens, budget, session tokens,
turns, and cost), then each failed check with what was found. It writes
`.bench/mcp-eval.json`, plus one wire log per task in `.bench/mcp-eval/`
(every JSON-RPC exchange, the tool calls, and the Library before and after).
Exit codes: 0 means every task passed, 1 means a task failed, and 2 means a
task could not be measured (no `claude`, a crash, or a timeout).

A model can fail a task in a way that is not a server problem. Read the wire log
before you change a tool: a failed check tells you what the Agent did, not
why.

## Output

Everything generated lands in `e2e/.output/` (gitignored): the web build,
seeds, `test-results/` (screenshot on failure, trace kept for the first failure
of a test), and the HTML report. The `@sandbox` lane's Node-side pass rule —
"the local server logged zero requests" — reads `request-log-<port>.jsonl`, the
per-run log of the recording server `support/request-log.ts` starts on a free
port at global setup (harmless in the Sync lane, which never targets it).

```bash
pnpm exec playwright show-report e2e/.output/report
pnpm exec playwright show-trace e2e/.output/test-results/<test>/trace.zip
```

`test.fail()` and `--repeat-each` do not change this: a passing test writes no
trace, so only the failing `<test>` directory has one. Open the HTML report in a
browser if the terminal cannot render it; it links every trace.

## Screenshots for a PR

A PR that changes what the app renders shows it (`CODING_STANDARDS.md`, "Keyboard and accessibility", item 9).
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

## Settings scrolling regression gate

Settings results in the Command Palette reveal their row after initial loading
above it finishes. Backups can grow after Settings mounts, and native WebKit does
not preserve the target through that growth. The integration gate holds a Backup
read unresolved past ten animation frames and verifies the request remains
pending; success and failure release it, while an earlier Appearance row does
not wait. The palette browser gate also starts Dictation navigation inside a Note.

The outline clips animated entry/ghost overflow. In shorter windows, expanded
rows genuinely exceed the available height; an always-present scrollbar reserves
the same width in fitting and overflowing states. Separate browser gates sample
painted frames at 800px and 600px heights, proving the main scroller moved and
that legitimate overflow does not shift the outline sideways. Settled screenshots
alone cannot detect these changes.

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

**WebKit has OPFS only in a persistent context.** In Playwright's default
ephemeral context, WebKit treats the session as private browsing and
`navigator.storage.getDirectory()` throws `UnknownError`, as in a Safari
Private window ([#479](https://github.com/M4ss1ck/maibuk/issues/479)). So on
the `webkit` project a test that seeds Plugins (`plugins` or
`unapprovedPlugins`), or installs one with none seeded
(`usesPluginDirectory: true`), runs in a persistent context on a fresh temporary profile
(`needsPersistentContext` in `support/storage.ts`, wired in `support/test.ts`);
every other test keeps the default context. A spec that builds its own context
(`browser.newContext()`) gets no OPFS on WebKit.
