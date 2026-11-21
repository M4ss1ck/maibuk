# Flaky CI, October 2026: races, not the time budget

Date: 2026-10-16. Scope: failed runs of workflow "CI" from 2026-10-14 to 2026-10-16, after the one-budget change of `docs/research/ci-549-vs-548.md`.

## TL;DR

None of the failures was a timeout. Each one was an assertion that ran before the async work it checked had landed: a MessagePort delivery awaited with one `setTimeout(0)`, a route read right after waiting for something else, or a refusal awaited with a fixed number of timer passes. On an idle machine the guess holds. On a hosted runner it fails at random. Raising timeouts cannot fix this, because nothing is waiting long enough to time out.

All of them reproduce locally with every core busy (`pnpm test:stress`). The fix is to wait for the asserted condition. A guard keeps new fixed waits out.

## Failures read

| Run | Test | Cause |
|---|---|---|
| [38922380389](https://github.com/M4ss1ck/maibuk/actions/runs/38922380389) (main) | `plugin-frame-port.test.ts` > delivers {id, src, port} | One `setTimeout(0)` for a MessagePort delivery |
| [38918513269](https://github.com/M4ss1ck/maibuk/actions/runs/38918513269) | `lifecycle.test.tsx` > refuses a newer Plugin API | One `advance(0)` before a real-loop hash; fixed in ae99b00 |
| [38809074053](https://github.com/M4ss1ck/maibuk/actions/runs/38809074053) (main) | `command-runner.test.tsx` > navigating Command | Waited for the dialog to leave, read the route before its render |
| 38809074053, [38834800306](https://github.com/M4ss1ck/maibuk/actions/runs/38834800306) | `maibuk-echoes/report-page.test.tsx` | Row from the Remote UI round trip; fixed in 7d082b7 |
| [38673577238](https://github.com/M4ss1ck/maibuk/actions/runs/38673577238) (main) | `PluginsSettings.test.tsx` > reveals a row | Reveal before the Plugin row's control mounted; fixed in 139977e |

Every run finished its shard in 4 to 7 minutes, far inside the 60 s per-test timeout. The time budget reporter listed none of these tests.

## Reproduction

`pnpm test:stress` runs Vitest with one busy-loop process per core. Before the fixes, `plugin-frame-port` and `command-runner` failed in 4 of 6 rounds on a 4-core container. After them, those files plus `lifecycle`, `report-page`, `PluginsSettings` and `BackupSection` passed 5 of 5 rounds.

A full-suite round under load (8420 tests, 28 minutes) found one more failure: `BackupSection` > formats dates in the app language. It is not a race. Node 22's ICU writes the Spanish "a. m." with a no-break space; the text matcher collapses the page's whitespace but not the expected string. It fails on every Node 22 machine and passes on CI's Node 24. The test now collapses both sides.

## Changes

- The racing tests wait for what they assert (`vi.waitFor`, `findBy*`). A "never called" check first waits for a later event on the same port.
- `vi.waitFor` and `vi.waitUntil` default to the suite's 10 s wait limit instead of 1 s (`src/test/setup.ts`).
- `src/test/unit/test-fixed-waits.test.ts` fails on a new `setTimeout(resolve, n)` sleep in a test or test support file. The per-file baseline in `src/test/time-budget.ts` only shrinks.
- `pnpm test:stress` (`scripts/test-stress.mjs`) is the lane that proves a race fix.

## What is left

Issue #511 removed the fixed waits that were left: about 90 lines in 31 files. Each file passed `pnpm test:stress <file> --rounds 5`. `FIXED_WAIT_BASELINE` now holds one entry, `src/test/support/frames/probe.ts` (1). That wait runs in a real browser for the frame lane. The browser queues Long Animation Frame entries on its own schedule and fires no completion event, and `takeRecords()` after one frame came back empty in headless Chromium. The comment above the line gives the reason.

The guard does not catch every disguised wait: a helper that counts microtasks or animation frames passes it. #511 also removed the ones it found (`flushRuns()` in `dictation/session.test.ts`, frame counting in `PluginsSettings.test.tsx`). Watch for that shape in review.

## November 2026: stale matches (#893)

Run 44915068955 on `main` failed one test, `plugins/maibuk-mcp/connect-page.test.tsx` "copies each exact text with the keyboard", after 258 ms, far inside the 10 s find limit. The test copies four snippets in a loop and, after each, ran `expect(await screen.findByText("Copied")).toBeInTheDocument()`. The previous snippet's "Copied" status stays mounted for `COPIED_MS` (2 s), so the page-wide find matched that stale node at once. When the Plugin's copy reply crossed the MessagePort in the next turn, `setCopied` moved the status to the new row, the stale node detached, and the presence check failed. On an idle machine the reply lands later and the test passes without checking the row it copied. This is a different class from October's: the wait was real, but it waited for the wrong element.

Changes:

- The test waits for "Copied" inside the copied snippet's own row, then checks it shows on one row only.
- The `expect(await …findBy*(…)).toBeInTheDocument()` wrapper is gone from the suite (about 220 sites in 79 files). A resolved find already proves presence; the wrapper only adds the detached-node window. `src/test/unit/test-find-then-assert.test.ts` fails on a new one, with no baseline.
- A read of every loop and repeated step that pairs an action with a page-wide query found one more assertion that passed before its action: `Canvas.editSession.test.tsx` "viewport moves are not content and never save" read the "saved" label, which reads "saved" before the move. It now asserts no save was attempted.
- `CODING_STANDARDS.md` "An assertion after an action must fail if the action did nothing" states the rule.

The guard catches the wrapper, not the stale match itself, which needs a reader: a query for text an earlier step left on screen passes no lint. Watch for it in review, mainly in loops and around status, toast and "Saved" text.
