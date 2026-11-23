/**
 * Reports a running Plugin's activity to the Android bridge, throttled to one
 * report per Plugin per second (#926).
 *
 * Android keeps each Plugin's last activity so the death record written when
 * the WebView renderer dies names the Plugins that were active. Desktop and
 * web have no bridge, so this is a no-op there.
 */

/** A Plugin reports at most once per second: each report crosses the JS bridge. */
export const PLUGIN_ACTIVITY_THROTTLE_MS = 1_000;

/** Android's bridge to the Plugin death record (added in Kotlin, #926). */
interface PluginActivityBridge {
  report(pluginId: string, version: string, at: number): void;
}

/** MainActivity's `window.MaibukPluginActivity`, absent off Android. */
function androidActivityBridge(): PluginActivityBridge | undefined {
  return (globalThis.window as { MaibukPluginActivity?: PluginActivityBridge } | undefined)
    ?.MaibukPluginActivity;
}

export function createPluginActivityReporter(
  options: {
    /** Resolves the bridge on each report; absent off Android. */
    bridge?: () => PluginActivityBridge | undefined;
    /** The clock; injected by tests. */
    now?: () => number;
  } = {}
): (pluginId: string, version: string) => void {
  const bridge = options.bridge ?? androidActivityBridge;
  const now = options.now ?? Date.now;
  // The last sent time per Plugin: a Plugin's own ticks keep it under the cap.
  const lastSent = new Map<string, number>();
  return (pluginId, version) => {
    const activity = bridge();
    if (!activity) return;
    const at = now();
    const last = lastSent.get(pluginId);
    if (last !== undefined && at - last < PLUGIN_ACTIVITY_THROTTLE_MS) return;
    lastSent.set(pluginId, at);
    try {
      activity.report(pluginId, version, at);
    } catch {
      // A bridge that throws must never break the Plugin call path.
    }
  };
}

/** The reporter the runtime uses; no-op off Android. */
export const reportPluginActivity = createPluginActivityReporter();
