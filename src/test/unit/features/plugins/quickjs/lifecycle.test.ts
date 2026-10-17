/**
 * The lifecycle's QuickJS stop reasons (#516, ADR 0019). The Android QuickJS
 * engine reports a memory death as a Worker error whose message is
 * `QUICKJS_MEMORY_DEATH_MESSAGE` (the exact string the sandbox prelude's
 * QuickJS branch throws, see `sandbox.ts`), and `workerStopReason` in
 * `lifecycle.ts` maps that message to an `out-of-memory` stop with the
 * `plugins.stopped.outOfMemory` copy. A Worker that never answers the heartbeat
 * still stops as `unresponsive`.
 *
 * The suite drives the same seams the Plugin lifecycle suite uses: a fake
 * sandbox frame playing the Worker's port (jsdom has no Worker) and a
 * microtask-delivering `MessageChannel`, so fake timers can drive long spans
 * exactly.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PLUGIN_APPROVALS_STORAGE_KEY, savePluginApproval } from "@/features/plugins/approvals";
import { hashPluginDirectory } from "@/features/plugins/directory-hash";
import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_MISS_LIMIT,
  createPluginLifecycle,
  pluginStoppedMessage,
  resetPluginLifecycleForTests,
} from "@/features/plugins/lifecycle";
import { QUICKJS_MEMORY_DEATH_MESSAGE } from "@/features/plugins/quickjs/constants";
import { PLUGIN_STOP_MESSAGE_KEYS, pluginStopMessageKey } from "@/features/plugins/stop-messages";
import type { PluginFolder, PluginLifecycle, PluginManifest } from "@/features/plugins/types";
import { resetLibrarySwitchForTests } from "@/features/tutorial/library-switch";
import i18n from "@/i18n";
import type { PluginDirectoryAdapter } from "@/lib/platform/types";
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

/** A pass ceiling well above any real start (hashing lands in a few passes). */
const MAX_ADVANCE_PASSES = 1_000;

/**
 * Advances until `work` settles, then rethrows its rejection. Real async work
 * (Web Crypto hashing inside `startPlugin`) finishes after the fake timers
 * advance, so the wait is driven by the promise itself.
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

interface Harness {
  lifecycle: PluginLifecycle;
  framesFor(pluginId: string): FakePluginFrame[];
}

const harnesses: PluginLifecycle[] = [];
let restoreMessageChannel: (() => void) | null = null;

/** One approved persistent Plugin over a fake sandbox frame, ready after launch. */
async function createHarness(plugin: PluginFolder): Promise<Harness> {
  const folders = new Map<string, PluginFolder>([[plugin.name, plugin]]);
  savePluginApproval({
    pluginId: plugin.name,
    pinnedHash: await hashPluginDirectory(plugin.files),
    granted: [],
    enabled: true,
    approvedVersion: "",
    approvedPermissions: { required: [], optional: [] },
    approvedFiles: {},
  });

  const frames: { pluginId: string; frame: FakePluginFrame }[] = [];
  const dataVersions = new Map<string, number>();
  const directory: PluginDirectoryAdapter = {
    kind: "web",
    listFolders: async () => [...folders.keys()],
    readFolder: async (name) => folders.get(name) ?? null,
  };

  const lifecycle = createPluginLifecycle({
    directory,
    createFrame: (_document, manifest) => {
      const frame = fakePluginFrame();
      frames.push({ pluginId: manifest.id, frame });
      return frame;
    },
    scheduleIdle: (work) => setTimeout(work, 0),
    whenLaunchSettled: async () => undefined,
    dataVersions: {
      get: async (pluginId) => dataVersions.get(pluginId) ?? null,
      set: async (pluginId, version) => {
        dataVersions.set(pluginId, version);
      },
    },
  });
  harnesses.push(lifecycle);

  return {
    lifecycle,
    framesFor(pluginId: string): FakePluginFrame[] {
      return frames.filter((entry) => entry.pluginId === pluginId).map((entry) => entry.frame);
    },
  };
}

/** Launches and lets the persistent start run through to ready. */
async function launchAll(h: Harness): Promise<void> {
  await advanceUntilSettled(h.lifecycle.launch(), "lifecycle.launch()");
  await advance(0);
}

beforeEach(() => {
  vi.useFakeTimers();
  restoreMessageChannel = installMicrotaskMessageChannel();
});

afterEach(() => {
  // Stop every timer the state machine owns, then let toasts auto-dismiss so
  // the shared store starts the next test empty.
  for (const lifecycle of harnesses.splice(0)) lifecycle.dispose();
  vi.runAllTimers();
  restoreMessageChannel?.();
  restoreMessageChannel = null;
  vi.useRealTimers();
  vi.unstubAllEnvs();
  localStorage.removeItem(PLUGIN_APPROVALS_STORAGE_KEY);
  resetLibrarySwitchForTests();
  resetPluginLifecycleForTests();
});

describe("the Plugin lifecycle on the Android QuickJS engine", () => {
  it("stops a QuickJS memory death as out-of-memory with the outOfMemory copy key", async () => {
    const h = await createHarness(makePlugin("alpha"));
    await launchAll(h);
    expect(h.lifecycle.state("alpha")).toEqual({ status: "ready", startReason: "launch" });

    // The QuickJS prelude's memory-death branch throws this exact message from a
    // fresh task, so the Worker error carries it here.
    h.framesFor("alpha")[0].signalError(QUICKJS_MEMORY_DEATH_MESSAGE);
    await advance(0);

    expect(h.lifecycle.state("alpha")).toEqual({
      status: "stopped",
      reason: "out-of-memory",
      refusal: null,
    });
    expect(pluginStopMessageKey("out-of-memory")).toBe("plugins.stopped.outOfMemory");
    expect(PLUGIN_STOP_MESSAGE_KEYS["out-of-memory"]).toBe("plugins.stopped.outOfMemory");
    expect(pluginStoppedMessage("alpha", "out-of-memory")).toBe(
      "alpha used too much memory and was stopped."
    );
  });

  it("stops a Worker that never answers the heartbeat as unresponsive", async () => {
    const h = await createHarness(makePlugin("alpha"));
    await launchAll(h);
    const frame = h.framesFor("alpha")[0];
    // The Worker is alive but blocked, so every host request hangs unanswered.
    frame.holdAnswers = true;

    await advance(HEARTBEAT_INTERVAL_MS);
    expect(h.lifecycle.state("alpha")?.status).toBe("ready");

    await advance(HEARTBEAT_INTERVAL_MS);
    expect(h.lifecycle.state("alpha")?.status).toBe("unavailable");

    await advance(HEARTBEAT_INTERVAL_MS * (HEARTBEAT_MISS_LIMIT - 1));
    expect(h.lifecycle.state("alpha")).toEqual({
      status: "stopped",
      reason: "unresponsive",
      refusal: null,
    });
    expect(frame.stopped).toBe(true);
  });

  it("keeps the engine message and the outOfMemory copy in agreement", () => {
    // The engine message must still match the lifecycle's regex, and the copy
    // key must resolve to real user-facing text.
    expect(QUICKJS_MEMORY_DEATH_MESSAGE).toMatch(/out[- ]of[- ]memory/i);
    expect(i18n.t("plugins.stopped.outOfMemory", { name: "alpha" })).toBe(
      "alpha used too much memory and was stopped."
    );
  });
});
