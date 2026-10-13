/**
 * The stop-reason copy keys (#443). `requested` and `idle` are normal
 * lifecycle events and stay silent. Kept in this leaf module, with no imports,
 * so Settings can read the reason-to-key map without loading the lifecycle's
 * heavy graph (`entry-chunk.test.ts`); `lifecycle.ts` re-exports it, so its
 * public API is unchanged.
 */

export const PLUGIN_STOP_MESSAGE_KEYS = {
  "startup-timeout": "plugins.stopped.startupTimeout",
  unresponsive: "plugins.stopped.unresponsive",
  throttled: "plugins.stopped.throttled",
  "remote-ui-limit": "plugins.stopped.remoteUiLimit",
  "out-of-memory": "plugins.stopped.outOfMemory",
  crashed: "plugins.stopped.crashed",
} as const;

/** The stop reasons that have copy to show; `requested` and `idle` do not. */
export type PluginStopMessageReason = keyof typeof PLUGIN_STOP_MESSAGE_KEYS;

/** One localized stop-message key. */
export type PluginStopMessageKey = (typeof PLUGIN_STOP_MESSAGE_KEYS)[PluginStopMessageReason];

/** True when a stop reason has copy to show; `requested` and `idle` do not. */
export function hasStopMessage(reason: string): reason is PluginStopMessageReason {
  return reason in PLUGIN_STOP_MESSAGE_KEYS;
}

/** The i18n key for a stop reason, or null for a silent stop. */
export function pluginStopMessageKey(reason: string): PluginStopMessageKey | null {
  return hasStopMessage(reason) ? PLUGIN_STOP_MESSAGE_KEYS[reason] : null;
}
