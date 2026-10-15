/**
 * The real runtime behind the conformance checks (#447, D3/D4). This module is
 * the one place the route touches Plugins, and it drives the **real lifecycle**
 * (`createPluginLifecycle`, lifecycle.ts) rather than reimplementing it: the
 * fixture-hostile Plugin is installed into an in-memory Plugin Directory, an
 * enabled approval pins its hash, and `lifecycle.launch()` scans and starts it
 * through the real sandbox, Worker, broker, and heartbeat. T7/T8's stops and
 * their reasons (`unresponsive`, `out-of-memory`, `crashed`) therefore come from
 * lifecycle.ts itself, as do the `remote-ui-limit` stops the UI Commands cause.
 *
 * The in-memory directory adapter is the same shape the lifecycle suite uses
 * (`src/test/unit/features/plugins/lifecycle.test.tsx`): `kind`, `listFolders`,
 * and `readFolder` over a `Map`. The heartbeats, the stop policy, and the
 * dataVersion gate are all the lifecycle's.
 *
 * Every pass/fail rule still lives in `checks.ts`; this module only reports
 * facts. Only the T2 frame probe is built here (a raw sandboxed frame with the
 * real bootstrap CSP), because the lifecycle starts Workers, not probe frames.
 */

import type { RemoteMutationRecord } from "@remote-dom/core";
import { ThreadMessagePort } from "@quilted/threads";

import { savePluginApproval } from "@/features/plugins/approvals";
import { loadFixtureHostile } from "@/features/plugins/conformance/fixture";
import { conformanceDirectoryKind } from "@/features/plugins/conformance/host-bypass";
import { waitForReasonWithinGrace } from "@/features/plugins/conformance/oom-grace";
import {
  type CommandObservation,
  type ConformanceEngine,
  type ConformancePlatform,
  type ConformanceSeam,
  type IpcObservation,
  type OomObservation,
  type StopObservation,
  T8_ALLOCATION_CAP_MB,
} from "@/features/plugins/conformance/types";
import { createPluginLifecycle, HEARTBEAT_INTERVAL_MS } from "@/features/plugins/lifecycle";
import { openPluginUiMount } from "@/features/plugins/remote-ui/mount";
import { createPluginRemoteUi } from "@/features/plugins/remote-ui/receiver";
import type { PluginUiViolation } from "@/features/plugins/remote-ui/validate";
import { readPluginManifest } from "@/features/plugins/runtime";
import { BOOTSTRAP_HTML } from "@/features/plugins/sandbox";
import type {
  BuiltInPluginSource,
  PluginApiHandlers,
  PluginFolder,
  PluginLifecycle,
  PluginRuntime,
} from "@/features/plugins/types";
import { IS_ANDROID, IS_DESKTOP } from "@/lib/platform";
import type { PluginDirectoryAdapter } from "@/lib/platform/types";
import { PLUGIN_COMMAND_RUN_REQUEST } from "@/plugin-sdk/protocol";

/** The fixture Plugin's folder name and id (see `fixture.ts`). */
const FIXTURE_HOSTILE_ID = "fixture-hostile";

/** How long a UI Command's page may take to mount or be refused. */
const PAGE_SETTLE_MS = 4_000;
/** How long a terminal command (T7/T8) may take to stop the Plugin. */
const TERMINAL_BUDGET_MS = 20_000;

/**
 * The fixture Command T8 runs: allocation in chunks with a yield between them,
 * so the Worker answers the heartbeat and reaches its own memory limit (the
 * fixture's `escapeAllocateYielding`).
 */
const YIELDING_ALLOCATION_COMMAND = "escapeAllocateYielding";
/** T8's time budget: no stop and the cap not reached by then is `unmeasured`. */
const OOM_BUDGET_MS = 120_000;
/**
 * How long T8 waits after the yielding allocation's request settles for the
 * lifecycle to record its stop reason (two heartbeat intervals). The Worker's
 * memory death rejects the request a moment before the lifecycle's worker-error
 * path sets the reason, so settling alone is not proof the Plugin survived.
 */
const OOM_SETTLE_GRACE_MS = 2 * HEARTBEAT_INTERVAL_MS;
/**
 * The storage key the yielding fixture writes its running total to (MB). The
 * fixture duplicates the string (it cannot import this module); both copies
 * carry this comment so a change lands in both.
 */
const ALLOCATION_KEY = "hostile.allocationMb";

/** The page each UI Command mounts (the fixture's `contributes.pages`). */
const PAGE_BY_COMMAND: Readonly<Record<string, string>> = {
  openPanel: "panel",
  uiViolation: "violation",
  uiFlood: "flood",
};

export interface RuntimeSeamOptions {
  /**
   * The host heartbeat after T8. The route passes the collector POST; default
   * answers true, which keeps the seam usable on its own.
   */
  heartbeat?: () => Promise<boolean>;
  /** The collector's request count, for the escape leak half of the pass rule. */
  leaks?: () => Promise<number>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The sandbox CSP, read from the real bootstrap rather than duplicated. */
function sandboxCsp(): string {
  const match = /content="([^"]*)"/.exec(BOOTSTRAP_HTML);
  if (!match) throw new Error("the sandbox bootstrap has no CSP meta tag");
  return match[1];
}

/**
 * The in-frame half of T2: try every Tauri IPC path a sandboxed frame could have
 * and report whether any of them reached the Rust side. The frame is the real
 * sandbox shape — `sandbox="allow-scripts"`, the bootstrap's CSP, an opaque
 * origin — so a blocked result is the platform's, not this route's.
 */
const FRAME_IPC_PROBE = `(async () => {
  const out = { reached: false, detail: "no Tauri IPC path reached the host" };
  try {
    const internals = window.__TAURI_INTERNALS__;
    if (internals && typeof internals.invoke === "function") {
      await internals.invoke("plugin:conformance%7Cprobe", {});
      out.reached = true;
      out.detail = "window.__TAURI_INTERNALS__.invoke resolved";
    }
  } catch (error) {
    out.detail = "invoke refused: " + String((error && error.message) || error);
  }
  try {
    const ipc = window.ipc;
    if (!out.reached && ipc && typeof ipc.postMessage === "function") {
      ipc.postMessage(JSON.stringify({ cmd: "plugin:conformance%7Cprobe" }));
      out.reached = true;
      out.detail = "window.ipc.postMessage accepted a message";
    }
  } catch (error) {
    out.detail = "ipc.postMessage refused: " + String((error && error.message) || error);
  }
  try {
    const response = await fetch("ipc://localhost/plugin%3Aconformance%7Cprobe", {
      method: "POST",
      body: "{}",
    });
    out.reached = true;
    out.detail = "ipc:// fetch returned " + String(response && response.status);
  } catch (error) {
    out.detail = "ipc:// fetch refused: " + String((error && error.message) || error);
  }
  parent.postMessage({ __conformanceFrameProbe: out }, "*");
})();`;

function readPlatform(): ConformancePlatform {
  if (IS_ANDROID) return "android";
  if (IS_DESKTOP) return "desktop";
  return "web";
}

function readEngine(platform: ConformancePlatform): ConformanceEngine {
  const userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const name =
    platform === "android"
      ? "android-webview"
      : platform === "desktop"
        ? /AppleWebKit/.test(userAgent) && !/Chrome/.test(userAgent)
          ? "tauri-webkitgtk"
          : "tauri-chromium"
        : "web";
  // The engine's version is unknowable from inside its own WebView; the lane
  // merges the measured one (WebKitGTK / System WebView) into the recorded run
  // (`mergeRunEngine`, D1). Reporting the app version here would be the #447
  // bug, so it stays `"unknown"` until the runner fills it in.
  return { name, version: "unknown", userAgent };
}

export async function createRuntimeSeam(
  options: RuntimeSeamOptions = {}
): Promise<ConformanceSeam> {
  const platform = readPlatform();
  const heartbeat = options.heartbeat ?? (async () => true);
  const leaks = options.leaks ?? (async () => 0);

  const reports: string[] = [];
  let stopReason: string | null = null;
  let launched = false;
  /** The MB the yielding allocation last reported (T8's detail reads it). */
  let allocatedMb = 0;

  const { folder, pinnedHash } = await loadFixtureHostile();
  const read = readPluginManifest(folder);
  if (!read.ok) {
    throw new Error(
      `the fixture-hostile manifest is invalid: ${read.problems.map((p) => p.message).join("; ")}`
    );
  }
  const manifest = read.manifest;

  // The lifecycle only starts an enabled, approved copy; pin the hash of the
  // exact bytes the runtime will read, so the review gate passes.
  savePluginApproval({
    pluginId: FIXTURE_HOSTILE_ID,
    pinnedHash,
    granted: [],
    enabled: true,
    approvedVersion: manifest.version,
    approvedPermissions: {
      required: [...manifest.permissions.required],
      optional: [...manifest.permissions.optional],
    },
    approvedFiles: {},
  });

  // The in-memory Plugin Directory: the shape the lifecycle suite uses. Its
  // kind comes from the conformance bypass (host-bypass.ts), not the device, so
  // the real lifecycle scans the fixture on Android too — where the v1 host rule
  // otherwise runs no Plugin (#447, #492). The seam still reports the true
  // platform to every check.
  const folders = new Map<string, PluginFolder>([[FIXTURE_HOSTILE_ID, folder]]);
  const directory: PluginDirectoryAdapter = {
    kind: conformanceDirectoryKind(platform),
    listFolders: async () => [FIXTURE_HOSTILE_ID],
    readFolder: async (name: string) => folders.get(name) ?? null,
  };
  // No shipped Built-ins to sync; the fixture is the only Plugin.
  const builtInSource: BuiltInPluginSource = { list: async () => [] };

  // The fixture reports escapes through `notifications.show`; capturing it here
  // is how the host reads a refusal. The storage handlers are stubbed so the
  // flood and oversized Commands never reach the Library database; the
  // yielding allocation's progress writes record the MB reached (T8).
  const handlers: PluginApiHandlers = {
    "notifications.show": ({ message }) => {
      reports.push(message);
      return null;
    },
    "storage.keys": () => [],
    "storage.get": () => null,
    "storage.set": ({ key, value }) => {
      if (key === ALLOCATION_KEY && typeof value === "number") allocatedMb = value;
      return null;
    },
    "storage.delete": () => null,
    "toolbar.setPressed": () => null,
  };

  const dataVersions = new Map<string, number>();
  const lifecycle: PluginLifecycle = createPluginLifecycle({
    directory,
    builtInSource,
    handlers: () => handlers,
    isLibraryAvailable: () => true,
    dataVersions: {
      get: async (pluginId) => dataVersions.get(pluginId) ?? null,
      set: async (pluginId, version) => {
        dataVersions.set(pluginId, version);
      },
    },
    // The launch gates (Library, Auto Sync, Backup) do not apply here.
    whenLaunchSettled: async () => undefined,
    // Stops are observed through the state machine, not a toast.
    stopMessage: () => null,
  });

  // The lifecycle owns heartbeat and stop detection; the seam only records the
  // reason it reports, so T7/T8 read exactly what lifecycle.ts decided.
  const offChange = lifecycle.subscribe((change) => {
    if (change.pluginId === FIXTURE_HOSTILE_ID && change.state.status === "stopped") {
      stopReason = change.state.reason ?? "unknown";
    }
  });

  async function ensureReady(): Promise<PluginRuntime> {
    if (!launched) {
      launched = true;
      await lifecycle.launch();
    }
    // A limit stop auto-restarts a persistent Plugin once per session, so a
    // check after T7 may find the Plugin mid-restart. Poll until it is ready,
    // starting it explicitly whenever it is stopped.
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const runtime = lifecycle.runtime(FIXTURE_HOSTILE_ID);
      const status = lifecycle.state(FIXTURE_HOSTILE_ID)?.status;
      if (runtime && !runtime.broker.stopped && (status === "ready" || status === "unavailable")) {
        return runtime;
      }
      if (status === "stopped") {
        const result = await lifecycle.start(FIXTURE_HOSTILE_ID, "restart");
        if (!result.ok) {
          throw new Error(`the fixture-hostile Plugin did not start: ${result.refusal.code}`);
        }
      }
      await sleep(150);
    }
    throw new Error("the fixture-hostile Plugin did not become ready");
  }

  /** Waits for the lifecycle to stop the Plugin and returns its reason. */
  async function waitForStop(deadlineMs: number): Promise<string> {
    const deadline = Date.now() + deadlineMs;
    while (Date.now() < deadline) {
      if (stopReason !== null) return stopReason;
      const state = lifecycle.state(FIXTURE_HOSTILE_ID);
      if (state?.status === "stopped") return state.reason ?? "unknown";
      await sleep(150);
    }
    throw new Error("the Plugin did not stop within the budget");
  }

  /**
   * The stop reason the lifecycle has recorded so far, or null while it has
   * none. T8 polls this: the reason can arrive a beat after the Worker's death.
   */
  function readStopReason(): string | null {
    if (stopReason !== null) return stopReason;
    const state = lifecycle.state(FIXTURE_HOSTILE_ID);
    if (state?.status === "stopped") return state.reason ?? "unknown";
    return null;
  }

  async function runCommand(command: string): Promise<CommandObservation> {
    const page = PAGE_BY_COMMAND[command];
    if (page !== undefined) return runPageCommand(command, page);

    const runtime = await ensureReady();
    stopReason = null;
    reports.length = 0;
    try {
      await runtime.broker.request(PLUGIN_COMMAND_RUN_REQUEST, { id: command });
    } catch {
      // A terminal command stops the Plugin before it can reply; the report, if
      // any, already arrived over the broker.
    }
    // The fixture awaits its report before it answers, so it is already in
    // `reports`; yielding once keeps that ordering from being an assumption.
    await sleep(0);
    const report = reports.find((message) => message.includes(`hostile ${command}`)) ?? "";
    if (stopReason !== null) {
      return { outcome: { kind: "stopped", reason: stopReason, detail: report } };
    }
    if (/ignored/.test(report)) return { outcome: { kind: "ignored", detail: report } };
    if (/refused/.test(report)) return { outcome: { kind: "refused", detail: report } };
    return { outcome: { kind: "escaped", detail: report || "no refusal was reported" } };
  }

  /**
   * Runs one UI Command by mounting its page over the real Remote UI host (the
   * same receiver/thread wiring `usePluginRemoteUi` uses). The host validator
   * reports a violation, and the seam stops the Plugin the way the page boundary
   * does (`lifecycle.stop(id, "remote-ui-limit")`); the reason the check reads is
   * the lifecycle's.
   */
  async function runPageCommand(command: string, page: string): Promise<CommandObservation> {
    const runtime = await ensureReady();
    stopReason = null;
    let violation: PluginUiViolation | null = null;
    const created = createPluginRemoteUi({
      onViolation: (reported) => {
        violation = reported;
      },
    });
    const mount = openPluginUiMount(runtime.broker, page);
    mount.port.start();
    const thread = new ThreadMessagePort(mount.port, {
      exports: {
        mutate: (records: readonly RemoteMutationRecord[]) => created.connection.mutate(records),
        call: (id: string, method: string, ...args: readonly unknown[]) =>
          created.connection.call(id, method, ...args),
      },
    });
    let accepted = false;
    try {
      accepted = await mount.mounted.then(
        () => true,
        () => false
      );
      if (accepted) {
        const deadline = Date.now() + PAGE_SETTLE_MS;
        while (Date.now() < deadline && violation === null && stopReason === null) {
          await sleep(100);
        }
      }
    } finally {
      mount.unmount();
      thread.close();
      created.dispose();
    }

    if (violation !== null) {
      lifecycle.stop(FIXTURE_HOSTILE_ID, "remote-ui-limit");
      const reason = await waitForStop(TERMINAL_BUDGET_MS);
      return {
        outcome: { kind: "stopped", reason, detail: "the host refused the declared interface" },
      };
    }
    if (!accepted) {
      return {
        outcome: { kind: "escaped", detail: "the Plugin did not accept the mount" },
      };
    }
    if (command === "openPanel") {
      const state = lifecycle.state(FIXTURE_HOSTILE_ID);
      if (state?.status === "ready" || state?.status === "unavailable") {
        return {
          outcome: { kind: "mounted", detail: "the panel mounted and the Plugin stayed ready" },
        };
      }
      return {
        outcome: { kind: "escaped", detail: "the panel page did not leave the Plugin ready" },
      };
    }
    return {
      outcome: { kind: "escaped", detail: "the host accepted an interface it should refuse" },
    };
  }

  async function terminal(command: string): Promise<StopObservation> {
    const runtime = await ensureReady();
    stopReason = null;
    void runtime.broker.request(PLUGIN_COMMAND_RUN_REQUEST, { id: command }).catch(() => undefined);
    const reason = await waitForStop(TERMINAL_BUDGET_MS);
    return { reason };
  }

  /**
   * T8's yielding allocation. It resolves when the lifecycle stops the Plugin
   * (with the reason it recorded), or when the Plugin outran `OOM_BUDGET_MS` or
   * `T8_ALLOCATION_CAP_MB` without a stop — the honest `stopped: false` the
   * check reports as `unmeasured`, with the MB the fixture last reported. On
   * giving up it stops the Plugin so the run can continue.
   */
  async function probeOom(): Promise<OomObservation> {
    const runtime = await ensureReady();
    stopReason = null;
    allocatedMb = 0;
    let settled = false;
    void runtime.broker
      .request(PLUGIN_COMMAND_RUN_REQUEST, { id: YIELDING_ALLOCATION_COMMAND })
      .then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        }
      );
    const deadline = Date.now() + OOM_BUDGET_MS;
    while (Date.now() < deadline) {
      const reason = readStopReason();
      if (reason !== null) return { stopped: true, reason, allocatedMb };
      if (settled) {
        // The request settling only means the Worker stopped answering: the
        // lifecycle records its reason just after. Wait a bounded grace for it
        // before reporting the honest "no stop".
        const lateReason = await waitForReasonWithinGrace({
          readReason: readStopReason,
          graceMs: OOM_SETTLE_GRACE_MS,
          now: () => Date.now(),
          sleep,
        });
        if (lateReason !== null) return { stopped: true, reason: lateReason, allocatedMb };
        return { stopped: false, reason: "none", allocatedMb };
      }
      if (allocatedMb >= T8_ALLOCATION_CAP_MB) break;
      await sleep(150);
    }
    lifecycle.stop(FIXTURE_HOSTILE_ID, "requested");
    return { stopped: false, reason: "none", allocatedMb };
  }

  async function probeFrameIpc(): Promise<IpcObservation> {
    return new Promise<IpcObservation>((resolve, reject) => {
      let iframe: HTMLIFrameElement;
      try {
        iframe = document.createElement("iframe");
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      iframe.setAttribute("sandbox", "allow-scripts");
      iframe.setAttribute("aria-hidden", "true");
      iframe.setAttribute("inert", "");
      iframe.style.cssText =
        "position:fixed;left:0;top:0;width:0;height:0;border:0;visibility:hidden";

      const cleanup = () => {
        clearTimeout(timer);
        window.removeEventListener("message", onMessage);
        iframe.remove();
      };
      const onMessage = (event: MessageEvent) => {
        if (event.source !== iframe.contentWindow) return;
        const data = event.data as { __conformanceFrameProbe?: IpcObservation } | null;
        if (!data || typeof data !== "object" || !data.__conformanceFrameProbe) return;
        cleanup();
        resolve(data.__conformanceFrameProbe);
      };
      // A frame that never answers probed nothing: pass, like the prototype.
      const timer = setTimeout(() => {
        cleanup();
        resolve({ reached: false, detail: "the probe frame never answered" });
      }, 10_000);

      window.addEventListener("message", onMessage);
      iframe.srcdoc = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${sandboxCsp()}"></head><body><script>${FRAME_IPC_PROBE}</script></body></html>`;
      document.body.appendChild(iframe);
    });
  }

  async function probeWorkerIpc(): Promise<IpcObservation> {
    const observation = await runCommand("escapeTauriIpc");
    if (observation.outcome.kind === "escaped") {
      return { reached: true, detail: "the Plugin Worker reached Tauri IPC" };
    }
    return {
      reached: false,
      detail:
        observation.outcome.kind === "stopped"
          ? `the Plugin was stopped (${observation.outcome.reason})`
          : observation.outcome.detail,
    };
  }

  return {
    platform,
    engine: readEngine(platform),
    runCommand,
    probeFrameIpc,
    probeWorkerIpc,
    probeHang: () => terminal("escapeBusyLoop"),
    probeAllocate: () => terminal("escapeAllocate"),
    probeOom,
    heartbeat,
    leaks,
    dispose() {
      offChange();
      lifecycle.dispose();
    },
  };
}
