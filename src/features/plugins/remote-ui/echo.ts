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
 * sent before it. Values the host sent that are no longer pending are still
 * recognized as echoes, so a delayed or out-of-order echo never rolls the field
 * back. A value the host never sent (a programmatic reset, a fill) resets the
 * tracking and is applied.
 */

/** How many host-sent values are remembered after they stop being pending. */
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
        return false;
      }
      // A delayed or out-of-order echo of an already-superseded value must not
      // roll the field back. It is not applied.
      if (history.includes(remote)) return false;
      // The host never sent this value: the Plugin replaced the text. The
      // history stays, so a stale echo of an earlier host value still cannot
      // resurrect the text the reset replaced.
      pending = [];
      return true;
    },
    reset() {
      pending = [];
      history = [];
    },
  };
}
