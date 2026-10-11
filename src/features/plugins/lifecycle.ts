/**
 * The runtime state machine for every Plugin (ADR 0019, #401, #436).
 *
 * A persistent Plugin starts after the first route render, after the Library
 * opens, and after the launch Auto Sync and the launch Backup settled; starts
 * run one at a time in idle time. An on-demand Plugin starts when one of its
 * surfaces becomes reachable and stops after five minutes with neither a
 * reachable surface nor a call. A Plugin is ready when its setup finished, it
 * answered the startup health check, and the dataVersion gate passed; only
 * then are its contributions usable. A one-second heartbeat then watches it:
 * one miss makes the Plugin unavailable, five stop it.
 *
 * Every stop carries a reason. A persistent Plugin stopped by a limit gets one
 * automatic restart per session; an on-demand Plugin stopped by a limit is not
 * warm-started again in that session, though an explicit start still works. A
 * limit stop toasts the reason, localized and naming the Plugin.
 */

import { hasLaunchAutoSyncSettled, onLaunchAutoSyncSettled } from "@/features/sync/auto-sync";
import { hasLaunchBackupSettled, onLaunchBackupSettled } from "@/features/backup/lifecycle";
import { PLUGIN_API_VERSION } from "@/features/plugins/api-table";
import { registerPluginContributions } from "@/features/plugins/contributions";
import { createPluginHandlers } from "@/features/plugins/handlers";
import { scanApprovedPlugins } from "@/features/plugins/launch";
import { checkPluginCompatibility } from "@/features/plugins/manifest-compat";
import { STARTUP_TIMEOUT_MS, startPlugin } from "@/features/plugins/runtime";
import { getPluginDataVersion, setPluginDataVersion } from "@/features/plugins/storage";
import { isTutorialLibraryActive } from "@/features/tutorial/library-switch";
import type {
  InstalledPlugin,
  PluginActivationRefusal,
  PluginActivationResult,
  PluginLifecycle,
  PluginLifecycleChange,
  PluginLifecycleOptions,
  PluginLifecycleState,
  PluginLifecycleStopReason,
  PluginRuntime,
  PluginStartReason,
  PluginStartRefusal,
  PluginStopReason,
} from "@/features/plugins/types";
import { toast } from "@/components/ui/Toast";
import { APP_VERSION } from "@/constants";
import i18n from "@/i18n";
import { waitForDatabaseReady } from "@/lib/db";
import { PLUGIN_MIGRATE_DATA_REQUEST } from "@/plugin-sdk/protocol";

/** Heartbeat period; one missed beat makes the Plugin's contributions unusable. */
export const HEARTBEAT_INTERVAL_MS = 1_000;
/** Consecutive missed beats that stop the Plugin. */
export const HEARTBEAT_MISS_LIMIT = 5;
/** An on-demand Plugin with no reachable surface and no calls stops after this. */
export const IDLE_STOP_MS = 5 * 60_000;
/** Delay before a persistent Plugin's one automatic restart per session. */
export const RESTART_DELAY_MS = 1_000;

/**
 * The stop toast per reason, in the current language. `requested` and `idle`
 * are normal lifecycle events and stay silent.
 */
export const PLUGIN_STOP_MESSAGE_KEYS = {
  "startup-timeout": "plugins.stopped.startupTimeout",
  unresponsive: "plugins.stopped.unresponsive",
  throttled: "plugins.stopped.throttled",
  "remote-ui-limit": "plugins.stopped.remoteUiLimit",
  "out-of-memory": "plugins.stopped.outOfMemory",
  crashed: "plugins.stopped.crashed",
} as const;

type PluginToastedStopReason = keyof typeof PLUGIN_STOP_MESSAGE_KEYS;

export function pluginStoppedMessage(
  name: string,
  reason: PluginLifecycleStopReason
): string | null {
  if (!(reason in PLUGIN_STOP_MESSAGE_KEYS)) return null;
  const key = PLUGIN_STOP_MESSAGE_KEYS[reason as PluginToastedStopReason];
  return i18n.t(key, { name });
}

/** True for every reason a limit or a crash can produce; `requested` and `idle` are not limits. */
function isLimitStop(reason: PluginLifecycleStopReason): boolean {
  return reason !== "requested" && reason !== "idle";
}

/** An OOM reaches the host as a plain Worker error; the message is the only signal. */
function workerStopReason(message: string): PluginLifecycleStopReason {
  return /out[- ]of[- ]memory|allocation failed|not enough memory/i.test(message)
    ? "out-of-memory"
    : "crashed";
}

/** The stop a failed startup refusal stands for, or null when nothing ever ran. */
function refusalStopReason(refusal: PluginStartRefusal): PluginLifecycleStopReason | null {
  switch (refusal.code) {
    case "startup-timeout":
      return "startup-timeout";
    case "worker-error":
      return workerStopReason(refusal.message);
    case "health-check-failed":
      return "unresponsive";
    default:
      return null;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Dev-only User Timing marks for one activation's host-side work (the #401
 * per-start budget). A devtools Performance profile shows them; a production
 * build and an engine without User Timing emit nothing.
 */
function devMark(name: string): void {
  if (!import.meta.env.DEV) return;
  if (typeof performance === "undefined" || typeof performance.mark !== "function") return;
  performance.mark(name);
}

function devMeasure(name: string, startMark: string, endMark: string): void {
  if (!import.meta.env.DEV) return;
  if (typeof performance === "undefined" || typeof performance.measure !== "function") return;
  try {
    performance.measure(name, startMark, endMark);
  } catch {
    // A missing start mark leaves nothing to measure; never break a start over timing.
  }
}

/** Returned when work did not fit in what remained of the startup budget. */
const STARTUP_DEADLINE_EXCEEDED = Symbol("startup-deadline-exceeded");

/**
 * Races work against the startup deadline. The 10 s startup limit covers the
 * handshake and the dataVersion gate (#436), so the gate gets the remaining
 * budget after `startPlugin`, never a fresh one.
 */
async function withinStartupBudget<T>(
  work: Promise<T>,
  deadline: number
): Promise<T | typeof STARTUP_DEADLINE_EXCEEDED> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return STARTUP_DEADLINE_EXCEEDED;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof STARTUP_DEADLINE_EXCEEDED>((resolve) => {
    timer = setTimeout(() => resolve(STARTUP_DEADLINE_EXCEEDED), remaining);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function defaultWhenLaunchSettled(): Promise<void> {
  await waitForDatabaseReady();
  if (!hasLaunchAutoSyncSettled()) {
    await new Promise<void>((resolve) => {
      const off = onLaunchAutoSyncSettled(() => {
        off();
        resolve();
      });
    });
  }
  if (!hasLaunchBackupSettled()) {
    await new Promise<void>((resolve) => {
      const off = onLaunchBackupSettled(() => {
        off();
        resolve();
      });
    });
  }
}

function defaultScheduleIdle(work: () => void): void {
  if (typeof requestIdleCallback === "function") requestIdleCallback(() => work());
  else setTimeout(work, 0);
}

interface Entry {
  installed: InstalledPlugin;
  state: PluginLifecycleState;
  runtime: PluginRuntime | null;
  /** Removes this Plugin's contributions from the shared registries (#437). */
  unregisterContributions: (() => void) | null;
  /** Reachable surfaces, by whatever id the wire caller uses (#437). */
  surfaces: Set<string>;
  heartbeat: ReturnType<typeof setInterval> | null;
  beatInFlight: boolean;
  misses: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
  restartTimer: ReturnType<typeof setTimeout> | null;
  /** The one automatic restart per session a persistent Plugin gets. */
  autoRestarted: boolean;
  /** An on-demand Plugin stopped by a limit is not warm-started again this session. */
  limitStopped: boolean;
  /** Invalidates in-flight work when a stop or a new start supersedes it. */
  generation: number;
}

export function createPluginLifecycle(options: PluginLifecycleOptions = {}): PluginLifecycle {
  const dataVersions = options.dataVersions ?? {
    get: getPluginDataVersion,
    set: setPluginDataVersion,
  };
  const whenLaunchSettled = options.whenLaunchSettled ?? defaultWhenLaunchSettled;
  const scheduleIdle = options.scheduleIdle ?? defaultScheduleIdle;
  const stopMessage = options.stopMessage ?? pluginStoppedMessage;
  const handlers = options.handlers ?? createPluginHandlers;
  // A broker call that reads or writes the Library must refuse while the
  // Tutorial Library is active (ADR 0008), like every other background job.
  const isLibraryAvailable = options.isLibraryAvailable ?? (() => !isTutorialLibraryActive());
  const entries = new Map<string, Entry>();
  const listeners = new Set<(change: PluginLifecycleChange) => void>();
  let disposed = false;
  let launched = false;

  // Reachable surfaces are tracked per Plugin id even before the launch scan
  // registers it, so a surface mounted during launch still warm-starts it.
  const reachable = new Map<string, Set<string>>();

  function surfacesOf(pluginId: string): Set<string> {
    let set = reachable.get(pluginId);
    if (!set) {
      set = new Set();
      reachable.set(pluginId, set);
    }
    return set;
  }

  function notify(entry: Entry): void {
    const change: PluginLifecycleChange = {
      pluginId: entry.installed.pluginId,
      name: entry.installed.manifest.name,
      state: entry.state,
    };
    for (const listener of [...listeners]) listener(change);
  }

  function setState(entry: Entry, state: PluginLifecycleState): void {
    entry.state = state;
    notify(entry);
  }

  function clearTimers(entry: Entry): void {
    if (entry.heartbeat !== null) {
      clearInterval(entry.heartbeat);
      entry.heartbeat = null;
    }
    if (entry.idleTimer !== null) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = null;
    }
    if (entry.restartTimer !== null) {
      clearTimeout(entry.restartTimer);
      entry.restartTimer = null;
    }
    entry.beatInFlight = false;
    entry.misses = 0;
  }

  function armIdle(entry: Entry): void {
    if (entry.idleTimer !== null) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = null;
    }
    if (disposed) return;
    if (entry.installed.manifest.lifecycle !== "on-demand") return;
    if (entry.surfaces.size > 0) return;
    if (entry.state.status !== "ready" && entry.state.status !== "unavailable") return;
    entry.idleTimer = setTimeout(() => {
      entry.idleTimer = null;
      stopEntry(entry, "idle");
    }, IDLE_STOP_MS);
  }

  /**
   * The policy every stop shares: the toast, the on-demand warm-start ban, and
   * the persistent Plugin's one automatic restart per session.
   */
  function applyStopPolicy(entry: Entry, reason: PluginLifecycleStopReason): void {
    const message = stopMessage(entry.installed.manifest.name, reason);
    if (message !== null) toast.error(message);
    if (!isLimitStop(reason)) return;
    if (entry.installed.manifest.lifecycle === "on-demand") {
      entry.limitStopped = true;
      return;
    }
    if (entry.autoRestarted || disposed) return;
    entry.autoRestarted = true;
    entry.restartTimer = setTimeout(() => {
      entry.restartTimer = null;
      void startEntry(entry, "restart");
    }, RESTART_DELAY_MS);
  }

  function stopEntry(entry: Entry, reason: PluginLifecycleStopReason): void {
    if (entry.state.status === "stopped") return;
    // The state is set before the runtime stops so the broker's own `requested`
    // stop (from `runtime.stop()`) is ignored by the stop watcher.
    const wasStarting = entry.state.status === "starting";
    const runtime = entry.runtime;
    entry.runtime = null;
    entry.generation += 1;
    clearTimers(entry);
    setState(entry, { status: "stopped", reason, refusal: null });
    runtime?.stop();
    if (!wasStarting) applyStopPolicy(entry, reason);
  }

  function refuseEntry(entry: Entry, refusal: PluginActivationRefusal): void {
    entry.runtime = null;
    entry.generation += 1;
    clearTimers(entry);
    setState(entry, { status: "stopped", reason: null, refusal });
  }

  /** A startup that ran into a limit: recorded and treated like any other stop. */
  function failStart(
    entry: Entry,
    refusal: PluginActivationRefusal,
    reason: PluginLifecycleStopReason
  ): void {
    entry.runtime = null;
    entry.generation += 1;
    clearTimers(entry);
    setState(entry, { status: "stopped", reason, refusal });
    applyStopPolicy(entry, reason);
  }

  /** A Worker error, crash or OOM, after the handshake (readiness included). */
  function workerError(entry: Entry, message: string): void {
    const status = entry.state.status;
    if (status !== "ready" && status !== "unavailable" && status !== "starting") return;
    const reason = workerStopReason(message);
    stopEntry(entry, reason);
    // A crash after the handshake but before ready is still a run that began,
    // so the toast and the restart-once policy apply like any other crash.
    if (status === "starting") applyStopPolicy(entry, reason);
  }

  /** The broker stopped itself (sustained throttling); `requested` stops are ignored. */
  function brokerStopped(entry: Entry, reason: PluginStopReason): void {
    if (entry.state.status !== "ready" && entry.state.status !== "unavailable") return;
    stopEntry(entry, reason);
  }

  /** A call from the Plugin is activity: the idle window restarts. */
  function noteCall(entry: Entry): void {
    if (entry.state.status !== "ready" && entry.state.status !== "unavailable") return;
    armIdle(entry);
  }

  function startHeartbeat(entry: Entry): void {
    entry.misses = 0;
    entry.beatInFlight = false;
    entry.heartbeat = setInterval(() => {
      if (entry.beatInFlight) {
        entry.misses += 1;
        if (entry.misses >= HEARTBEAT_MISS_LIMIT) {
          stopEntry(entry, "unresponsive");
          return;
        }
        if (entry.state.status === "ready" || entry.state.status === "unavailable") {
          setState(entry, {
            status: "unavailable",
            startReason: entry.state.startReason,
            heartbeatMisses: entry.misses,
          });
        }
        return;
      }
      const broker = entry.runtime?.broker;
      if (!broker) return;
      entry.beatInFlight = true;
      const answered = () => {
        entry.beatInFlight = false;
        entry.misses = 0;
        if (entry.state.status === "unavailable") {
          setState(entry, { status: "ready", startReason: entry.state.startReason });
        }
      };
      // A refused health check still proves the message loop answers.
      void broker.request("health.check", {}).then(answered, answered);
    }, HEARTBEAT_INTERVAL_MS);
  }

  async function startEntry(
    entry: Entry,
    reason: PluginStartReason
  ): Promise<PluginActivationResult> {
    const { pluginId, manifest, folder, approval } = entry.installed;
    if (disposed) return { ok: false, refusal: { code: "not-installed" } };
    if (entry.state.status !== "stopped") {
      // Already starting, ready, or unavailable: nothing to do.
      return { ok: true, startReason: entry.state.startReason };
    }
    entry.limitStopped = false;
    const generation = ++entry.generation;
    // Readiness is the handshake plus the dataVersion gate, so one budget
    // covers both (#436).
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    const startMark = `plugin.start:${pluginId}:begin`;
    const handshakeMark = `plugin.start:${pluginId}:handshake`;
    devMark(startMark);
    setState(entry, { status: "starting", startReason: reason });

    // An incompatible manifest stays listed and off (#436): the check runs
    // before the dataVersion read and before any frame exists.
    const compatibility = checkPluginCompatibility(manifest, {
      apiVersion: PLUGIN_API_VERSION,
      appVersion: APP_VERSION,
    });
    if (compatibility.verdict !== "ok") {
      const refusal: PluginActivationRefusal = { code: "incompatible", compatibility };
      refuseEntry(entry, refusal);
      return { ok: false, refusal };
    }

    const manifestVersion = manifest.dataVersion ?? 1;
    let stored: number | null;
    try {
      stored = await dataVersions.get(pluginId);
    } catch (error) {
      const refusal: PluginActivationRefusal = {
        code: "data-version-unavailable",
        message: messageOf(error),
      };
      if (entry.generation === generation) refuseEntry(entry, refusal);
      return { ok: false, refusal };
    }
    if (entry.generation !== generation) return { ok: false, refusal: { code: "not-installed" } };
    if (stored !== null && stored > manifestVersion) {
      // Data from a newer release: preserved, activation refused (ADR 0023).
      const refusal: PluginActivationRefusal = {
        code: "data-newer",
        stored,
        manifest: manifestVersion,
      };
      refuseEntry(entry, refusal);
      return { ok: false, refusal };
    }

    let result: Awaited<ReturnType<typeof startPlugin>>;
    try {
      result = await startPlugin({
        folder,
        pinnedHash: approval.pinnedHash,
        granted: approval.granted,
        handlers,
        createFrame: options.createFrame,
        isLibraryAvailable,
        // The remaining budget, so the handshake cannot grant itself a fresh 10 s.
        timeoutMs: Math.max(0, deadline - Date.now()),
        onWorkerError: (message) => workerError(entry, message),
        onBrokerStop: (brokerReason) => brokerStopped(entry, brokerReason),
        onCall: () => noteCall(entry),
      });
    } catch (error) {
      const refusal: PluginActivationRefusal = { code: "worker-error", message: messageOf(error) };
      if (entry.generation === generation) refuseEntry(entry, refusal);
      return { ok: false, refusal };
    }

    if (entry.generation !== generation) {
      if (result.ok) result.plugin.stop();
      return { ok: false, refusal: { code: "not-installed" } };
    }

    if (!result.ok) {
      const refusal = result.refusal;
      const stopReason = refusalStopReason(refusal);
      if (stopReason === null) {
        refuseEntry(entry, refusal);
        return { ok: false, refusal };
      }
      failStart(entry, refusal, stopReason);
      return { ok: false, refusal };
    }

    entry.runtime = result.plugin;
    devMark(handshakeMark);
    devMeasure(`plugin.start.host:${pluginId}`, startMark, handshakeMark);

    // The dataVersion gate runs before ready (ADR 0023). Data at an older
    // version is migrated by the Plugin's own migrateData, once; a throw
    // leaves the data and its version record untouched and refuses activation.
    if (stored !== null && stored < manifestVersion) {
      try {
        const migration = await withinStartupBudget(
          result.plugin.broker.request(PLUGIN_MIGRATE_DATA_REQUEST, { from: stored }),
          deadline
        );
        if (migration === STARTUP_DEADLINE_EXCEEDED) {
          result.plugin.stop();
          if (entry.generation === generation) {
            failStart(entry, { code: "startup-timeout" }, "startup-timeout");
          }
          return { ok: false, refusal: { code: "startup-timeout" } };
        }
        await dataVersions.set(pluginId, manifestVersion);
      } catch (error) {
        result.plugin.stop();
        if (entry.generation === generation) {
          refuseEntry(entry, { code: "migration-failed", from: stored, message: messageOf(error) });
        }
        return {
          ok: false,
          refusal: { code: "migration-failed", from: stored, message: messageOf(error) },
        };
      }
    } else if (stored === null) {
      // The namespace starts at the manifest's version, so a later release
      // knows what wrote it. A storage failure stops the runtime it already
      // created and refuses, never escaping startEntry.
      try {
        await dataVersions.set(pluginId, manifestVersion);
      } catch (error) {
        const refusal: PluginActivationRefusal = {
          code: "data-version-unavailable",
          message: messageOf(error),
        };
        result.plugin.stop();
        if (entry.generation === generation) refuseEntry(entry, refusal);
        return { ok: false, refusal };
      }
    }

    if (entry.generation !== generation || entry.runtime !== result.plugin) {
      result.plugin.stop();
      return { ok: false, refusal: { code: "not-installed" } };
    }
    setState(entry, { status: "ready", startReason: reason });
    startHeartbeat(entry);
    armIdle(entry);
    const readyMark = `plugin.start:${pluginId}:ready`;
    devMark(readyMark);
    devMeasure(`plugin.start:${pluginId}`, startMark, readyMark);
    devMeasure(`plugin.start.gate:${pluginId}`, handshakeMark, readyMark);
    return { ok: true, startReason: reason };
  }

  function createEntry(installed: InstalledPlugin): Entry {
    return {
      installed,
      state: { status: "stopped", reason: null, refusal: null },
      runtime: null,
      unregisterContributions: null,
      surfaces: surfacesOf(installed.pluginId),
      heartbeat: null,
      beatInFlight: false,
      misses: 0,
      idleTimer: null,
      restartTimer: null,
      autoRestarted: false,
      limitStopped: false,
      generation: 0,
    };
  }

  function nextIdle(): Promise<void> {
    return new Promise((resolve) => scheduleIdle(resolve));
  }

  return {
    async launch(): Promise<void> {
      if (launched || disposed) return;
      launched = true;
      try {
        await whenLaunchSettled();
        if (disposed) return;
        const scan = await scanApprovedPlugins({ directory: options.directory });
        if (disposed) return;
        for (const { pluginId, refusal } of scan.refusals) {
          console.warn(`Plugin ${pluginId} did not load: ${refusal.code}`, refusal);
        }
        for (const plugin of scan.plugins) {
          const entry = createEntry(plugin);
          // An approved Plugin is enabled (until the install flow lands, #442):
          // its Commands, pages, Settings rows, toolbar buttons, and Item Menu
          // entries are discoverable now, before any Worker exists (#437).
          entry.unregisterContributions = registerPluginContributions({
            manifest: plugin.manifest,
            folder: plugin.folder,
          });
          entries.set(plugin.pluginId, entry);
        }
        // A surface mounted while the scan ran warm-starts its Plugin now.
        for (const plugin of scan.plugins) {
          if (plugin.manifest.lifecycle !== "on-demand") continue;
          const entry = entries.get(plugin.pluginId);
          if (entry && entry.surfaces.size > 0) void startEntry(entry, "warmStart");
        }
        // Persistent Plugins start one at a time in idle time; on-demand
        // Plugins wait for a surface and disabled ones never registered.
        for (const plugin of scan.plugins) {
          if (plugin.manifest.lifecycle !== "persistent") continue;
          await nextIdle();
          if (disposed) return;
          const entry = entries.get(plugin.pluginId);
          if (!entry) continue;
          try {
            await startEntry(entry, "launch");
          } catch (error) {
            // One Plugin's failure must never skip the next one.
            console.error(`Plugin ${plugin.pluginId} failed to start`, error);
          }
        }
      } catch (error) {
        console.error("Plugin launch failed", error);
      }
    },

    installed() {
      return [...entries.values()].map((entry) => entry.installed);
    },

    surfaceReached(pluginId: string, surface: string): void {
      surfacesOf(pluginId).add(surface);
      const entry = entries.get(pluginId);
      if (!entry) return;
      if (entry.idleTimer !== null) {
        clearTimeout(entry.idleTimer);
        entry.idleTimer = null;
      }
      if (entry.state.status !== "stopped") return;
      if (entry.installed.manifest.lifecycle !== "on-demand") return;
      if (
        entry.limitStopped ||
        entry.state.refusal !== null ||
        entry.state.reason === "requested"
      ) {
        return;
      }
      void startEntry(entry, "warmStart");
    },

    surfaceLeft(pluginId: string, surface: string): void {
      reachable.get(pluginId)?.delete(surface);
      const entry = entries.get(pluginId);
      if (!entry) return;
      armIdle(entry);
    },

    async start(pluginId: string, reason: PluginStartReason) {
      const entry = entries.get(pluginId);
      if (!entry) return { ok: false, refusal: { code: "not-installed" } };
      return startEntry(entry, reason);
    },

    stop(pluginId: string, reason: PluginLifecycleStopReason = "requested"): void {
      const entry = entries.get(pluginId);
      if (!entry) return;
      if (entry.state.status === "stopped") {
        // An explicit stop wins over a pending automatic restart: cancel it
        // and record the author's intent.
        if (entry.restartTimer === null) return;
        clearTimeout(entry.restartTimer);
        entry.restartTimer = null;
        setState(entry, { status: "stopped", reason: "requested", refusal: entry.state.refusal });
        return;
      }
      stopEntry(entry, reason);
    },

    state(pluginId: string) {
      return entries.get(pluginId)?.state ?? null;
    },

    runtime(pluginId: string) {
      return entries.get(pluginId)?.runtime ?? null;
    },

    subscribe(listener: (change: PluginLifecycleChange) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const entry of entries.values()) {
        entry.generation += 1;
        clearTimers(entry);
        const runtime = entry.runtime;
        entry.runtime = null;
        runtime?.stop();
        entry.unregisterContributions?.();
        entry.unregisterContributions = null;
        entry.state = { status: "stopped", reason: "requested", refusal: null };
      }
      entries.clear();
      reachable.clear();
      listeners.clear();
    },
  };
}

let installedLifecycle: PluginLifecycle | null = null;
const lifecycleInstalledListeners = new Set<() => void>();

/**
 * Runs when the app's one lifecycle is installed. Surfaces that mounted before
 * the idle install (the sidebar, mostly) re-announce themselves then, so an
 * on-demand Plugin still warm-starts from them (#437).
 */
export function onPluginLifecycleInstalled(listener: () => void): () => void {
  lifecycleInstalledListeners.add(listener);
  return () => {
    lifecycleInstalledListeners.delete(listener);
  };
}

/**
 * The app's one lifecycle. Called from `main.tsx` in idle time after the first
 * render; the launch inside waits for the Library, the launch Auto Sync, and
 * the launch Backup before the first persistent start.
 */
export function installPluginLifecycle(options: PluginLifecycleOptions = {}): PluginLifecycle {
  if (installedLifecycle) return installedLifecycle;
  const lifecycle = createPluginLifecycle(options);
  installedLifecycle = lifecycle;
  for (const listener of [...lifecycleInstalledListeners]) listener();
  void lifecycle.launch();
  return lifecycle;
}

export function getPluginLifecycle(): PluginLifecycle | null {
  return installedLifecycle;
}

export function resetPluginLifecycleForTests(): void {
  installedLifecycle?.dispose();
  installedLifecycle = null;
}
