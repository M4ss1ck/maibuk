/**
 * The in-flight echo rule for host-owned text inputs (ADR 0021, the WebKitGTK
 * and Android verification of #391).
 *
 * A host text field keeps its own live value and notifies the Plugin on every
 * keystroke. The Plugin answers by echoing the value back as a remote prop, so
 * a naive "apply the remote value" loses text under burst typing: the host
 * reverts to a stale value before the echo arrives.
 *
 * The rule: the host records every value it sends. An incoming remote value is
 * applied only when the host never sent it; an echo drops itself and everything
 * sent before it. A value the host never sent (a programmatic reset, a fill)
 * resets the tracking and is applied.
 *
 * Why the history can be dropped once `pending` empties: the Remote DOM channel
 * is FIFO, so the echo of the newest sent value is the last echo the Plugin can
 * still deliver. When it arrives, no older echo remains in flight, and any
 * later remote value is a real programmatic change — a stale "abc" can no
 * longer resurrect text a Clear replaced. Keeping history across that point
 * would make a programmatic reset to a value the host ever sent a no-op.
 */

/** How many host-sent values are remembered while echoes are still pending. */
export const ECHO_HISTORY_LIMIT = 200;

export interface PluginEchoTracker {
  /** Records a value the host just sent to the Plugin. */
  sent(value: string): void;
  /** Whether an incoming remote value should replace the host's live value. */
  shouldApply(remote: string): boolean;
  /** Drops all tracking, so the next remote value is treated as external. */
  reset(): void;
}

export function createEchoTracker(historyLimit = ECHO_HISTORY_LIMIT): PluginEchoTracker {
  let pending: string[] = [];
  let history: string[] = [];

  function remember(value: string): void {
    history.push(value);
    if (history.length > historyLimit) history = history.slice(history.length - historyLimit);
  }

  return {
    sent(value) {
      pending.push(value);
      remember(value);
    },
    shouldApply(remote) {
      // An echo of a value still in flight drops itself and everything sent
      // before it: those values are superseded by this (older or newer) echo.
      const index = pending.lastIndexOf(remote);
      if (index !== -1) {
        pending = pending.slice(index + 1);
        // FIFO: the echo of the newest sent value leaves nothing in flight, so
        // the history stops being useful and is dropped. From here a remote
        // value is a real programmatic change.
        if (pending.length === 0) history = [];
        return false;
      }
      // A delayed echo of an already-superseded value must not roll the field
      // back. It is not applied while anything is still in flight.
      if (pending.length > 0 && history.includes(remote)) return false;
      // Nothing is pending: the Plugin replaced the text (a reset, a fill).
      pending = [];
      history = [];
      return true;
    },
    reset() {
      pending = [];
      history = [];
    },
  };
}
