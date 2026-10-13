// The conformance lane's wait policy (#447, D5). Pure, so the runner's stop
// rules — `/done`, the app dying, the first-contact timeout, the overall
// deadline — are tested without starting a collector, building, or launching
// anything. `e2e/conformance/run-plugins.ts` drives the poll loop with
// `waitOutcome` and reads the app's log tail with `lastLogLines`.

/**
 * How long the lane waits for the app to make *any* request at all (#447, D5).
 * A run that has not contacted the collector by then is not slow, it is broken
 * (a build gate, a route that never renders, a blocked fetch), so the lane
 * refuses in 90 s instead of waiting out the whole `/done` budget.
 */
export const FIRST_CONTACT_TIMEOUT_MS = 90_000;

/** Why a wait ended (or that it should keep going). */
export type WaitOutcome =
  | { kind: "done" }
  | { kind: "process-died" }
  | { kind: "first-contact-timeout" }
  | { kind: "deadline" }
  | { kind: "continue" };

export interface WaitInput {
  /** Milliseconds since the app was launched. */
  elapsedMs: number;
  /** How long to wait for `/done` at all. */
  deadlineMs: number;
  /** How long to wait for the very first request from the app. */
  firstContactMs: number;
  /** `/done` arrived. */
  done: boolean;
  /** The app process is still alive. */
  alive: boolean;
  /** Requests the collector has received this run (any request, leaks included). */
  requests: number;
}

/**
 * The one-stop wait rule. `/done` and a dead process win immediately. Before any
 * request, the first-contact timeout applies once `firstContactMs` passed; once
 * the app has contacted the collector, only the overall deadline applies.
 */
export function waitOutcome(input: WaitInput): WaitOutcome {
  if (input.done) return { kind: "done" };
  if (!input.alive) return { kind: "process-died" };
  if (input.requests === 0 && input.elapsedMs >= input.firstContactMs) {
    return { kind: "first-contact-timeout" };
  }
  if (input.elapsedMs >= input.deadlineMs) return { kind: "deadline" };
  return { kind: "continue" };
}

/**
 * The last `count` non-empty lines of a captured log, joined with newlines. Used
 * to surface an app's stderr when no `/done` arrives, so the next failure is
 * diagnosable from the lane's own output.
 */
export function lastLogLines(text: string, count: number): string {
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  return lines.slice(Math.max(0, lines.length - count)).join("\n");
}
