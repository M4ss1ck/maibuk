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
import {
  isBulkSignal,
  isEntityChange,
  isLibraryAvailability,
  onBeforeBulkReplace,
  onBulkReplaceCancelled,
  onChange,
  type BulkReason,
} from "@/features/sync/change-feed";
import { PLUGIN_API_VERSION } from "@/features/plugins/api-table";
import { clearStartupError, getPluginApproval, recordStartupError } from "@/features/plugins/approvals";
import { createBuiltInPluginSource } from "@/features/plugins/builtin";
import { registerPluginContributions } from "@/features/plugins/contributions";
import { hashPluginDirectory, pluginFileDigests } from "@/features/plugins/directory-hash";
import {
  clearPluginHighlights,
  invalidatePluginEditorWork,
  onEditorContentChanged,
  onEditorFocusChanged,
} from "@/features/plugins/editor-host";
import { createPluginHandlers } from "@/features/plugins/handlers";
import { pluginsRunOn } from "@/features/plugins/host-platform";
import { currentPluginLanguage, onPluginLanguageChange } from "@/features/plugins/language";
import {
  getPluginLifecycle,
  setPluginLifecycleInstance,
} from "@/features/plugins/lifecycle-instance";
import { scanApprovedPlugins, syncBuiltInPlugins } from "@/features/plugins/launch";
import { usePluginManagementStore } from "@/features/plugins/management";
import { checkPluginCompatibility } from "@/features/plugins/manifest-compat";
import { reviewPluginCopy } from "@/features/plugins/review";
import { STARTUP_TIMEOUT_MS, readPluginManifest, startPlugin } from "@/features/plugins/runtime";
import { pluginStopMessageKey } from "@/features/plugins/stop-messages";
import { getPluginDataVersion, setPluginDataVersion } from "@/features/plugins/storage";
import { isTutorialLibraryActive, settleAuthorLibraryWork, trackAuthorLibraryWork } from "@/features/tutorial/library-switch";
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
  PluginReview,
  PluginStartReason,
  PluginStartRefusal,
  PluginStopReason,
} from "@/features/plugins/types";
import { toast } from "@/components/ui/Toast";
import { APP_VERSION } from "@/constants";
import { useSettingsStore } from "@/features/settings/store";
import i18n from "@/i18n";
import { benchMarksEnabled } from "@/lib/bench-marks";
import { waitForDatabaseReady } from "@/lib/db";
import { getPluginDirectory } from "@/lib/platform";
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
 * are normal lifecycle events and stay silent. The reason-to-key map lives in
 * the leaf `stop-messages.ts` so Settings can reuse it without this module's
 * heavy graph; it is re-exported here for the existing callers.
 */
export { PLUGIN_STOP_MESSAGE_KEYS } from "@/features/plugins/stop-messages";

export function pluginStoppedMessage(
  name: string,
  reason: PluginLifecycleStopReason
): string | null {
  const key = pluginStopMessageKey(reason);
  return key === null ? null : i18n.t(key, { name });
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
 * User Timing marks for one activation's host-side work (the #401 per-start
 * budget). A devtools Performance profile or the production `bench:plugins`
 * build (`VITE_PLUGIN_BENCH=1`) shows them; a shipped build and an engine
 * without User Timing emit nothing. See `benchMarksEnabled()`.
 */
function devMark(name: string): void {
  if (!benchMarksEnabled()) return;
  if (typeof performance === "undefined" || typeof performance.mark !== "function") return;
  performance.mark(name);
}

function devMeasure(name: string, startMark: string, endMark: string): void {
  if (!benchMarksEnabled()) return;
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
  /**
   * The start in flight while the review gate reads the folder, before the
   * state turns "starting": a concurrent start joins it instead of bumping
   * the generation and failing the first caller (#442).
   */
  pendingStart: Promise<PluginActivationResult> | null;
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
  // Accepted Library work is registered with the Tutorial switch, so entering
  // the Tutorial waits for it and no call finishes against the sample Library
  // (ADR 0008, #398).
  const trackLibraryWork = options.trackLibraryWork ?? trackAuthorLibraryWork;
  // Accepted Library/storage work registered through `trackLibraryWork` is
  // awaited here before a bulk Library replacement, so a write that began in
  // one Library can never finish in the replaced one (#398).
  const settleLibraryWork = options.settleLibraryWork ?? settleAuthorLibraryWork;
  const builtInSource = options.builtInSource ?? createBuiltInPluginSource();
  const entries = new Map<string, Entry>();
  const listeners = new Set<(change: PluginLifecycleChange) => void>();
  let disposed = false;
  let launched = false;
  // The launch scan's own signal: surfaces that read the contributions
  // registries (a Plugin page) stay in loading copy until it settles.
  let scanned = false;
  const scanListeners = new Set<() => void>();
  // The Plugins a prepared bulk Library replacement (Restore, Reset Library,
  // Database File load) stopped, with the operation's reason. The matching
  // completion signal restarts them under that reason; an abandoned
  // replacement restarts them under a plain restart. See the seam
  // registration below.
  let pendingBulkReplace: { reason: BulkReason; pluginIds: string[] } | null = null;

  function markScanned(): void {
    if (scanned) return;
    scanned = true;
    for (const listener of [...scanListeners]) listener();
  }

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
    entry.pendingStart = null;
    clearTimers(entry);
    setState(entry, { status: "stopped", reason, refusal: null });
    runtime?.stop();
    if (!wasStarting) applyStopPolicy(entry, reason);
  }

  function refuseEntry(entry: Entry, refusal: PluginActivationRefusal): void {
    entry.runtime = null;
    entry.generation += 1;
    entry.pendingStart = null;
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
    entry.pendingStart = null;
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

  function startEntry(entry: Entry, reason: PluginStartReason): Promise<PluginActivationResult> {
    if (entry.pendingStart) return entry.pendingStart;
    const pending = runStart(entry, reason).finally(() => {
      if (entry.pendingStart === pending) entry.pendingStart = null;
    });
    entry.pendingStart = pending;
    return pending;
  }

  async function runStart(
    entry: Entry,
    reason: PluginStartReason
  ): Promise<PluginActivationResult> {
    const { pluginId, manifest, folder } = entry.installed;
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

    // The review gate (#442): only the copy the author approved starts. It runs
    // before the state turns "starting" and before any frame, in addition to
    // `startPlugin`'s own pinned-hash check, so a changed copy is refused
    // without ever being reported as starting. The live record is read so a
    // re-review (markReviewed) takes effect on the next start.
    const liveApproval = getPluginApproval(pluginId);
    let review: PluginReview | null = null;
    try {
      const digests = await pluginFileDigests(folder.files);
      const hash = await hashPluginDirectory(folder.files);
      review = reviewPluginCopy({
        approval: liveApproval,
        digests,
        hash,
        manifest,
      });
    } catch {
      // A folder the hash scheme refuses is reported by `startPlugin`'s own
      // check; the review cannot be computed, so the start falls through.
      review = null;
    }
    if (entry.generation !== generation) return { ok: false, refusal: { code: "not-installed" } };
    if (review !== null && review.status !== "approved") {
      const refusal: PluginActivationRefusal = {
        code: "review-required",
        status: review.status,
      };
      refuseEntry(entry, refusal);
      return { ok: false, refusal };
    }
    if (liveApproval === null && review === null) {
      const refusal: PluginActivationRefusal = { code: "review-required", status: "not-approved" };
      refuseEntry(entry, refusal);
      return { ok: false, refusal };
    }

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
        pinnedHash: (liveApproval ?? entry.installed.approval).pinnedHash,
        // A Built-in id parses under the Built-in schema in `startPlugin` too.
        builtIn: entry.installed.builtIn,
        // Why this activation happened; delivered to the Worker on the init
        // message so a Plugin learns a Restore or a Reset from a plain launch
        // (#400, #445).
        startReason: reason,
        // Read the live record on every broker call, so revoking an optional
        // grant refuses the next call without restarting the Plugin (#442).
        granted: () => getPluginApproval(pluginId)?.granted ?? [],
        handlers,
        createFrame: options.createFrame,
        isLibraryAvailable,
        trackLibraryWork,
        eventSnapshot: (event) =>
          event === "language.changed" ? { language: currentPluginLanguage() } : undefined,
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
      pendingStart: null,
      generation: 0,
    };
  }

  function nextIdle(): Promise<void> {
    return new Promise((resolve) => scheduleIdle(resolve));
  }

  /**
   * Restarts the Plugins a prepared bulk replacement stopped, under
   * `startReason`, then forgets them. A Plugin the replacement left uninstalled
   * is skipped. Restart goes through normal activation, so the dataVersion gate
   * runs against the replaced state.
   */
  function restartAfterBulkReplace(startReason: PluginStartReason): void {
    const pending = pendingBulkReplace;
    pendingBulkReplace = null;
    if (pending === null) return;
    for (const pluginId of pending.pluginIds) {
      const entry = entries.get(pluginId);
      if (!entry || disposed) continue;
      void startEntry(entry, startReason);
    }
  }

  // A bulk Library replacement stops every running or starting Plugin before
  // the data is replaced, so no Worker holds a cached value or an in-flight
  // call against the Library that is going away (decision #398). It then waits
  // for any Library/storage write a Plugin had already been accepted to settle,
  // so that write cannot land on the replaced Library. The ids and the reason
  // wait for the completion signal, which restarts them under that reason; an
  // abandoned replacement restarts them under a plain restart.
  const offBeforeBulkReplace = onBeforeBulkReplace(async (reason) => {
    const pluginIds: string[] = [];
    for (const entry of entries.values()) {
      const status = entry.state.status;
      if (status !== "ready" && status !== "unavailable" && status !== "starting") continue;
      // The stop reason is `requested`: it is a normal lifecycle event, so it
      // toasts nothing and grants no automatic restart. Built-ins have no
      // exemption.
      stopEntry(entry, "requested");
      // A stop drops the Plugin's editor highlights, exactly as an explicit
      // stop does, so a mark accepted against the Library that is going away
      // never surfaces on its replacement.
      clearPluginHighlights(entry.installed.pluginId);
      pluginIds.push(entry.installed.pluginId);
    }
    pendingBulkReplace = { reason, pluginIds };
    // `settleAuthorLibraryWork` never rejects, so this handler stays
    // non-throwing and never blocks the replacement.
    await settleLibraryWork();
  });
  const offBulkReplaceCancelled = onBulkReplaceCancelled(() => {
    restartAfterBulkReplace("restart");
  });

  // Every running Plugin hears the Library's own signals (#430) and the app
  // language. Only a ready runtime has a broker, and a stopped one is gone, so
  // no event is delivered to a Plugin that is not running; each subscription
  // dies with its broker. While the Library is unavailable (the Tutorial) no
  // content signal reaches a Plugin — its rows refuse — but the availability
  // signal itself still does, so a Plugin can stop calling. At that boundary
  // every Plugin's editor work is invalidated first (ADR 0008, #398): a
  // highlight or a reveal accepted against the Library that is going away can
  // never surface on its replacement, and no event is queued for the exit.
  const offChange = onChange((signal) => {
    if (isLibraryAvailability(signal)) {
      invalidatePluginEditorWork();
    }
    // A completed bulk replacement restarts the Plugins it stopped. The
    // restart starts now (asynchronously), so the just-restarted Worker is not
    // the one that receives this bulk event: a stopped Plugin gets no replay.
    if (isBulkSignal(signal) && pendingBulkReplace?.reason === signal.reason) {
      restartAfterBulkReplace(signal.reason);
    }
    for (const entry of entries.values()) {
      const broker = entry.runtime?.broker;
      if (!broker) continue;
      if (isLibraryAvailability(signal)) {
        broker.emit("library.availabilityChanged", {
          available: signal.available,
          ...(signal.reason !== undefined ? { reason: signal.reason } : {}),
        });
      } else if (isLibraryAvailable()) {
        if (isEntityChange(signal)) {
          broker.emit("library.changed", {
            entity: signal.entity,
            id: signal.id,
            origin: signal.origin,
            kind: signal.kind,
          });
        } else if (isBulkSignal(signal)) {
          broker.emit("library.changed", { scope: "all", reason: signal.reason });
        }
      }
    }
  });
  const offLanguage = onPluginLanguageChange((language) => {
    for (const entry of entries.values()) {
      entry.runtime?.broker.emit("language.changed", { language });
    }
  });
  // The focused editor's content and focus changes reach subscribed Plugins the
  // same way Library changes do; while the Library is unavailable (the
  // Tutorial) no editor content signal reaches a Plugin.
  const offEditorContent = onEditorContentChanged((entity) => {
    if (!isLibraryAvailable()) return;
    for (const entry of entries.values()) {
      entry.runtime?.broker.emit("editor.contentChanged", { entity });
    }
  });
  const offEditorFocus = onEditorFocusChanged((entity) => {
    if (!isLibraryAvailable()) return;
    for (const entry of entries.values()) {
      entry.runtime?.broker.emit("editor.focusChanged", { entity });
    }
  });

  return {
    async launch(): Promise<void> {
      if (launched || disposed) return;
      launched = true;
      try {
        // Copy the shipped Built-in Plugins into the Plugin Directory before
        // the scan and before the management store first classifies Plugins:
        // a missing copy is installed and an untouched copy is replaced on an
        // app update, so it is never mis-shown as Modified (#444). It never
        // throws, so a failure leaves the launch working with whatever is
        // installed.
        await syncBuiltInPlugins({
          directory: options.directory,
          builtInSource,
        });
        await whenLaunchSettled();
        if (disposed) return;
        const scan = await scanApprovedPlugins({
          directory: options.directory,
          builtInSource,
        });
        if (disposed) return;
        for (const { pluginId, refusal } of scan.refusals) {
          console.warn(`Plugin ${pluginId} did not load: ${refusal.code}`, refusal);
          recordStartupError(pluginId, refusal);
        }
        for (const plugin of scan.plugins) {
          const entry = createEntry(plugin);
          // Only an enabled Plugin reaches this scan (#442): its Commands,
          // pages, Settings rows, toolbar buttons, and Item Menu entries are
          // discoverable now, before any Worker exists (#437). A disabled
          // Plugin stays installed but is never scanned, so it is off.
          try {
            entry.unregisterContributions = registerPluginContributions({
              manifest: plugin.manifest,
              folder: plugin.folder,
            });
          } catch (error) {
            // One Plugin's bad contributions must never skip the next one.
            console.error(`Plugin ${plugin.pluginId} contributions failed to register`, error);
            continue;
          }
          entries.set(plugin.pluginId, entry);
        }
        // The scan and every contribution it registers are in; surfaces may
        // leave their loading copy even while the persistent starts are
        // still queued.
        markScanned();
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
            const result = await startEntry(entry, "launch");
            // A launch failure is a startup error the row shows until the next
            // successful start clears it (#442, item 5).
            if (result.ok) clearStartupError(plugin.pluginId);
            else recordStartupError(plugin.pluginId, result.refusal);
          } catch (error) {
            // One Plugin's failure must never skip the next one.
            console.error(`Plugin ${plugin.pluginId} failed to start`, error);
          }
        }
      } catch (error) {
        console.error("Plugin launch failed", error);
        markScanned();
      }
    },

    installed() {
      return [...entries.values()].map((entry) => entry.installed);
    },

    launchScanned() {
      return scanned;
    },

    onLaunchScanned(listener: () => void): () => void {
      scanListeners.add(listener);
      return () => {
        scanListeners.delete(listener);
      };
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

    async install(pluginId: string, reason: PluginStartReason) {
      if (disposed) return { ok: false, refusal: { code: "not-installed" } };
      const approval = getPluginApproval(pluginId);
      if (!approval || !approval.enabled) {
        return { ok: false, refusal: { code: "not-installed" } };
      }
      const directory = options.directory ?? (await getPluginDirectory());
      // The host runs no Plugin on a platform it does not support (Android in
      // v1, #447): an explicit enable can never start a Worker there.
      if (!pluginsRunOn(directory.kind)) return { ok: false, refusal: { code: "not-installed" } };
      const folder = await directory.readFolder(pluginId);
      if (!folder) return { ok: false, refusal: { code: "not-installed" } };
      // A reserved `maibuk-` id the shipped Built-in source lists parses under
      // the Built-in schema; a third-party folder stays under the other one
      // (#442), so a Built-in is not refused at start.
      const builtInIds = new Set((await builtInSource.list()).map((entry) => entry.id));
      const read = readPluginManifest(folder, { builtIn: builtInIds.has(pluginId) });
      if (!read.ok) {
        return { ok: false, refusal: { code: "manifest-invalid", problems: read.problems } };
      }
      const installed: InstalledPlugin = {
        pluginId,
        approval,
        folder,
        manifest: read.manifest,
        builtIn: builtInIds.has(pluginId),
      };
      let entry = entries.get(pluginId);
      if (!entry) {
        entry = createEntry(installed);
        try {
          entry.unregisterContributions = registerPluginContributions({
            manifest: installed.manifest,
            folder,
          });
        } catch (error) {
          // One Plugin's bad contributions must never leave a half entry.
          console.error(`Plugin ${pluginId} contributions failed to register`, error);
          return { ok: false, refusal: { code: "module-refused", problems: [] } };
        }
        entries.set(pluginId, entry);
      } else {
        // A re-review refreshes what the entry was scanned with, and clears a
        // stale refusal or limit-stop so a later warm start works.
        entry.installed = installed;
        entry.limitStopped = false;
        if (entry.state.status === "stopped" && entry.state.refusal !== null) {
          entry.state = { status: "stopped", reason: null, refusal: null };
        }
      }
      // The normal warm-start rules: an on-demand Plugin waits for a surface; a
      // persistent one starts now.
      if (installed.manifest.lifecycle === "on-demand" && entry.surfaces.size === 0) {
        return { ok: true, startReason: reason };
      }
      return startEntry(entry, reason);
    },

    uninstall(pluginId: string): void {
      const entry = entries.get(pluginId);
      if (!entry) return;
      clearPluginHighlights(pluginId);
      entry.generation += 1;
      entry.pendingStart = null;
      clearTimers(entry);
      const runtime = entry.runtime;
      entry.runtime = null;
      runtime?.stop();
      entry.unregisterContributions?.();
      entry.unregisterContributions = null;
      setState(entry, { status: "stopped", reason: "requested", refusal: null });
      entries.delete(pluginId);
    },

    stop(pluginId: string, reason: PluginLifecycleStopReason = "requested"): void {
      const entry = entries.get(pluginId);
      if (!entry) return;
      // A disabled Plugin loses its editor highlights; other Plugins' stay.
      clearPluginHighlights(pluginId);
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
      offChange();
      offBeforeBulkReplace();
      offBulkReplaceCancelled();
      offLanguage();
      offEditorContent();
      offEditorFocus();
      pendingBulkReplace = null;
      // A lifecycle stopped mid-launch must not leave loading surfaces behind.
      markScanned();
      scanListeners.clear();
      for (const entry of entries.values()) {
        entry.generation += 1;
        entry.pendingStart = null;
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

/**
 * The app's one lifecycle. Called from `main.tsx` in idle time after the first
 * render; the launch inside waits for the Library, the launch Auto Sync, and
 * the launch Backup before the first persistent start. The singleton itself
 * lives in `lifecycle-instance.ts`, which is the single source of truth, so
 * the UI reads it without loading this module.
 */
export function installPluginLifecycle(options: PluginLifecycleOptions = {}): PluginLifecycle {
  const existing = getPluginLifecycle();
  if (existing) return existing;
  const lifecycle = createPluginLifecycle(options);
  setPluginLifecycleInstance(lifecycle);
  void lifecycle.launch().then(() => {
    // Development mode at launch: a copy whose files changed while the app was
    // closed must go through the dev reload policy, and the folder watcher must
    // subscribe now, not only when Settings mounts (#442, plan decision 6). The
    // management store's refresh does both; it stays behind this dynamic
    // lifecycle import so the manifest validator never reaches the entry chunk.
    if (!useSettingsStore.getState().pluginDevelopmentMode) return;
    return usePluginManagementStore.getState().refresh();
  });
  return lifecycle;
}

export {
  getPluginLifecycle,
  onPluginLifecycleInstalled,
  resetPluginLifecycleForTests,
} from "@/features/plugins/lifecycle-instance";
