import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastViewport } from "@/components/ui/Toast";
import { APP_VERSION } from "@/constants";
import { PLUGIN_APPROVALS_STORAGE_KEY, savePluginApproval } from "@/features/plugins/approvals";
import { PLUGIN_API_VERSION } from "@/features/plugins/api-table";
import { hashPluginDirectory } from "@/features/plugins/directory-hash";
import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_MISS_LIMIT,
  IDLE_STOP_MS,
  PLUGIN_STOP_MESSAGE_KEYS,
  RESTART_DELAY_MS,
  createPluginLifecycle,
  getPluginLifecycle,
  installPluginLifecycle,
  pluginStoppedMessage,
  resetPluginLifecycleForTests,
} from "@/features/plugins/lifecycle";
import { STARTUP_TIMEOUT_MS } from "@/features/plugins/runtime";
import type {
  PluginApiHandlers,
  PluginDataVersions,
  PluginFolder,
  PluginLifecycle,
  PluginLifecycleChange,
  PluginLifecycleStopReason,
  PluginManifest,
} from "@/features/plugins/types";
import type { DatabaseAdapter, PluginDirectoryAdapter } from "@/lib/platform/types";
import {
  activateTutorialDatabase,
  resetLibrarySwitchForTests,
} from "@/features/tutorial/library-switch";
import i18n from "@/i18n";
import {
  fakePluginFrame,
  installMicrotaskMessageChannel,
  pluginFolder,
  type FakePluginFrame,
} from "@/test/support/plugin-fixtures";

// jsdom's MessagePort delivers on a task the fake timers do not control; a real
// macrotask flush lets each broker round trip land while timers stay fake.
const realSetTimeout = globalThis.setTimeout;

function flushTasks(): Promise<void> {
  return new Promise((resolve) => realSetTimeout(resolve, 0));
}

/** Runs the fake timers and lets every message round trip land. */
async function advance(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await flushTasks();
  // A callback scheduled while the microtasks above ran fires in this pass.
  await vi.advanceTimersByTimeAsync(0);
  await flushTasks();
}

function makePlugin(id: string, overrides: Partial<PluginManifest> = {}): PluginFolder {
  return pluginFolder({}, { id, name: id, ...overrides });
}

interface HarnessOptions {
  /** Folders that are approved (enabled). */
  approved?: PluginFolder[];
  /** Folders in the Plugin Directory that are not approved (disabled). */
  disabled?: PluginFolder[];
  /** Stored dataVersion per plugin id. */
  data?: Record<string, number>;
  /** Overrides the dataVersion store per method; unspecified methods keep the in-memory map. */
  dataVersions?: Partial<PluginDataVersions>;
  whenLaunchSettled?: () => Promise<void>;
  configureFrame?: (frame: FakePluginFrame, manifest: PluginManifest) => void;
  /** Frames that do not signal ready by themselves. */
  deferReady?: boolean;
  stopMessage?: (name: string, reason: PluginLifecycleStopReason) => string | null;
  /** Method handlers; omitted leaves the lifecycle's own default wiring. */
  handlers?: (manifest: PluginManifest) => PluginApiHandlers;
  isLibraryAvailable?: () => boolean;
}

async function createHarness(options: HarnessOptions = {}) {
  const folders = new Map<string, PluginFolder>();
  for (const folder of options.disabled ?? []) folders.set(folder.name, folder);
  for (const folder of options.approved ?? []) {
    folders.set(folder.name, folder);
    savePluginApproval({
      pluginId: folder.name,
      pinnedHash: await hashPluginDirectory(folder.files),
      granted: [],
    });
  }

  const frames: { pluginId: string; frame: FakePluginFrame }[] = [];
  const dataVersions = new Map<string, number>(Object.entries(options.data ?? {}));
  const directory: PluginDirectoryAdapter & {
    listFolders: ReturnType<typeof vi.fn>;
    readFolder: ReturnType<typeof vi.fn>;
  } = {
    listFolders: vi.fn(async () => [...folders.keys()]),
    readFolder: vi.fn(async (name: string) => folders.get(name) ?? null),
  };

  const lifecycle = createPluginLifecycle({
    directory,
    createFrame: (_document, manifest) => {
      const frame = fakePluginFrame(options.deferReady ? { ready: false } : {});
      options.configureFrame?.(frame, manifest);
      frames.push({ pluginId: manifest.id, frame });
      return frame;
    },
    handlers: options.handlers,
    scheduleIdle: (work) => setTimeout(work, 0),
    isLibraryAvailable: options.isLibraryAvailable,
    whenLaunchSettled: options.whenLaunchSettled ?? (async () => undefined),
    dataVersions: {
      get: options.dataVersions?.get ?? (async (pluginId) => dataVersions.get(pluginId) ?? null),
      set:
        options.dataVersions?.set ??
        (async (pluginId, version) => {
          dataVersions.set(pluginId, version);
        }),
    },
    stopMessage: options.stopMessage,
  });

  const changes: PluginLifecycleChange[] = [];
  lifecycle.subscribe((change) => changes.push(change));
  harnesses.push(lifecycle);

  return {
    lifecycle,
    directory,
    changes,
    dataVersions,
    framesFor(pluginId: string): FakePluginFrame[] {
      return frames.filter((entry) => entry.pluginId === pluginId).map((entry) => entry.frame);
    },
    frameCount(): number {
      return frames.length;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  restoreMessageChannel = installMicrotaskMessageChannel();
});

let restoreMessageChannel: () => void;
const harnesses: PluginLifecycle[] = [];

afterEach(() => {
  // Stop every timer the state machine owns, then let the toasts auto-dismiss
  // so the shared store starts the next test empty.
  for (const lifecycle of harnesses.splice(0)) lifecycle.dispose();
  act(() => {
    vi.runAllTimers();
  });
  restoreMessageChannel?.();
  vi.useRealTimers();
  localStorage.removeItem(PLUGIN_APPROVALS_STORAGE_KEY);
  resetLibrarySwitchForTests();
  resetPluginLifecycleForTests();
});

type Harness = Awaited<ReturnType<typeof createHarness>>;

/**
 * Launches and lets every persistent start run. A persistent start waits for
 * an idle callback, so it needs a timer pass before `launch()` can resolve.
 */
async function launchAll(h: Harness): Promise<void> {
  const launching = h.lifecycle.launch();
  await advance(0);
  await launching;
  await advance(0);
}

describe("Plugin lifecycle: launch", () => {
  it("creates zero frames and zero Workers for disabled and on-demand Plugins at launch", async () => {
    const onDemand = makePlugin("warm-page", { lifecycle: "on-demand" });
    const disabled = makePlugin("off-one");
    const disabledOnDemand = makePlugin("off-two", { lifecycle: "on-demand" });
    const h = await createHarness({
      approved: [onDemand],
      disabled: [disabled, disabledOnDemand],
    });

    await launchAll(h);

    expect(h.frameCount()).toBe(0);
    expect(h.lifecycle.installed().map((plugin) => plugin.pluginId)).toEqual(["warm-page"]);
    expect(h.directory.readFolder).toHaveBeenCalledTimes(1);
    expect(h.directory.readFolder).toHaveBeenCalledWith("warm-page");
    expect(h.lifecycle.state("warm-page")).toEqual({
      status: "stopped",
      reason: null,
      refusal: null,
    });
  });

  it("starts persistent Plugins one at a time in idle time", async () => {
    const h = await createHarness({
      approved: [makePlugin("alpha"), makePlugin("beta")],
      deferReady: true,
    });

    const launching = h.lifecycle.launch();
    await advance(0);
    expect(h.framesFor("alpha")).toHaveLength(1);
    expect(h.framesFor("beta")).toHaveLength(0);

    h.framesFor("alpha")[0].signalReady();
    await advance(0);
    expect(h.framesFor("beta")).toHaveLength(1);

    h.framesFor("beta")[0].signalReady();
    await launching;
    await advance(0);

    expect(h.lifecycle.state("alpha")).toEqual({ status: "ready", startReason: "launch" });
    expect(h.lifecycle.state("beta")).toEqual({ status: "ready", startReason: "launch" });
  });

  it("waits for the Library, the launch Auto Sync, and the launch Backup before scanning", async () => {
    let settleLaunch!: () => void;
    const gate = new Promise<void>((resolve) => {
      settleLaunch = resolve;
    });
    const h = await createHarness({
      approved: [makePlugin("alpha")],
      whenLaunchSettled: () => gate,
    });

    const launching = h.lifecycle.launch();
    await advance(0);
    expect(h.directory.listFolders).not.toHaveBeenCalled();
    expect(h.frameCount()).toBe(0);

    settleLaunch();
    await advance(0);
    await advance(0);
    await launching;
    expect(h.framesFor("alpha")).toHaveLength(1);
  });
});

describe("Plugin lifecycle: host wiring defaults", () => {
  it("uses the host handlers: a Plugin notification becomes a toast", async () => {
    const h = await createHarness({ approved: [makePlugin("alpha")] });
    render(<ToastViewport />);
    await launchAll(h);

    await expect(
      h.framesFor("alpha")[0].call("notifications.show", { variant: "info", message: "hello" })
    ).resolves.toBeNull();
    await advance(0);

    expect(screen.getByRole("status")).toHaveTextContent("alpha: hello");
  });

  it("keeps Library rows refused while the Tutorial Library is active (ADR 0008)", async () => {
    activateTutorialDatabase({} as DatabaseAdapter);
    const h = await createHarness({
      approved: [makePlugin("alpha")],
      handlers: () => ({ "storage.get": vi.fn(async () => "value") }),
    });
    await launchAll(h);

    await expect(h.framesFor("alpha")[0].call("storage.get", { key: "a" })).rejects.toMatchObject({
      code: "library-unavailable",
    });
  });
});

describe("Plugin lifecycle: on-demand warm start and idle stop", () => {
  it("warm-starts an on-demand Plugin when a surface is reached and marks the startReason", async () => {
    const h = await createHarness({
      approved: [makePlugin("warm-page", { lifecycle: "on-demand" })],
    });
    await h.lifecycle.launch();
    expect(h.frameCount()).toBe(0);

    h.lifecycle.surfaceReached("warm-page", "page:report");
    await advance(0);

    expect(h.framesFor("warm-page")).toHaveLength(1);
    expect(h.lifecycle.state("warm-page")).toEqual({ status: "ready", startReason: "warmStart" });
    expect(h.changes.map((change) => change.state.status)).toContain("starting");
    expect(h.changes.find((change) => change.state.status === "starting")?.state).toEqual({
      status: "starting",
      startReason: "warmStart",
    });
  });

  it("warm-starts an on-demand Plugin whose surface was reached before the scan finished", async () => {
    const h = await createHarness({
      approved: [makePlugin("warm-page", { lifecycle: "on-demand" })],
    });
    h.lifecycle.surfaceReached("warm-page", "page:report");

    await h.lifecycle.launch();
    await advance(0);

    expect(h.framesFor("warm-page")).toHaveLength(1);
    expect(h.lifecycle.state("warm-page")).toEqual({ status: "ready", startReason: "warmStart" });
  });

  it("stops after five minutes with no reachable surface and no calls", async () => {
    const h = await createHarness({
      approved: [makePlugin("warm-page", { lifecycle: "on-demand" })],
    });
    await h.lifecycle.launch();
    h.lifecycle.surfaceReached("warm-page", "page:report");
    await advance(0);

    h.lifecycle.surfaceLeft("warm-page", "page:report");
    await advance(IDLE_STOP_MS - 1_000);
    expect(h.lifecycle.state("warm-page")?.status).toBe("ready");

    await advance(1_000);
    expect(h.lifecycle.state("warm-page")).toEqual({
      status: "stopped",
      reason: "idle",
      refusal: null,
    });
    expect(h.framesFor("warm-page")[0].stopped).toBe(true);
  });

  it("restarts the idle window on a call", async () => {
    const h = await createHarness({
      approved: [makePlugin("warm-page", { lifecycle: "on-demand" })],
    });
    await h.lifecycle.launch();
    h.lifecycle.surfaceReached("warm-page", "page:report");
    await advance(0);
    const frame = h.framesFor("warm-page")[0];
    h.lifecycle.surfaceLeft("warm-page", "page:report");

    await advance(IDLE_STOP_MS - 60_000);
    await expect(frame.call("health.check")).rejects.toBeTruthy();
    await advance(IDLE_STOP_MS - 60_000);
    expect(h.lifecycle.state("warm-page")?.status).toBe("ready");

    await advance(60_000);
    expect(h.lifecycle.state("warm-page")?.status).toBe("stopped");
  });

  it("does not warm-start an on-demand Plugin again after a limit stop", async () => {
    const h = await createHarness({
      approved: [makePlugin("warm-page", { lifecycle: "on-demand" })],
    });
    await h.lifecycle.launch();
    h.lifecycle.surfaceReached("warm-page", "page:report");
    await advance(0);
    h.framesFor("warm-page")[0].signalError("boom");
    await advance(0);
    expect(h.lifecycle.state("warm-page")).toEqual({
      status: "stopped",
      reason: "crashed",
      refusal: null,
    });

    h.lifecycle.surfaceReached("warm-page", "page:report");
    await advance(0);
    expect(h.framesFor("warm-page")).toHaveLength(1);

    // Restart in Settings is explicit and still works.
    await h.lifecycle.start("warm-page", "enable");
    await advance(0);
    await advance(0);
    expect(h.framesFor("warm-page")).toHaveLength(2);
    expect(h.lifecycle.state("warm-page")).toEqual({ status: "ready", startReason: "enable" });
  });
});

describe("Plugin lifecycle: heartbeat", () => {
  it("marks a Plugin unavailable on the first missed beat and stops it on the fifth", async () => {
    const h = await createHarness({ approved: [makePlugin("alpha")] });
    render(<ToastViewport />);
    await launchAll(h);
    const frame = h.framesFor("alpha")[0];
    frame.holdAnswers = true;

    await advance(HEARTBEAT_INTERVAL_MS);
    expect(h.lifecycle.state("alpha")?.status).toBe("ready");

    await advance(HEARTBEAT_INTERVAL_MS);
    expect(h.lifecycle.state("alpha")).toEqual({
      status: "unavailable",
      startReason: "launch",
      heartbeatMisses: 1,
    });

    await advance(HEARTBEAT_INTERVAL_MS * (HEARTBEAT_MISS_LIMIT - 1));
    expect(h.lifecycle.state("alpha")).toEqual({
      status: "stopped",
      reason: "unresponsive",
      refusal: null,
    });
    expect(frame.stopped).toBe(true);
    expect(screen.getByRole("status")).toHaveTextContent(
      "alpha stopped responding and was closed."
    );
  });

  it("returns to ready when a held beat finally answers", async () => {
    const h = await createHarness({ approved: [makePlugin("alpha")] });
    await launchAll(h);
    const frame = h.framesFor("alpha")[0];
    frame.holdAnswers = true;

    await advance(HEARTBEAT_INTERVAL_MS * 3);
    expect(h.lifecycle.state("alpha")?.status).toBe("unavailable");

    frame.answerHeldRequests();
    await advance(0);
    expect(h.lifecycle.state("alpha")).toEqual({ status: "ready", startReason: "launch" });
  });
});

describe("Plugin lifecycle: stop reasons", () => {
  it("stops a Plugin whose broker throttled it", async () => {
    const h = await createHarness({ approved: [makePlugin("alpha")] });
    await launchAll(h);

    h.lifecycle.runtime("alpha")?.broker.stop("throttled");
    await advance(0);

    expect(h.lifecycle.state("alpha")).toEqual({
      status: "stopped",
      reason: "throttled",
      refusal: null,
    });
  });

  it("stops with the Remote UI limit reason and toasts it", async () => {
    const h = await createHarness({ approved: [makePlugin("alpha")] });
    render(<ToastViewport />);
    await launchAll(h);

    h.lifecycle.stop("alpha", "remote-ui-limit");
    await advance(0);

    expect(h.lifecycle.state("alpha")).toEqual({
      status: "stopped",
      reason: "remote-ui-limit",
      refusal: null,
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "alpha sent too much interface data and was stopped."
    );
  });

  it("classifies a Worker out-of-memory error as out-of-memory", async () => {
    const h = await createHarness({ approved: [makePlugin("alpha")] });
    render(<ToastViewport />);
    await launchAll(h);

    h.framesFor("alpha")[0].signalError("RangeError: Array buffer allocation failed");
    await advance(0);

    expect(h.lifecycle.state("alpha")).toEqual({
      status: "stopped",
      reason: "out-of-memory",
      refusal: null,
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "alpha used too much memory and was stopped."
    );
  });

  it("stops silently when requested", async () => {
    const h = await createHarness({ approved: [makePlugin("alpha")] });
    render(<ToastViewport />);
    await launchAll(h);

    h.lifecycle.stop("alpha");
    await advance(0);

    expect(h.lifecycle.state("alpha")).toEqual({
      status: "stopped",
      reason: "requested",
      refusal: null,
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("stops a Plugin that missed the startup limit, with the startup reason", async () => {
    const h = await createHarness({ approved: [makePlugin("slow")], deferReady: true });
    render(<ToastViewport />);
    const launching = h.lifecycle.launch();
    await advance(0);
    expect(h.lifecycle.state("slow")).toEqual({ status: "starting", startReason: "launch" });

    await advance(STARTUP_TIMEOUT_MS);

    expect(h.lifecycle.state("slow")).toEqual({
      status: "stopped",
      reason: "startup-timeout",
      refusal: { code: "startup-timeout" },
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "slow took too long to start and was stopped."
    );
    await launching;
  });
});

describe("Plugin lifecycle: persistent restart-once", () => {
  it("restarts a persistent Plugin automatically once per session after a limit stop", async () => {
    const h = await createHarness({ approved: [makePlugin("alpha")] });
    await launchAll(h);

    h.framesFor("alpha")[0].signalError("boom");
    await advance(0);
    expect(h.lifecycle.state("alpha")).toEqual({
      status: "stopped",
      reason: "crashed",
      refusal: null,
    });

    await advance(RESTART_DELAY_MS);
    expect(h.framesFor("alpha")).toHaveLength(2);
    expect(h.lifecycle.state("alpha")).toEqual({ status: "ready", startReason: "restart" });

    // A second stop stays stopped until an explicit Restart.
    h.framesFor("alpha")[1].signalError("boom again");
    await advance(0);
    expect(h.lifecycle.state("alpha")).toEqual({
      status: "stopped",
      reason: "crashed",
      refusal: null,
    });
    await advance(RESTART_DELAY_MS * 2);
    expect(h.framesFor("alpha")).toHaveLength(2);
  });

  it("cancels a pending automatic restart when stopped explicitly again", async () => {
    const h = await createHarness({ approved: [makePlugin("alpha")] });
    await launchAll(h);
    expect(h.frameCount()).toBe(1);

    h.lifecycle.stop("alpha", "crashed");
    await advance(0);
    expect(h.lifecycle.state("alpha")).toEqual({
      status: "stopped",
      reason: "crashed",
      refusal: null,
    });

    // The author's stop lands while the automatic restart is still pending:
    // it must cancel the timer and record the intent.
    h.lifecycle.stop("alpha");
    await advance(0);
    expect(h.lifecycle.state("alpha")).toEqual({
      status: "stopped",
      reason: "requested",
      refusal: null,
    });

    await advance(RESTART_DELAY_MS);
    expect(h.framesFor("alpha")).toHaveLength(1);
    expect(h.lifecycle.state("alpha")).toEqual({
      status: "stopped",
      reason: "requested",
      refusal: null,
    });
  });
});

describe("Plugin lifecycle: dataVersion gate", () => {
  it("runs migrateData once when the stored version is lower, then records the new version", async () => {
    const migrations: unknown[] = [];
    const h = await createHarness({
      approved: [makePlugin("alpha", { dataVersion: 2 })],
      data: { alpha: 1 },
      configureFrame: (frame) => {
        frame.hostRequestAnswer = async (method, params) => {
          if (method === "migrateData") {
            migrations.push(params);
            return null;
          }
          return "pong";
        };
      },
    });

    await launchAll(h);

    expect(migrations).toEqual([{ from: 1 }]);
    expect(h.dataVersions.get("alpha")).toBe(2);
    expect(
      h.framesFor("alpha")[0].requests.filter((method) => method === "migrateData")
    ).toHaveLength(1);
    expect(h.lifecycle.state("alpha")).toEqual({ status: "ready", startReason: "launch" });
  });

  it("leaves the data untouched and refuses activation when migrateData throws", async () => {
    const h = await createHarness({
      approved: [makePlugin("alpha", { dataVersion: 2 })],
      data: { alpha: 1 },
      configureFrame: (frame) => {
        frame.hostRequestAnswer = async (method) => {
          if (method === "migrateData") throw { code: "internal-error", message: "bad data" };
          return "pong";
        };
      },
    });

    await launchAll(h);

    expect(h.lifecycle.state("alpha")).toEqual({
      status: "stopped",
      reason: null,
      refusal: { code: "migration-failed", from: 1, message: "bad data" },
    });
    expect(h.dataVersions.get("alpha")).toBe(1);
    expect(h.framesFor("alpha")[0].stopped).toBe(true);
  });

  it("preserves data and refuses activation before any frame when the stored version is higher", async () => {
    const h = await createHarness({
      approved: [makePlugin("alpha", { dataVersion: 2 })],
      data: { alpha: 3 },
    });

    await launchAll(h);

    expect(h.frameCount()).toBe(0);
    expect(h.lifecycle.state("alpha")).toEqual({
      status: "stopped",
      reason: null,
      refusal: { code: "data-newer", stored: 3, manifest: 2 },
    });
    expect(h.dataVersions.get("alpha")).toBe(3);
  });

  it("starts normally without migrating when the stored version is equal", async () => {
    const h = await createHarness({
      approved: [makePlugin("alpha", { dataVersion: 2 })],
      data: { alpha: 2 },
    });

    await launchAll(h);

    expect(h.lifecycle.state("alpha")).toEqual({ status: "ready", startReason: "launch" });
    expect(h.framesFor("alpha")[0].requests).not.toContain("migrateData");
    expect(h.dataVersions.get("alpha")).toBe(2);
  });

  it("records the manifest version when the namespace has no data yet", async () => {
    const h = await createHarness({ approved: [makePlugin("alpha", { dataVersion: 4 })] });

    await launchAll(h);

    expect(h.lifecycle.state("alpha")).toEqual({ status: "ready", startReason: "launch" });
    expect(h.framesFor("alpha")[0].requests).not.toContain("migrateData");
    expect(h.dataVersions.get("alpha")).toBe(4);
  });

  it("stops a hung migrateData within the startup limit, leaving data and version untouched", async () => {
    const h = await createHarness({
      approved: [makePlugin("alpha", { dataVersion: 2 })],
      data: { alpha: 1 },
      configureFrame: (frame) => {
        frame.hostRequestAnswer = async (method) => {
          if (method === "migrateData") return new Promise(() => {});
          return "pong";
        };
      },
    });
    render(<ToastViewport />);

    const launching = h.lifecycle.launch();
    await advance(0);
    expect(h.lifecycle.state("alpha")).toEqual({ status: "starting", startReason: "launch" });
    expect(h.framesFor("alpha")[0].requests).toContain("migrateData");

    await advance(STARTUP_TIMEOUT_MS);

    expect(h.lifecycle.state("alpha")).toEqual({
      status: "stopped",
      reason: "startup-timeout",
      refusal: { code: "startup-timeout" },
    });
    expect(h.dataVersions.get("alpha")).toBe(1);
    expect(h.framesFor("alpha")[0].stopped).toBe(true);
    expect(screen.getByRole("status")).toHaveTextContent(
      "alpha took too long to start and was stopped."
    );
    await launching;
  });

  it("stops with crashed when the Worker errors while migrateData runs", async () => {
    const h = await createHarness({
      approved: [makePlugin("alpha", { dataVersion: 2 })],
      data: { alpha: 1 },
      configureFrame: (frame) => {
        frame.hostRequestAnswer = async (method) => {
          if (method === "migrateData") return new Promise(() => {});
          return "pong";
        };
      },
    });

    const launching = h.lifecycle.launch();
    await advance(0);
    expect(h.framesFor("alpha")[0].requests).toContain("migrateData");

    h.framesFor("alpha")[0].signalError("boom");
    await advance(0);

    expect(h.lifecycle.state("alpha")).toEqual({
      status: "stopped",
      reason: "crashed",
      refusal: null,
    });
    expect(h.dataVersions.get("alpha")).toBe(1);
    expect(h.framesFor("alpha")[0].stopped).toBe(true);
    await launching;
  });

  it("refuses without a frame when the stored dataVersion cannot be read", async () => {
    const h = await createHarness({
      approved: [makePlugin("alpha")],
      dataVersions: {
        get: async () => {
          throw new Error("db locked");
        },
      },
    });

    await launchAll(h);

    expect(h.frameCount()).toBe(0);
    expect(h.lifecycle.state("alpha")).toEqual({
      status: "stopped",
      reason: null,
      refusal: { code: "data-version-unavailable", message: "db locked" },
    });
  });

  it("refuses and stops the frame when the dataVersion record cannot be written", async () => {
    const h = await createHarness({
      approved: [makePlugin("alpha")],
      dataVersions: {
        set: async () => {
          throw new Error("db locked");
        },
      },
    });

    await launchAll(h);

    expect(h.lifecycle.state("alpha")).toEqual({
      status: "stopped",
      reason: null,
      refusal: { code: "data-version-unavailable", message: "db locked" },
    });
    expect(h.framesFor("alpha")).toHaveLength(1);
    expect(h.framesFor("alpha")[0].stopped).toBe(true);
  });

  it("starts the next persistent Plugin after one fails to record its dataVersion", async () => {
    const stored = new Map<string, number>();
    const h = await createHarness({
      approved: [makePlugin("alpha"), makePlugin("beta")],
      dataVersions: {
        get: async (pluginId) => stored.get(pluginId) ?? null,
        set: async (pluginId, version) => {
          if (pluginId === "alpha") throw new Error("db locked");
          stored.set(pluginId, version);
        },
      },
    });

    await launchAll(h);

    expect(h.lifecycle.state("alpha")).toEqual({
      status: "stopped",
      reason: null,
      refusal: { code: "data-version-unavailable", message: "db locked" },
    });
    expect(h.lifecycle.state("beta")).toEqual({ status: "ready", startReason: "launch" });
    expect(stored.get("beta")).toBe(1);
  });
});

describe("Plugin lifecycle: compatibility gate", () => {
  it("refuses a manifest that wants a newer Plugin API and never warm-starts it", async () => {
    const h = await createHarness({
      approved: [
        makePlugin("warm-page", { lifecycle: "on-demand", apiVersion: "^9.0" }),
      ],
      data: { "warm-page": 1 },
    });

    await h.lifecycle.launch();
    h.lifecycle.surfaceReached("warm-page", "page:report");
    await advance(0);

    expect(h.frameCount()).toBe(0);
    expect(h.dataVersions.get("warm-page")).toBe(1);
    expect(h.lifecycle.state("warm-page")).toEqual({
      status: "stopped",
      reason: null,
      refusal: {
        code: "incompatible",
        compatibility: {
          verdict: "needs-newer-app",
          reason: "api-version",
          message: `Needs Plugin API ^9.0; this app provides ${PLUGIN_API_VERSION}`,
        },
      },
    });

    // A surface reached later must not warm-start a refused Plugin.
    h.lifecycle.surfaceReached("warm-page", "page:report");
    await advance(0);
    expect(h.frameCount()).toBe(0);
  });

  it("refuses a manifest built for an older Plugin API", async () => {
    const h = await createHarness({
      approved: [makePlugin("alpha", { apiVersion: "^0.0.1" })],
    });

    await launchAll(h);

    expect(h.frameCount()).toBe(0);
    expect(h.lifecycle.state("alpha")).toEqual({
      status: "stopped",
      reason: null,
      refusal: {
        code: "incompatible",
        compatibility: {
          verdict: "older-api",
          reason: "api-version",
          message: `Built for Plugin API ^0.0.1; this app provides ${PLUGIN_API_VERSION}`,
        },
      },
    });
  });

  it("refuses a manifest whose minAppVersion is newer than this app", async () => {
    const h = await createHarness({
      approved: [makePlugin("alpha", { minAppVersion: "999.0.0" })],
    });

    await launchAll(h);

    expect(h.frameCount()).toBe(0);
    expect(h.lifecycle.state("alpha")).toEqual({
      status: "stopped",
      reason: null,
      refusal: {
        code: "incompatible",
        compatibility: {
          verdict: "needs-newer-app",
          reason: "min-app-version",
          message: `Needs Maibuk 999.0.0 or newer; this app is ${APP_VERSION}`,
        },
      },
    });
  });

  it("starts a compatible manifest normally", async () => {
    const h = await createHarness({
      approved: [makePlugin("alpha", { apiVersion: "^0.1", minAppVersion: "0.1.0" })],
    });

    await launchAll(h);

    expect(h.lifecycle.state("alpha")).toEqual({ status: "ready", startReason: "launch" });
  });
});

describe("Plugin lifecycle: dev timing marks", () => {
  it("marks the host-side work of one activation", async () => {
    const marks: string[] = [];
    const measures: string[] = [];
    const timing = performance as unknown as Record<string, unknown>;
    const hadMark = "mark" in timing;
    const hadMeasure = "measure" in timing;
    timing.mark = (name: string) => marks.push(name);
    timing.measure = (name: string) => measures.push(name);
    try {
      const h = await createHarness({ approved: [makePlugin("alpha")] });
      await launchAll(h);

      expect(marks).toEqual([
        "plugin.start:alpha:begin",
        "plugin.start:alpha:handshake",
        "plugin.start:alpha:ready",
      ]);
      expect(measures).toEqual([
        "plugin.start.host:alpha",
        "plugin.start:alpha",
        "plugin.start.gate:alpha",
      ]);
    } finally {
      // jsdom has no User Timing; drop what this test added.
      if (!hadMark) delete timing.mark;
      if (!hadMeasure) delete timing.measure;
    }
  });
});

describe("Plugin lifecycle: stop toasts", () => {
  it("has every stop message in both locales, naming the Plugin", () => {
    for (const key of Object.values(PLUGIN_STOP_MESSAGE_KEYS)) {
      for (const lng of ["en", "es"] as const) {
        expect(i18n.exists(key, { lng })).toBe(true);
        expect(i18n.t(key, { lng, name: "Echoes" })).toContain("Echoes");
      }
    }
  });

  it("is silent for the normal lifecycle stops", () => {
    expect(pluginStoppedMessage("Echoes", "requested")).toBeNull();
    expect(pluginStoppedMessage("Echoes", "idle")).toBeNull();
  });

  it("localizes a stop in Spanish", async () => {
    expect(pluginStoppedMessage("Echoes", "unresponsive")).toContain("stopped responding");
    await i18n.changeLanguage("es");
    try {
      expect(pluginStoppedMessage("Echoes", "unresponsive")).toBe(
        "Echoes dejó de responder y se cerró."
      );
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});

describe("installPluginLifecycle()", () => {
  it("installs one lifecycle and resets it for tests", async () => {
    const directory: PluginDirectoryAdapter = {
      listFolders: async () => [],
      readFolder: async () => null,
    };
    const installed = installPluginLifecycle({
      directory,
      whenLaunchSettled: async () => undefined,
    });
    expect(getPluginLifecycle()).toBe(installed);
    expect(installPluginLifecycle({ directory })).toBe(installed);
    resetPluginLifecycleForTests();
    expect(getPluginLifecycle()).toBeNull();
  });
});

describe("Plugin lifecycle: dispose", () => {
  it("stops every running Plugin and clears the state", async () => {
    const h = await createHarness({ approved: [makePlugin("alpha")] });
    await launchAll(h);
    const frame = h.framesFor("alpha")[0];

    h.lifecycle.dispose();

    expect(frame.stopped).toBe(true);
    expect(h.lifecycle.state("alpha")).toBeNull();
    expect(h.lifecycle.installed()).toEqual([]);
  });
});

// Guards the exported idle constant against an accidental edit: the five
// minutes come from the performance decision (#401).
describe("Plugin lifecycle constants", () => {
  it("keeps the decision's windows", () => {
    expect(HEARTBEAT_INTERVAL_MS).toBe(1_000);
    expect(HEARTBEAT_MISS_LIMIT).toBe(5);
    expect(IDLE_STOP_MS).toBe(5 * 60_000);
    expect(STARTUP_TIMEOUT_MS).toBe(10_000);
  });
});
