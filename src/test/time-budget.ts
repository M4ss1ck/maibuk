// The suite's one time budget (docs/research/ci-549-vs-548.md).
//
// A hosted CI runner is about 2x slower than a laptop under coverage, and the
// same shard varies up to 1.9x between runs. Vitest's 5 s default and a pile of
// per-file raises left tests at 80-100% of their limit, so CI went red at
// random. A timeout exists to stop a hung test, not to measure speed: it gets
// one generous value, a test may not pick its own, and slowness is reported by
// the time budget reporter instead of failing the run.

/** Stops hung tests; sized against CI measurements. Long sweeps are split;
 * the Tutorial run has the exception below. */
export const TEST_TIMEOUT_MS = 60_000;

/** `waitFor` / `findBy*`. They return as soon as the condition holds, so a long
 * limit only costs time when the test is failing anyway. */
export const ASYNC_UTIL_TIMEOUT_MS = 10_000;

/** A test past this share of its timeout is reported as running out of room. */
export const TIME_BUDGET_HEADROOM = 0.5;

/** Test files allowed a longer timeout than TEST_TIMEOUT_MS, and why. The setup
 * file fails any test whose timeout is neither the default nor listed here. */
export const TIMEOUT_EXCEPTIONS: Readonly<Record<string, { timeoutMs: number; reason: string }>> = {
  "src/test/integration/tutorial-app.test.tsx": {
    timeoutMs: 120_000,
    reason:
      "the first-launch run walks every Tutorial step to Finish in one test: 35 s on CI, so 60 s leaves no 2x margin",
  },
};

/** The timeout a test in `file` (repo-relative) may run with. */
export function allowedTimeouts(file: string): number[] {
  const exception = TIMEOUT_EXCEPTIONS[file.replace(/\\/g, "/")];
  return exception ? [TEST_TIMEOUT_MS, exception.timeoutMs] : [TEST_TIMEOUT_MS];
}
