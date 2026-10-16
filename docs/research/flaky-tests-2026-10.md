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

About 90 fixed waits in 31 files sit in the baseline. None failed under load in the full round, but each is a guess. Remove them file by file, lowering the baseline, and prove each file with `pnpm test:stress <file> --rounds 5`. The largest are `deep-link/bridge.test.ts` (25), `tutorial-library.test.ts` (7), `navigating-commands.test.tsx` and `LinkPreviewLayer.test.tsx` (5 each).
