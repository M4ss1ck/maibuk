// The suite's test timeout, kept here so vite.config.ts can read it without
// pulling `src/` into tsconfig.node.json, the same reason as dev-server.mjs.
// src/test/time-budget.ts re-exports it beside the rest of the time budget
// and explains the value.

/** Stops hung tests; sized against CI measurements. Long sweeps are split;
 * the Tutorial run has the exception in src/test/time-budget.ts. */
export const TEST_TIMEOUT_MS = 60_000;
