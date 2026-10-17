import { PLUGIN_UI_NODE_LIMIT_MARKER } from "@/plugin-sdk/ui-node-limit";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { createRichTextExtensions } from "@/components/editor/extensions/createRichTextExtensions";
import { buildPlainTextMap, pmToPlainOffset } from "@/components/editor/plain-text-offsets";
import { ToastViewport } from "@/components/ui/Toast";
import { APP_VERSION } from "@/constants";
import { PLUGIN_APPROVALS_STORAGE_KEY, savePluginApproval } from "@/features/plugins/approvals";
import { PLUGIN_API_VERSION } from "@/features/plugins/api-table";
import { hashPluginDirectory } from "@/features/plugins/directory-hash";
import {
  EDITOR_CONTENT_EVENT_MS,
  registerPluginEditor,
  requestEditorReveal,
  resetPluginEditorHostForTests,
  setPluginEditorHighlights,
} from "@/features/plugins/editor-host";
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
import { isToolbarPressed, setToolbarPressed } from "@/features/plugins/toolbar-pressed";
import { cancelBulkReplace, emitChange, prepareBulkReplace } from "@/features/sync/change-feed";
import type {
  BuiltInPluginSource,
  PluginApiHandlers,
  PluginDataVersions,
  PluginFolder,
  PluginLifecycle,
  PluginLifecycleChange,
  PluginLifecycleStopReason,
  PluginManifest,
  PluginPermissionId,
} from "@/features/plugins/types";
import type { DatabaseAdapter, PluginDirectoryAdapter } from "@/lib/platform/types";
import {
  activateTutorialDatabase,
  resetLibrarySwitchForTests,
} from "@/features/tutorial/library-switch";
import i18n from "@/i18n";
import {
  PLUGIN_MANIFEST,
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

/**
 * A pass ceiling well above any real start (the pinned-hash digests, the broker
 * round trips, and one idle callback per persistent Plugin all land in a
 * handful of passes). If the ceiling is reached the helper throws a clear error
 * instead of letting the test run into the suite timeout.
 */
const MAX_ADVANCE_PASSES = 1_000;

/**
 * Advances until `condition` holds. A fixed pass count is not enough for work
 * the fake timers do not control: Web Crypto hashing inside `startPlugin`
 * settles on the real event loop, and a start that finishes late schedules its
 * next fake `setTimeout(0)` idle callback, which then needs one more pass.
 */
async function advanceUntil(condition: () => boolean, what: string): Promise<void> {
  for (let pass = 0; pass < MAX_ADVANCE_PASSES && !condition(); pass += 1) {
    await advance(0);
  }
  if (!condition()) {
    throw new Error(`${what} was not reached within ${MAX_ADVANCE_PASSES} timer passes`);
  }
}

/**
 * Advances until `work` settles, then rethrows its rejection. The same reason
 * as `advanceUntil`: real async work can finish after any fixed number of
 * passes, so the wait must be driven by the promise itself.
 */
async function advanceUntilSettled(work: Promise<unknown>, what: string): Promise<void> {
  const outcome: { settled: boolean; error?: unknown } = { settled: false };
  void work.then(
    () => {
      outcome.settled = true;
    },
    (error: unknown) => {
      outcome.settled = true;
      outcome.error = error;
    }
  );
  for (let pass = 0; pass < MAX_ADVANCE_PASSES && !outcome.settled; pass += 1) {
    await advance(0);
  }
  if (!outcome.settled) {
    throw new Error(`${what} did not settle within ${MAX_ADVANCE_PASSES} timer passes`);
  }
  if (outcome.error !== undefined) throw outcome.error;
}

function makePlugin(id: string, overrides: Partial<PluginManifest> = {}): PluginFolder {
  return pluginFolder({}, { id, name: id, ...overrides });
}

interface HarnessOptions {
  /** Folders that are approved (enabled). */
  approved?: PluginFolder[];
  /** Folders in the Plugin Directory that are not approved (disabled). */
  disabled?: PluginFolder[];
  /** Folders whose approval record is disabled: installed, but off. */
  disabledApprovals?: PluginFolder[];
  /** Folders whose approval pins a stale hash: installed, but the files changed. */
  changed?: PluginFolder[];
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
  /** Plugin Permissions granted at approval; defaults to none. */
  granted?: PluginPermissionId[];
  /** Overrides the shipped Built-in source; unspecified ships none. */
  builtInSource?: BuiltInPluginSource;
}

async function createHarness(options: HarnessOptions = {}) {
  const folders = new Map<string, PluginFolder>();
  for (const folder of options.disabled ?? []) folders.set(folder.name, folder);
  for (const folder of options.disabledApprovals ?? []) {
    folders.set(folder.name, folder);
    savePluginApproval({
      pluginId: folder.name,
      pinnedHash: await hashPluginDirectory(folder.files),
      granted: options.granted ?? [],
      enabled: false,
      approvedVersion: "",
      approvedPermissions: { required: [], optional: [] },
      approvedFiles: {},
    });
  }
  for (const folder of options.changed ?? []) {
    folders.set(folder.name, folder);
    // A pin that does not match the folder's current hash: the copy changed.
    savePluginApproval({
      pluginId: folder.name,
      pinnedHash: "h1:stale",
      granted: options.granted ?? [],
      enabled: true,
      approvedVersion: "",
      approvedPermissions: { required: [], optional: [] },
      approvedFiles: {},
    });
  }
  for (const folder of options.approved ?? []) {
    folders.set(folder.name, folder);
    savePluginApproval({
      pluginId: folder.name,
      pinnedHash: await hashPluginDirectory(folder.files),
      granted: options.granted ?? [],
      enabled: true,
      approvedVersion: "",
      approvedPermissions: { required: [], optional: [] },
      approvedFiles: {},
    });
  }

  const frames: { pluginId: string; frame: FakePluginFrame }[] = [];
  const dataVersions = new Map<string, number>(Object.entries(options.data ?? {}));
  const directory: PluginDirectoryAdapter & {
    listFolders: ReturnType<typeof vi.fn>;
    readFolder: ReturnType<typeof vi.fn>;
  } = {
    kind: "web",
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
    builtInSource: options.builtInSource,
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
  resetPluginEditorHostForTests();
  for (const lifecycle of harnesses.splice(0)) lifecycle.dispose();
  act(() => {
    vi.runAllTimers();
  });
  restoreMessageChannel?.();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  localStorage.removeItem(PLUGIN_APPROVALS_STORAGE_KEY);
  resetLibrarySwitchForTests();
  resetPluginLifecycleForTests();
});

type Harness = Awaited<ReturnType<typeof createHarness>>;

/**
 * Launches and lets every persistent start run. A persistent start waits for
 * an idle callback, so the wait is driven until `launch()` resolves rather than
 * a fixed number of timer passes: a start that finishes late schedules the next
 * Plugin's idle callback, and a pass short of it would hang.
 */
async function launchAll(h: Harness): Promise<void> {
  await advanceUntilSettled(h.lifecycle.launch(), "lifecycle.launch()");
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

  it("never registers or starts a Plugin whose approval is disabled", async () => {
    const h = await createHarness({ disabledApprovals: [makePlugin("off-one")] });

    await launchAll(h);

    expect(h.frameCount()).toBe(0);
    expect(h.lifecycle.installed()).toEqual([]);
    expect(h.lifecycle.state("off-one")).toBeNull();
    expect(h.directory.readFolder).not.toHaveBeenCalled();
  });

  it("starts persistent Plugins one at a time in idle time", async () => {
    const h = await createHarness({
      approved: [makePlugin("alpha"), makePlugin("beta")],
      deferReady: true,
    });

    const launching = h.lifecycle.launch();
    await advanceUntil(() => h.framesFor("alpha").length === 1, "alpha's frame");
    expect(h.framesFor("alpha")).toHaveLength(1);
    expect(h.framesFor("beta")).toHaveLength(0);

    h.framesFor("alpha")[0].signalReady();
    await advanceUntil(() => h.framesFor("beta").length === 1, "beta's frame");
    expect(h.framesFor("beta")).toHaveLength(1);

    h.framesFor("beta")[0].signalReady();
    await advanceUntilSettled(launching, "lifecycle.launch()");
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
    await advanceUntilSettled(launching, "lifecycle.launch()");
    await advance(0);
    expect(h.framesFor("alpha")).toHaveLength(1);
  });

  it("marks the launch scan settled and notifies once the registrations ran", async () => {
    let settleLaunch!: () => void;
    const gate = new Promise<void>((resolve) => {
      settleLaunch = resolve;
    });
    const h = await createHarness({
      approved: [makePlugin("alpha")],
      whenLaunchSettled: () => gate,
    });
    let notified = 0;
    h.lifecycle.onLaunchScanned(() => {
      notified += 1;
    });

    const launching = h.lifecycle.launch();
    await advance(0);
    expect(h.lifecycle.launchScanned()).toBe(false);
    expect(h.frameCount()).toBe(0);
    expect(notified).toBe(0);

    settleLaunch();
    await advanceUntil(() => h.lifecycle.launchScanned(), "the launch scan settling");
    expect(notified).toBe(1);
    expect(h.lifecycle.installed().map((plugin) => plugin.pluginId)).toEqual(["alpha"]);
    await advanceUntilSettled(launching, "lifecycle.launch()");
  });

  it("marks the scan settled when the launch fails, so loading surfaces end", async () => {
    const h = await createHarness({ approved: [makePlugin("alpha")] });
    let notified = 0;
    h.lifecycle.onLaunchScanned(() => {
      notified += 1;
    });
    (h.directory.listFolders as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("directory unreadable")
    );

    await advanceUntilSettled(h.lifecycle.launch(), "the failing launch");
    await advance(0);

    expect(h.lifecycle.launchScanned()).toBe(true);
    expect(notified).toBe(1);
  });

  it("skips a Plugin whose contributions throw and still registers the rest", async () => {
    const contributions = await import("@/features/plugins/contributions");
    const original = contributions.registerPluginContributions;
    const seen: string[] = [];
    const spy = vi.spyOn(contributions, "registerPluginContributions").mockImplementation(((source: Parameters<typeof original>[0]) => {
      seen.push(source.manifest.id);
      if (source.manifest.id === "bad-one") throw new Error("bad contributions");
      return original(source);
    }) as typeof original);
    try {
      const bad = makePlugin("bad-one", { lifecycle: "on-demand" });
      const good = makePlugin("good-two", { lifecycle: "on-demand" });
      const h = await createHarness({ approved: [bad, good] });
      await launchAll(h);

      expect(seen).toEqual(["bad-one", "good-two"]);
      expect(h.lifecycle.installed().map((plugin) => plugin.pluginId)).toEqual(["good-two"]);
      // The surviving Plugin still warm-starts from a surface.
      h.lifecycle.surfaceReached("good-two", "page:report");
      await advanceUntil(
        () => h.lifecycle.state("good-two")?.status === "ready",
        "good-two ready"
      );
      expect(h.lifecycle.state("good-two")?.status).toBe("ready");
    } finally {
      spy.mockRestore();
    }
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
    await advanceUntil(
      () => h.lifecycle.state("warm-page")?.status === "ready",
      "warm-page ready"
    );

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
    await advanceUntil(
      () => h.lifecycle.state("warm-page")?.status === "ready",
      "warm-page ready"
    );

    expect(h.framesFor("warm-page")).toHaveLength(1);
    expect(h.lifecycle.state("warm-page")).toEqual({ status: "ready", startReason: "warmStart" });
  });

  it("stops after five minutes with no reachable surface and no calls", async () => {
    const h = await createHarness({
      approved: [makePlugin("warm-page", { lifecycle: "on-demand" })],
    });
    await h.lifecycle.launch();
    h.lifecycle.surfaceReached("warm-page", "page:report");
    await advanceUntil(
      () => h.lifecycle.state("warm-page")?.status === "ready",
      "warm-page ready"
    );

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
    await advanceUntil(
      () => h.lifecycle.state("warm-page")?.status === "ready",
      "warm-page ready"
    );
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
    await advanceUntil(
      () => h.lifecycle.state("warm-page")?.status === "ready",
      "warm-page ready"
    );
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
      "alpha declared an interface Maibuk could not accept and was stopped."
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
    await advanceUntil(
      () => h.lifecycle.state("slow")?.status === "starting",
      'the "slow" Plugin starting'
    );
    expect(h.lifecycle.state("slow")).toEqual({ status: "starting", startReason: "launch" });
    // "starting" is set before the frame exists, and the startup timeout is
    // armed only when `startPlugin` creates the frame, after real async work the
    // fake timers do not control. Wait for the frame so the timer exists.
    await advanceUntil(() => h.framesFor("slow").length === 1, 'the "slow" frame created');

    await advance(STARTUP_TIMEOUT_MS);

    expect(h.lifecycle.state("slow")).toEqual({
      status: "stopped",
      reason: "startup-timeout",
      refusal: { code: "startup-timeout" },
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "slow took too long to start and was stopped."
    );
    await advanceUntilSettled(launching, "lifecycle.launch()");
  });
});

describe("Plugin lifecycle: Toggle Button pressed state", () => {
  it("clears a Plugin's pressed Toggle Buttons when it stops", async () => {
    const h = await createHarness({ approved: [makePlugin("alpha")] });
    await launchAll(h);
    setToolbarPressed("alpha", "toggle", true);
    expect(isToolbarPressed("alpha", "toggle")).toBe(true);

    h.lifecycle.stop("alpha");
    await advance(0);

    expect(isToolbarPressed("alpha", "toggle")).toBe(false);
  });

  it("clears the pressed state when the Plugin crashes, so a dead Plugin shows no button on", async () => {
    const h = await createHarness({ approved: [makePlugin("alpha")] });
    await launchAll(h);
    setToolbarPressed("alpha", "toggle", true);

    h.lifecycle.stop("alpha", "crashed");
    await advance(0);

    expect(h.lifecycle.state("alpha")?.status).toBe("stopped");
    expect(isToolbarPressed("alpha", "toggle")).toBe(false);
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
    // The restart's frame is created only after real async work the fake timers
    // do not control; wait for the new frame and the ready state it leads to.
    await advanceUntil(
      () =>
        h.framesFor("alpha").length === 2 && h.lifecycle.state("alpha")?.status === "ready",
      "alpha's automatic restart"
    );
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
    await advanceUntil(
      () => h.framesFor("alpha")[0]?.requests.includes("migrateData") ?? false,
      "alpha's migrateData request"
    );
    expect(h.lifecycle.state("alpha")).toEqual({ status: "starting", startReason: "launch" });
    expect(h.framesFor("alpha")[0].requests).toContain("migrateData");
    // The startup timeout is armed only once the frame exists (runtime.ts);
    // the migrateData wait above already implies it, and this makes it explicit.
    await advanceUntil(() => h.framesFor("alpha").length === 1, "alpha's frame created");

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
    await advanceUntilSettled(launching, "lifecycle.launch()");
  });

  it("maps the Worker's element-limit marker to remote-ui-limit", async () => {
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
    await advanceUntil(
      () => h.framesFor("alpha")[0]?.requests.includes("migrateData") ?? false,
      "alpha's migrateData request"
    );

    h.framesFor("alpha")[0].signalError(PLUGIN_UI_NODE_LIMIT_MARKER);
    await advance(0);

    expect(h.lifecycle.state("alpha")).toEqual({
      status: "stopped",
      reason: "remote-ui-limit",
      refusal: null,
    });
    await advanceUntilSettled(launching, "lifecycle.launch()");
  });

  it("keeps an unrelated Worker error a crash, even one that mentions elements", async () => {
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
    await advanceUntil(
      () => h.framesFor("alpha")[0]?.requests.includes("migrateData") ?? false,
      "alpha's migrateData request"
    );

    h.framesFor("alpha")[0].signalError("Cannot read properties of undefined (reading 'element')");
    await advance(0);

    expect(h.lifecycle.state("alpha")).toEqual({
      status: "stopped",
      reason: "crashed",
      refusal: null,
    });
    await advanceUntilSettled(launching, "lifecycle.launch()");
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
    await advanceUntil(
      () => h.framesFor("alpha")[0]?.requests.includes("migrateData") ?? false,
      "alpha's migrateData request"
    );
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
    await advanceUntilSettled(launching, "lifecycle.launch()");
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
    // The start hashes the folder on the real event loop before the
    // compatibility check; wait for the refusal, not a fixed number of passes.
    await advanceUntil(
      () => {
        const state = h.lifecycle.state("warm-page");
        return state?.status === "stopped" && state.refusal !== null;
      },
      "the compatibility refusal"
    );

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

describe("Plugin lifecycle: activation start reason", () => {
  it("announces the activation's start reason to the Worker it creates", async () => {
    const h = await createHarness({ approved: [makePlugin("alpha")] });
    await launchAll(h);
    expect(h.framesFor("alpha")[0].receivedStartReason).toBe("launch");

    h.lifecycle.stop("alpha");
    await advance(0);
    const result = await h.lifecycle.start("alpha", "restore");
    await advance(0);

    expect(result).toEqual({ ok: true, startReason: "restore" });
    expect(h.framesFor("alpha")).toHaveLength(2);
    expect(h.framesFor("alpha")[1].receivedStartReason).toBe("restore");
  });
});

describe("Plugin lifecycle: review gate", () => {
  it("never creates a frame for a changed copy and records the review refusal", async () => {
    const h = await createHarness({ changed: [makePlugin("alpha")] });

    await launchAll(h);

    expect(h.frameCount()).toBe(0);
    expect(h.lifecycle.state("alpha")).toEqual({
      status: "stopped",
      reason: null,
      refusal: { code: "review-required", status: "review-required" },
    });
  });

  it("starts a changed copy once its current files are approved again", async () => {
    const folder = makePlugin("alpha");
    const h = await createHarness({ changed: [folder] });
    await launchAll(h);
    expect(h.frameCount()).toBe(0);

    // Re-pin to the folder's current hash: the review is approved now.
    savePluginApproval({
      pluginId: "alpha",
      pinnedHash: await hashPluginDirectory(folder.files),
      granted: [],
      enabled: true,
      approvedVersion: "",
      approvedPermissions: { required: [], optional: [] },
      approvedFiles: {},
    });
    await h.lifecycle.start("alpha", "enable");
    await advance(0);

    expect(h.framesFor("alpha")).toHaveLength(1);
    expect(h.lifecycle.state("alpha")).toEqual({ status: "ready", startReason: "enable" });
  });

  it("refuses an on-demand copy that changed before any warm start", async () => {
    const h = await createHarness({
      changed: [makePlugin("warm-page", { lifecycle: "on-demand" })],
    });
    await h.lifecycle.launch();
    h.lifecycle.surfaceReached("warm-page", "page:report");
    // The review gate hashes the folder on the real event loop; wait for the
    // refusal itself rather than a fixed number of timer passes.
    await advanceUntil(() => {
      const state = h.lifecycle.state("warm-page");
      return state?.status === "stopped" && state.refusal?.code === "review-required";
    }, "warm-page review refusal");

    expect(h.frameCount()).toBe(0);
    // A changed copy is refused before the state ever turns "starting".
    expect(h.changes.map((change) => change.state.status)).not.toContain("starting");
    expect(h.lifecycle.state("warm-page")).toEqual({
      status: "stopped",
      reason: null,
      refusal: { code: "review-required", status: "review-required" },
    });
  });

  it("joins a concurrent start made while the review gate reads the folder", async () => {
    const h = await createHarness({
      approved: [makePlugin("alpha", { lifecycle: "on-demand" })],
    });
    await h.lifecycle.launch();

    // Both calls land before the gate's folder hash resolves, while the state
    // is still "stopped"; the second must not supersede the first.
    const [first, second] = await Promise.all([
      h.lifecycle.start("alpha", "enable"),
      h.lifecycle.start("alpha", "enable"),
    ]);
    await advance(0);

    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    expect(h.framesFor("alpha")).toHaveLength(1);
  });

  it("starts again after a stop that lands while the review gate reads the folder", async () => {
    const h = await createHarness({
      approved: [makePlugin("alpha", { lifecycle: "on-demand" })],
    });
    await h.lifecycle.launch();

    const superseded = h.lifecycle.start("alpha", "enable");
    h.lifecycle.stop("alpha");
    const restarted = await h.lifecycle.start("alpha", "enable");
    await superseded;
    await advance(0);

    expect(restarted.ok).toBe(true);
    expect(h.framesFor("alpha")).toHaveLength(1);
    expect(h.lifecycle.state("alpha")).toEqual({ status: "ready", startReason: "enable" });
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

  it("marks the same activation in a production bench build with VITE_PLUGIN_BENCH=1", async () => {
    // A shipped build has DEV off; the bench flag is what turns the marks on.
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_PLUGIN_BENCH", "1");
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

      expect(marks).toContain("plugin.start:alpha:begin");
      expect(marks).toContain("plugin.start:alpha:ready");
      expect(measures).toContain("plugin.start:alpha");
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
      kind: "web",
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

  it("returns a new, non-disposed lifecycle after a reset", async () => {
    const directory: PluginDirectoryAdapter = {
      kind: "web",
      listFolders: async () => [],
      readFolder: async () => null,
    };
    const first = installPluginLifecycle({
      directory,
      whenLaunchSettled: async () => undefined,
    });
    resetPluginLifecycleForTests();
    const second = installPluginLifecycle({
      directory,
      whenLaunchSettled: async () => undefined,
    });
    expect(second).not.toBe(first);
    expect(getPluginLifecycle()).toBe(second);
    // A disposed lifecycle drops its state; the new one is usable.
    expect(second.installed()).toEqual([]);
    expect(second.state("absent")).toBeNull();
    resetPluginLifecycleForTests();
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

describe("Plugin lifecycle: library and language events", () => {
  it("forwards availability and language changes to a running Plugin", async () => {
    await i18n.changeLanguage("en");
    const h = await createHarness({ approved: [makePlugin("alpha")] });
    await launchAll(h);
    const port = h.framesFor("alpha")[0].pluginPort;
    if (!port) throw new Error("alpha has no plugin port");

    const events: { event: string; payload: { language?: string; available?: boolean } }[] = [];
    const original = port.onmessage;
    port.onmessage = (event) => {
      const data = event.data as { kind?: string; event?: string; payload?: unknown } | null;
      if (data && data.kind === "event" && data.event) {
        events.push({ event: data.event, payload: data.payload as { language?: string } });
        return;
      }
      original?.call(port, event);
    };
    // Both events are ungated, so a Plugin with no granted permissions can hear them.
    port.postMessage(
      JSON.stringify({ kind: "subscribe", id: 1, event: "library.availabilityChanged" })
    );
    port.postMessage(JSON.stringify({ kind: "subscribe", id: 2, event: "language.changed" }));
    await advance(0);

    await emitChange({ available: false, reason: "tutorial" });
    await i18n.changeLanguage("es");
    await advance(0);

    expect(events).toContainEqual({
      event: "library.availabilityChanged",
      payload: { available: false, reason: "tutorial" },
    });
    // The language subscription replays the current value, then the change.
    expect(
      events.filter((entry) => entry.event === "language.changed").map((entry) => entry.payload.language)
    ).toEqual(["en", "es"]);
  });

  it("delivers no Library content signal while the Library is unavailable (the Tutorial)", async () => {
    let available = false;
    const h = await createHarness({
      approved: [
        makePlugin("alpha", { permissions: { required: ["library:read"], optional: [] } }),
      ],
      granted: ["library:read"],
      isLibraryAvailable: () => available,
    });
    await launchAll(h);
    const port = h.framesFor("alpha")[0].pluginPort;
    if (!port) throw new Error("alpha has no plugin port");

    const events: string[] = [];
    const original = port.onmessage;
    port.onmessage = (event) => {
      const data = event.data as { kind?: string; event?: string } | null;
      if (data && data.kind === "event" && data.event) {
        events.push(data.event);
        return;
      }
      original?.call(port, event);
    };
    port.postMessage(JSON.stringify({ kind: "subscribe", id: 1, event: "library.changed" }));
    port.postMessage(
      JSON.stringify({ kind: "subscribe", id: 2, event: "library.availabilityChanged" })
    );
    await advance(0);

    // The Tutorial Library's own sample saves never reach a Plugin...
    await emitChange({ entity: "book", id: "tutorial-b1", origin: "local", kind: "content" });
    await advance(0);
    expect(events).toEqual([]);

    // ...but the availability signal itself still does, so it can stop calling.
    await emitChange({ available: false, reason: "tutorial" });
    await advance(0);
    expect(events).toEqual(["library.availabilityChanged"]);

    // Once the Library is back, content signals flow again.
    available = true;
    await emitChange({ entity: "book", id: "b1", origin: "local", kind: "content" });
    await advance(0);
    expect(events).toEqual(["library.availabilityChanged", "library.changed"]);
  });

  it("forwards focused-editor content and focus changes to a running Plugin", async () => {
    const h = await createHarness({
      approved: [
        makePlugin("alpha", { permissions: { required: ["editor:read"], optional: [] } }),
      ],
      granted: ["editor:read"],
    });
    await launchAll(h);
    const port = h.framesFor("alpha")[0].pluginPort;
    if (!port) throw new Error("alpha has no plugin port");

    const events: { event: string; payload: unknown }[] = [];
    const original = port.onmessage;
    port.onmessage = (event) => {
      const data = event.data as { kind?: string; event?: string; payload?: unknown } | null;
      if (data && data.kind === "event" && data.event) {
        events.push({ event: data.event, payload: data.payload });
        return;
      }
      original?.call(port, event);
    };
    port.postMessage(JSON.stringify({ kind: "subscribe", id: 1, event: "editor.contentChanged" }));
    port.postMessage(JSON.stringify({ kind: "subscribe", id: 2, event: "editor.focusChanged" }));
    await advance(0);

    const editor = new Editor({ extensions: createRichTextExtensions(), content: "<p>one</p>" });
    document.body.appendChild(editor.view.dom);
    editor.view.dom.focus();
    registerPluginEditor({ id: "e1", editor, entity: { kind: "chapter", id: "c1" } });
    await advance(0);

    editor.commands.insertContentAt(4, " two");
    await advance(EDITOR_CONTENT_EVENT_MS);

    expect(events).toContainEqual({
      event: "editor.focusChanged",
      payload: { entity: { kind: "chapter", id: "c1" } },
    });
    expect(events).toContainEqual({
      event: "editor.contentChanged",
      payload: { entity: { kind: "chapter", id: "c1" } },
    });

    editor.destroy();
  });

  it("delivers no editor signal while the Library is unavailable (the Tutorial)", async () => {
    const h = await createHarness({
      approved: [
        makePlugin("alpha", { permissions: { required: ["editor:read"], optional: [] } }),
      ],
      granted: ["editor:read"],
      isLibraryAvailable: () => false,
    });
    await launchAll(h);
    const port = h.framesFor("alpha")[0].pluginPort;
    if (!port) throw new Error("alpha has no plugin port");

    const events: string[] = [];
    const original = port.onmessage;
    port.onmessage = (event) => {
      const data = event.data as { kind?: string; event?: string } | null;
      if (data && data.kind === "event" && data.event) {
        events.push(data.event);
        return;
      }
      original?.call(port, event);
    };
    port.postMessage(JSON.stringify({ kind: "subscribe", id: 1, event: "editor.contentChanged" }));
    port.postMessage(JSON.stringify({ kind: "subscribe", id: 2, event: "editor.focusChanged" }));
    await advance(0);

    const editor = new Editor({ extensions: createRichTextExtensions(), content: "<p>one</p>" });
    document.body.appendChild(editor.view.dom);
    editor.view.dom.focus();
    registerPluginEditor({ id: "e1", editor, entity: { kind: "chapter", id: "c1" } });
    await advance(0);
    editor.commands.insertContentAt(4, " two");
    await advance(EDITOR_CONTENT_EVENT_MS);

    expect(events).toEqual([]);
    editor.destroy();
  });

  it("clears a stopped Plugin's editor highlights and leaves other Plugins'", async () => {
    const h = await createHarness({ approved: [makePlugin("alpha"), makePlugin("beta")] });
    await launchAll(h);
    const editor = new Editor({ extensions: createRichTextExtensions(), content: "<p>one two</p>" });
    document.body.appendChild(editor.view.dom);
    editor.view.dom.focus();
    registerPluginEditor({ id: "e1", editor, entity: { kind: "chapter", id: "c1" } });

    setPluginEditorHighlights("alpha", { kind: "info", ranges: [{ from: 0, to: 3 }] });
    setPluginEditorHighlights("beta", { kind: "warning", ranges: [{ from: 4, to: 7 }] });
    expect(editor.view.dom.querySelectorAll(".plugin-highlight--info")).toHaveLength(1);
    expect(editor.view.dom.querySelectorAll(".plugin-highlight--warning")).toHaveLength(1);

    h.lifecycle.stop("alpha");

    expect(editor.view.dom.querySelectorAll(".plugin-highlight--info")).toHaveLength(0);
    expect(editor.view.dom.querySelectorAll(".plugin-highlight--warning")).toHaveLength(1);
    editor.destroy();
  });
});

describe("Plugin lifecycle: Tutorial entry/exit boundary", () => {
  let available: boolean;

  /** A pending value the test releases to let an in-flight handler finish. */
  function deferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void;
    const promise = new Promise<void>((next) => {
      resolve = next;
    });
    return { promise, resolve };
  }

  /**
   * Intercepts the fake frame's port so the events the host posts are recorded,
   * then forwards everything else to the Plugin on the other end of the port.
   */
  function captureEvents(h: Harness, pluginId: string) {
    const port = h.framesFor(pluginId)[0].pluginPort;
    if (!port) throw new Error(`${pluginId} has no plugin port`);
    const events: { event: string; payload: unknown }[] = [];
    const original = port.onmessage;
    port.onmessage = (event) => {
      const data = event.data as { kind?: string; event?: string; payload?: unknown } | null;
      if (data && data.kind === "event" && data.event) {
        events.push({ event: data.event, payload: data.payload });
        return;
      }
      original?.call(port, event);
    };
    return { port, events };
  }

  // Subscription ids well above any frame.call id, so the fake frame never
  // mistakes a subscription's reply for a settled call.
  function subscribe(port: NonNullable<FakePluginFrame["pluginPort"]>, event: string, id: number) {
    port.postMessage(JSON.stringify({ kind: "subscribe", id, event }));
  }

  beforeEach(() => {
    available = true;
  });

  it("carries the signal's reason on the availability payload at entry", async () => {
    const h = await createHarness({
      approved: [makePlugin("alpha")],
      isLibraryAvailable: () => available,
    });
    await launchAll(h);
    const { port, events } = captureEvents(h, "alpha");
    subscribe(port, "library.availabilityChanged", 1_001);
    await advance(0);

    available = false;
    await emitChange({ available: false, reason: "tutorial" });

    expect(events).toContainEqual({
      event: "library.availabilityChanged",
      payload: { available: false, reason: "tutorial" },
    });
  });

  it("refuses a Library call still in flight when the Tutorial starts, so the late result never crosses", async () => {
    const gate = deferred();
    const handler = vi.fn(async () => {
      await gate.promise;
      return "late";
    });
    const h = await createHarness({
      approved: [makePlugin("alpha")],
      isLibraryAvailable: () => available,
      handlers: () => ({ "storage.get": handler }),
    });
    await launchAll(h);
    const frame = h.framesFor("alpha")[0];

    const call = frame.call("storage.get", { key: "k" });
    await advance(0);
    // The broker accepted the call and its handler is now in flight.
    expect(handler).toHaveBeenCalledTimes(1);

    // The Tutorial starts while the call is still running.
    available = false;
    await emitChange({ available: false, reason: "tutorial" });
    gate.resolve();

    await expect(call).rejects.toMatchObject({ code: "library-unavailable" });
  });

  it("refuses a call made during the Tutorial and never replays it after exit", async () => {
    const handler = vi.fn(async () => "value");
    const h = await createHarness({
      approved: [makePlugin("alpha")],
      isLibraryAvailable: () => available,
      handlers: () => ({ "storage.get": handler }),
    });
    await launchAll(h);
    const frame = h.framesFor("alpha")[0];

    available = false;
    await emitChange({ available: false, reason: "tutorial" });
    await expect(frame.call("storage.get", { key: "k" })).rejects.toMatchObject({
      code: "library-unavailable",
    });
    expect(handler).not.toHaveBeenCalled();

    // Leaving the Tutorial must not re-run a refused call.
    available = true;
    await emitChange({ available: true, reason: "tutorial" });
    await advance(0);
    expect(handler).not.toHaveBeenCalled();
  });

  it("suspends Library change events during the Tutorial and never replays them after exit", async () => {
    const h = await createHarness({
      approved: [
        makePlugin("alpha", { permissions: { required: ["library:read"], optional: [] } }),
      ],
      granted: ["library:read"],
      isLibraryAvailable: () => available,
    });
    await launchAll(h);
    const { port, events } = captureEvents(h, "alpha");
    subscribe(port, "library.changed", 1_001);
    subscribe(port, "library.availabilityChanged", 1_002);
    await advance(0);
    const changes = () => events.filter((entry) => entry.event === "library.changed");

    available = false;
    await emitChange({ available: false, reason: "tutorial" });
    await emitChange({ entity: "book", id: "tutorial-b1", origin: "local", kind: "content" });
    await emitChange({ scope: "all", reason: "restore" });
    await advance(0);
    // No change made during the Tutorial reaches the Plugin.
    expect(changes()).toEqual([]);

    available = true;
    await emitChange({ available: true, reason: "tutorial" });
    await advance(0);
    // Nothing was queued and replayed on exit.
    expect(changes()).toEqual([]);
    // The exit announces availability with the same reason.
    expect(events).toContainEqual({
      event: "library.availabilityChanged",
      payload: { available: true, reason: "tutorial" },
    });

    // A change made after exit flows again.
    await emitChange({ entity: "book", id: "b1", origin: "local", kind: "content" });
    await advance(0);
    expect(changes()).toEqual([
      {
        event: "library.changed",
        payload: { entity: "book", id: "b1", origin: "local", kind: "content" },
      },
    ]);
  });

  it("refuses a Built-in Plugin call during the Tutorial with no exemption", async () => {
    const manifest: PluginManifest = { ...PLUGIN_MANIFEST, id: "maibuk-echoes", name: "Echoes" };
    const folder = pluginFolder({}, manifest);
    const builtInSource: BuiltInPluginSource = {
      async list() {
        return [
          {
            id: manifest.id,
            manifest,
            hash: await hashPluginDirectory(folder.files),
            files: folder.files,
          },
        ];
      },
    };
    const handler = vi.fn(async () => "value");
    const h = await createHarness({
      approved: [folder],
      builtInSource,
      isLibraryAvailable: () => available,
      handlers: () => ({ "storage.get": handler }),
    });
    await launchAll(h);

    const installed = h.lifecycle.installed().find((plugin) => plugin.pluginId === "maibuk-echoes");
    expect(installed?.builtIn).toBe(true);
    const runtime = h.lifecycle.runtime("maibuk-echoes");

    available = false;
    await emitChange({ available: false, reason: "tutorial" });
    await expect(h.framesFor("maibuk-echoes")[0].call("storage.get", { key: "k" })).rejects.toMatchObject(
      { code: "library-unavailable" }
    );
    expect(handler).not.toHaveBeenCalled();
    // The Built-in stays alive on the same runtime, refused like any other.
    expect(runtime?.broker.stopped).toBe(false);
    expect(h.lifecycle.runtime("maibuk-echoes")).toBe(runtime);
  });

  it("keeps the Worker alive across Tutorial entry and exit", async () => {
    const h = await createHarness({
      approved: [makePlugin("alpha")],
      isLibraryAvailable: () => available,
    });
    await launchAll(h);
    const frame = h.framesFor("alpha")[0];
    const runtime = h.lifecycle.runtime("alpha");

    available = false;
    await emitChange({ available: false, reason: "tutorial" });
    available = true;
    await emitChange({ available: true, reason: "tutorial" });
    await advance(0);

    expect(frame.stopped).toBe(false);
    expect(h.lifecycle.runtime("alpha")).toBe(runtime);
    expect(h.lifecycle.state("alpha")).toEqual({ status: "ready", startReason: "launch" });
  });

  it("clears Plugin editor highlights and pending editor work when the Tutorial starts", async () => {
    const h = await createHarness({
      approved: [makePlugin("alpha")],
      isLibraryAvailable: () => available,
    });
    await launchAll(h);

    const editor = new Editor({ extensions: createRichTextExtensions(), content: "<p>one two</p>" });
    document.body.appendChild(editor.view.dom);
    editor.view.dom.focus();
    registerPluginEditor({ id: "e1", editor, entity: { kind: "chapter", id: "c1" } });
    setPluginEditorHighlights("alpha", { kind: "info", ranges: [{ from: 0, to: 3 }] });
    expect(editor.view.dom.querySelectorAll(".plugin-highlight--info")).toHaveLength(1);

    // A reveal queued for an editor that has not mounted yet.
    requestEditorReveal({ kind: "chapter", id: "c9" }, { from: 4, to: 7 });

    available = false;
    await emitChange({ available: false, reason: "tutorial" });

    expect(editor.view.dom.querySelectorAll(".plugin-highlight--info")).toHaveLength(0);

    // The queued reveal was dropped: opening that editor later places no caret.
    const later = new Editor({
      extensions: createRichTextExtensions(),
      content: "<p>one two three</p>",
    });
    document.body.appendChild(later.view.dom);
    registerPluginEditor({ id: "e2", editor: later, entity: { kind: "chapter", id: "c9" } });
    const map = buildPlainTextMap(later.state.doc);
    expect(pmToPlainOffset(map, later.state.selection.from)).toBe(0);

    editor.destroy();
    later.destroy();
  });
});

describe("Plugin lifecycle: bulk Library replacement", () => {
  it("stops a running persistent Plugin before a Restore and restarts it with the Restore reason", async () => {
    const h = await createHarness({ approved: [makePlugin("alpha")] });
    await launchAll(h);
    expect(h.lifecycle.state("alpha")).toEqual({ status: "ready", startReason: "launch" });

    await prepareBulkReplace("restore");

    expect(h.lifecycle.state("alpha")).toEqual({
      status: "stopped",
      reason: "requested",
      refusal: null,
    });
    expect(h.lifecycle.runtime("alpha")).toBeNull();

    await emitChange({ scope: "all", reason: "restore" });
    await advanceUntil(() => h.lifecycle.state("alpha")?.status === "ready", "alpha restart");

    expect(h.lifecycle.state("alpha")).toEqual({ status: "ready", startReason: "restore" });
    expect(h.framesFor("alpha")[1].receivedStartReason).toBe("restore");
  });

  it("clears a running Plugin's editor highlights before the replacement", async () => {
    const h = await createHarness({ approved: [makePlugin("alpha")] });
    await launchAll(h);
    expect(h.lifecycle.state("alpha")).toEqual({ status: "ready", startReason: "launch" });

    const editor = new Editor({
      extensions: createRichTextExtensions(),
      content: "<p>one two</p>",
    });
    document.body.appendChild(editor.view.dom);
    editor.view.dom.focus();
    registerPluginEditor({ id: "e1", editor, entity: { kind: "chapter", id: "c1" } });
    setPluginEditorHighlights("alpha", { kind: "info", ranges: [{ from: 0, to: 3 }] });
    expect(editor.view.dom.querySelectorAll(".plugin-highlight--info")).toHaveLength(1);

    // A stop for the replacement drops the highlight like any other stop, so a
    // mark accepted against the Library that is going away never surfaces.
    await prepareBulkReplace("restore");

    expect(editor.view.dom.querySelectorAll(".plugin-highlight--info")).toHaveLength(0);

    editor.destroy();
  });

  it("stops and restarts a running Built-in with no exemption", async () => {
    const manifest: PluginManifest = { ...PLUGIN_MANIFEST, id: "maibuk-echoes", name: "Echoes" };
    const folder = pluginFolder({}, manifest);
    const builtInSource: BuiltInPluginSource = {
      async list() {
        return [
          {
            id: manifest.id,
            manifest,
            hash: await hashPluginDirectory(folder.files),
            files: folder.files,
          },
        ];
      },
    };
    const h = await createHarness({ approved: [folder], builtInSource });
    await launchAll(h);
    expect(h.lifecycle.state("maibuk-echoes")).toEqual({ status: "ready", startReason: "launch" });

    await prepareBulkReplace("restore");
    expect(h.lifecycle.state("maibuk-echoes")).toEqual({
      status: "stopped",
      reason: "requested",
      refusal: null,
    });

    await emitChange({ scope: "all", reason: "restore" });
    await advanceUntil(
      () => h.lifecycle.state("maibuk-echoes")?.status === "ready",
      "Built-in restart"
    );

    expect(h.lifecycle.state("maibuk-echoes")).toEqual({ status: "ready", startReason: "restore" });
    expect(h.framesFor("maibuk-echoes")[1].receivedStartReason).toBe("restore");
  });

  it("stops before a Reset Library and restarts under the Reset reason", async () => {
    const h = await createHarness({ approved: [makePlugin("alpha")] });
    await launchAll(h);

    await prepareBulkReplace("resetLibrary");
    expect(h.lifecycle.state("alpha")?.status).toBe("stopped");

    await emitChange({ scope: "all", reason: "resetLibrary" });
    await advanceUntil(() => h.lifecycle.state("alpha")?.status === "ready", "alpha restart");

    expect(h.lifecycle.state("alpha")).toEqual({ status: "ready", startReason: "resetLibrary" });
  });

  it("stops before a Database File load and restarts under the load reason", async () => {
    const h = await createHarness({ approved: [makePlugin("alpha")] });
    await launchAll(h);

    await prepareBulkReplace("databaseLoad");
    expect(h.lifecycle.state("alpha")?.status).toBe("stopped");

    await emitChange({ scope: "all", reason: "databaseLoad" });
    await advanceUntil(() => h.lifecycle.state("alpha")?.status === "ready", "alpha restart");

    expect(h.lifecycle.state("alpha")).toEqual({ status: "ready", startReason: "databaseLoad" });
  });

  it("does not start a Plugin that was not running before the replacement", async () => {
    const h = await createHarness({
      approved: [makePlugin("alpha"), makePlugin("warm-page", { lifecycle: "on-demand" })],
    });
    await launchAll(h);
    expect(h.framesFor("warm-page")).toHaveLength(0);

    await prepareBulkReplace("restore");
    await emitChange({ scope: "all", reason: "restore" });
    await advanceUntil(() => h.lifecycle.state("alpha")?.status === "ready", "alpha restart");

    expect(h.framesFor("warm-page")).toHaveLength(0);
    expect(h.lifecycle.state("warm-page")).toEqual({
      status: "stopped",
      reason: null,
      refusal: null,
    });
  });

  it("waits for an accepted Plugin storage write to settle before the replacement", async () => {
    let resolveWrite!: () => void;
    const writeGate = new Promise<void>((resolve) => {
      resolveWrite = resolve;
    });
    const handler = vi.fn(async () => {
      await writeGate;
      return null;
    });
    const h = await createHarness({
      approved: [makePlugin("alpha")],
      handlers: () => ({ "storage.set": handler }),
    });
    await launchAll(h);

    // A `requiresLibrary` call the broker accepted, still in flight.
    const call = h.framesFor("alpha")[0].call("storage.set", { key: "k", value: 1 });
    call.catch(() => undefined);
    await advance(0);
    expect(handler).toHaveBeenCalledTimes(1);

    let prepared = false;
    const preparing = prepareBulkReplace("restore").then(() => {
      prepared = true;
    });
    await advance(0);
    // The Plugin stopped, but its accepted write has not settled, so the
    // replacement must not proceed yet.
    expect(h.lifecycle.state("alpha")?.status).toBe("stopped");
    expect(prepared).toBe(false);

    resolveWrite();
    await preparing;
    expect(prepared).toBe(true);
  });

  it("restarts the stopped Plugins with a plain restart when the replacement is abandoned", async () => {
    const h = await createHarness({ approved: [makePlugin("alpha")] });
    await launchAll(h);

    await prepareBulkReplace("restore");
    expect(h.lifecycle.state("alpha")?.status).toBe("stopped");

    await cancelBulkReplace("restore");
    await advanceUntil(() => h.lifecycle.state("alpha")?.status === "ready", "alpha restart");

    expect(h.lifecycle.state("alpha")).toEqual({ status: "ready", startReason: "restart" });
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
