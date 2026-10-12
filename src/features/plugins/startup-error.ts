/**
 * The value stored in `approval.startupError` for a failed activation (#442).
 * A refusal that carries its own message (a Worker error, a health-check
 * failure, a data-version or migration failure) stores that message; every
 * other refusal stores its stable code, which the Settings row localizes. A
 * copy that changed (review-required) or an id the lifecycle never installed is
 * a review state, not a startup failure, so it stores nothing.
 */

import type { PluginActivationRefusal } from "@/features/plugins/types";

export function startupErrorValue(refusal: PluginActivationRefusal): string | null {
  if (refusal.code === "review-required" || refusal.code === "not-installed") return null;
  if ("message" in refusal && typeof refusal.message === "string" && refusal.message.length > 0) {
    return refusal.message;
  }
  return refusal.code;
}
