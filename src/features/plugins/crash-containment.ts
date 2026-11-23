/**
 * Answers the death record the Android side writes when the WebView renderer
 * is killed for memory (#927).
 *
 * Only a foreground death blames a Plugin: one whose last activity falls in the
 * 10 seconds before the death was running when the process ran out of memory.
 * At the next launch, before any Plugin warm-starts, each blamed Plugin is
 * disabled through the existing approval switch, and one sticky error toast
 * names them and offers Plugin settings. A foreground death with no blamed
 * Plugin says Maibuk restarted. A background death is silent: nothing was on
 * screen, so nothing is blamed. Desktop and web have no bridge, so this is a
 * no-op there.
 */

import { toast } from "@/components/ui/Toast";
import { disablePlugin, getPluginApproval, savePluginApproval } from "@/features/plugins/approvals";
import { getKnownPlugin } from "@/features/plugins/known";
import i18n from "@/i18n";

/** A Plugin active this close to the death was running when memory ran out. */
export const PLUGIN_BLAME_WINDOW_MS = 10_000;

/** Android's bridge to the death record (added in Kotlin, #926). */
export interface DeathRecordBridge {
  /** Returns the record once and clears it. */
  take(): string | null;
}

/** MainActivity's `window.MaibukDeathRecord`, absent off Android. */
function androidDeathRecordBridge(): DeathRecordBridge | undefined {
  return (globalThis.window as { MaibukDeathRecord?: DeathRecordBridge } | undefined)
    ?.MaibukDeathRecord;
}

interface DeathRecordPlugin {
  pluginId: string;
  lastActivityAt: number;
}

/** The parts of `DeathRecord.toJson` the launch response reads. */
interface DeathRecord {
  at: number;
  foreground: boolean;
  plugins: DeathRecordPlugin[];
}

function isDeathRecordPlugin(value: unknown): value is DeathRecordPlugin {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.pluginId === "string" && typeof record.lastActivityAt === "number";
}

function parseDeathRecord(raw: string): DeathRecord | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.at !== "number" || typeof record.foreground !== "boolean") return null;
    const plugins = Array.isArray(record.plugins) ? record.plugins.filter(isDeathRecordPlugin) : [];
    return { at: record.at, foreground: record.foreground, plugins };
  } catch {
    return null;
  }
}

/**
 * Disables every Plugin blamed by a foreground death record and notices the
 * author. The bridge returns the record once, so a later launch is silent.
 */
export function applyDeathRecord(
  options: {
    /** Resolves the bridge on each call; absent off Android. */
    bridge?: () => DeathRecordBridge | undefined;
  } = {}
): void {
  const bridge = options.bridge ?? androidDeathRecordBridge;
  const deathRecord = bridge();
  if (!deathRecord) return;
  let raw: unknown;
  try {
    raw = deathRecord.take();
  } catch {
    // A bridge that throws must never break the launch.
    return;
  }
  // A Java null may reach the page as null or undefined.
  if (typeof raw !== "string") return;
  const record = parseDeathRecord(raw);
  if (record === null || !record.foreground) return;

  const names: string[] = [];
  for (const plugin of record.plugins) {
    if (record.at - plugin.lastActivityAt > PLUGIN_BLAME_WINDOW_MS) continue;
    const approval = getPluginApproval(plugin.pluginId);
    // Only an enabled Plugin can have been running; a disabled one stays off.
    if (!approval || !approval.enabled) continue;
    savePluginApproval(disablePlugin(approval));
    names.push(getKnownPlugin(plugin.pluginId)?.manifest.name ?? plugin.pluginId);
  }

  if (names.length > 0) {
    toast.error(i18n.t("plugins.outOfMemory.disabled", { names: names.join(", ") }), {
      durationMs: null,
      action: { label: i18n.t("plugins.openSettings"), to: "/settings#plugins" },
    });
    return;
  }
  toast.error(i18n.t("plugins.outOfMemory.restarted"), { durationMs: null });
}
