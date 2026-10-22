/**
 * The Settings row's text for a stored `startupError` (#442). The record holds
 * the refusal's own message when it had one, or a stable code otherwise; a code
 * is shown as localized copy, and a code with no authored copy falls back to a
 * generic sentence. A refusal's own message is shown as it is.
 */

import { PLUGIN_STOP_MESSAGE_KEYS } from "@/features/plugins/stop-messages";
import type { StoppedPluginReason } from "@/features/plugins/stopped";

/** A translation function narrowed to the keys this module uses. */
export type StartupErrorTranslate = (key: string, options?: Record<string, unknown>) => string;

/** The i18n suffix of a refusal code's copy, keyed by code. */
const STARTUP_ERROR_KEYS: Record<string, string> = {
  incompatible: "incompatible",
  "manifest-invalid": "manifestInvalid",
  "module-refused": "moduleRefused",
  "hash-mismatch": "hashMismatch",
  "startup-timeout": "startupTimeout",
  "data-newer": "dataNewer",
};

/** Every refusal code that can be stored as a `startupError` code. */
const STARTUP_ERROR_CODES = new Set([
  ...Object.keys(STARTUP_ERROR_KEYS),
  "hash-refused",
  "worker-error",
  "health-check-failed",
  "migration-failed",
  "data-version-unavailable",
]);

/** The row text for a stored startup error: localized code copy, else the message. */
export function pluginStartupErrorText(value: string, t: StartupErrorTranslate): string {
  const suffix = STARTUP_ERROR_KEYS[value];
  if (suffix !== undefined) return t(`plugins.startupError.${suffix}`);
  // A message is shown as it is; a code with no copy falls back to the generic.
  return STARTUP_ERROR_CODES.has(value) ? t("plugins.startupError.generic") : value;
}

/**
 * The reason a Stopped Plugin shows on its page, its sidebar entry, and its
 * Settings row (#618), from the stop-message and startup-error copy.
 */
export function pluginStoppedReasonText(
  reason: StoppedPluginReason,
  name: string,
  t: StartupErrorTranslate
): string {
  if (reason.kind === "limit") return t(PLUGIN_STOP_MESSAGE_KEYS[reason.reason], { name });
  if (reason.kind === "review") return t("plugins.startupError.hashMismatch");
  return pluginStartupErrorText(reason.startupError, t);
}
