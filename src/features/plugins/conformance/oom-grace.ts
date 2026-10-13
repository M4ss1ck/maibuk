/**
 * T8's settle grace (#447). The yielding allocation's broker request settles
 * when the Worker stops answering — its memory death rejects the in-flight
 * request — but the lifecycle records the stop reason a moment later, through
 * its own worker-error path. Reading the settle flag alone therefore races the
 * lifecycle and can call a real memory death `stopped: false` (unmeasured).
 *
 * This module waits a bounded grace for the reason before giving up, so the
 * race cannot hide a genuine memory stop. `now` and `sleep` are injected, so the
 * wait is tested without real time.
 */

/** Poll cadence inside the grace window, matching the seam's own polling. */
export const OOM_GRACE_POLL_MS = 50;

/**
 * Polls `readReason` until it returns a reason or `graceMs` elapses. Returns the
 * reason when one arrived — including on the poll that reaches the deadline —
 * and null when none ever did.
 */
export async function waitForReasonWithinGrace(options: {
  /** The lifecycle's stop reason, or null while it has recorded none. */
  readReason: () => string | null;
  /** The bounded wait, e.g. twice the lifecycle heartbeat interval. */
  graceMs: number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** Poll cadence; defaults to {@link OOM_GRACE_POLL_MS}. */
  pollMs?: number;
}): Promise<string | null> {
  const { readReason, graceMs, now, sleep, pollMs = OOM_GRACE_POLL_MS } = options;
  const deadline = now() + graceMs;
  for (;;) {
    const reason = readReason();
    if (reason !== null) return reason;
    if (now() >= deadline) return null;
    await sleep(pollMs);
  }
}
