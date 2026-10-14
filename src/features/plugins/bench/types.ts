/**
 * The Plugins bench driver's seed shape (issue #448).
 *
 * The runner writes one of these into the app data dir before it launches the
 * app; the gated driver (`VITE_PLUGIN_BENCH_DRIVER=1`) reads it, seeds the
 * approvals, and measures the mode it names. Nothing here reaches a shipped
 * build: the driver that reads it is dynamically imported only under the flag.
 */

import type { PluginApproval } from "@/features/plugins/types";

/** The measurement one launch produces. */
export type PluginsBenchMode =
  | "launch"
  | "startToReady"
  | "commandToEffect"
  | "remoteUiEcho"
  | "remoteUiBurst";

/** The on-demand surface `startToReady` opens to warm-start its Plugin. */
export interface PluginsBenchStartTarget {
  pluginId: string;
  pageId: string;
}

/** The one seed file a launch reads. */
export interface PluginsBenchSeed {
  mode: PluginsBenchMode;
  /** Samples the mode produces this launch. */
  samples: number;
  /** The runner's collector base URL, e.g. `http://127.0.0.1:54321`. */
  collectorUrl: string;
  /** The approval records to write into the device before the Plugin scan. */
  approvals: PluginApproval[];
  /** `startToReady` only: the surface to open. */
  startToReady?: PluginsBenchStartTarget;
  /** `remoteUiEcho`/`remoteUiBurst` only: the characters to type. */
  echoText?: string;
  /**
   * `commandToEffect` only: the `stamp` Shortcut chord as its manifest declares
   * it (e.g. `"Mod+Alt+e"`). The driver maps `Mod` to the host's Mod key.
   */
  stampShortcut?: string;
}

function isMode(value: unknown): value is PluginsBenchMode {
  return (
    value === "launch" ||
    value === "startToReady" ||
    value === "commandToEffect" ||
    value === "remoteUiEcho" ||
    value === "remoteUiBurst"
  );
}

/**
 * Whether a parsed value is a seed this driver can run. Pure, so the reader's
 * shape check is unit-tested without a WebView.
 */
export function isPluginsBenchSeed(value: unknown): value is PluginsBenchSeed {
  if (typeof value !== "object" || value === null) return false;
  const seed = value as Record<string, unknown>;
  return (
    isMode(seed.mode) &&
    typeof seed.samples === "number" &&
    Number.isInteger(seed.samples) &&
    seed.samples >= 1 &&
    typeof seed.collectorUrl === "string" &&
    Array.isArray(seed.approvals)
  );
}
