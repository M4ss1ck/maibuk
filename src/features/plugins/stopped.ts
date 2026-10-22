/**
 * The Stopped Plugin read (#618): whether an enabled Plugin stopped on a limit
 * or was refused when it tried to start, and why. It is derived, never stored:
 * the lifecycle's state for this session, its launch-scan refusals, and the
 * `startupError` a refusal left on the approval record. The sidebar entry, the
 * Plugin page, and the Settings row all read it, so they never disagree.
 *
 * Kept a leaf (approvals, the stop-message keys, types) so the sidebar in the
 * entry chunk can read it without the lifecycle's heavy graph.
 */

import { getPluginApproval } from "@/features/plugins/approvals";
import { startupErrorValue } from "@/features/plugins/startup-error";
import { hasStopMessage } from "@/features/plugins/stop-messages";
import type { PluginLifecycle, StoppedPlugin } from "@/features/plugins/types";

export type { StoppedPlugin, StoppedPluginReason } from "@/features/plugins/types";

/**
 * Refusals a retry cannot fix: the author updates, replaces, or removes the
 * Plugin in Settings instead, so its surfaces offer Review in Settings.
 */
const SETTINGS_ONLY_REFUSALS = new Set(["data-newer", "incompatible", "manifest-invalid"]);

/** A refusal with the action that can fix it. */
function refused(startupError: string): StoppedPlugin {
  return {
    reason: { kind: "refusal", startupError },
    action: SETTINGS_ONLY_REFUSALS.has(startupError) ? "review" : "tryAgain",
  };
}

/** The Stopped Plugin read for one id, or null when the Plugin is not a Stopped Plugin. */
export function readStoppedPlugin(
  lifecycle: PluginLifecycle | null,
  pluginId: string
): StoppedPlugin | null {
  if (lifecycle === null) return null;
  // A disabled or removed Plugin is never marked, whatever it last did.
  const approval = getPluginApproval(pluginId);
  if (!approval?.enabled) return null;
  const state = lifecycle.state(pluginId);
  if (state === null) {
    // No entry: the launch scan refused it, or it is not for this device. With
    // no entry there is nothing to start, so only Settings can fix it.
    const refusal = lifecycle.launchRefusal(pluginId);
    return refusal === null ? null : { ...refused(refusal.code), action: "review" };
  }
  if (state.status !== "stopped") return null;
  if (state.reason !== null) {
    // `requested` and `idle` are normal stops and have no copy.
    return hasStopMessage(state.reason)
      ? { reason: { kind: "limit", reason: state.reason }, action: "tryAgain" }
      : null;
  }
  if (state.refusal !== null) {
    if (state.refusal.code === "review-required") {
      return { reason: { kind: "review" }, action: "review" };
    }
    const startupError = startupErrorValue(state.refusal);
    return startupError === null ? null : refused(startupError);
  }
  // Not run yet this session: a refusal a previous start recorded recurs until
  // the Plugin next starts cleanly. A startup that ran out of time is a limit
  // stop, which never outlives its session.
  return approval.startupError === undefined || approval.startupError === "startup-timeout"
    ? null
    : refused(approval.startupError);
}
