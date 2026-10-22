/**
 * A real Plugin lifecycle over fake Plugin frames, on fake timers, for the
 * Stopped Plugin surfaces (#618): tests make a Plugin crash, time out, go
 * unresponsive, get refused at activation or at the launch scan, recover, or
 * be disabled, then assert on what the sidebar, the page, and Settings show.
 *
 * The caller owns `vi.useFakeTimers()` (before `createLifecycleHarness`) and
 * calls `disposeLifecycleHarness()` in `afterEach`.
 */

import { act } from "@testing-library/react";
import { vi } from "vitest";
import { PLUGIN_APPROVALS_STORAGE_KEY, savePluginApproval } from "@/features/plugins/approvals";
import { resetPluginContributionsForTests } from "@/features/plugins/contributions";
import { hashPluginDirectory } from "@/features/plugins/directory-hash";
import { createPluginLifecycle } from "@/features/plugins/lifecycle";
import { setPluginLifecycleInstance } from "@/features/plugins/lifecycle-instance";
import { PLUGIN_SIDEBAR_SNAPSHOT_KEY } from "@/features/plugins/sidebar-snapshot";
import type { PluginFolder, PluginLifecycle, PluginManifest } from "@/features/plugins/types";
import type { PluginDirectoryAdapter } from "@/lib/platform/types";
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

/** Runs the fake timers by `ms` and lets every message round trip land. */
export async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
    await flushTasks();
    await vi.advanceTimersByTimeAsync(0);
    await flushTasks();
  });
}

const MAX_ADVANCE_PASSES = 1_000;

/** Advances until `condition` holds; Web Crypto hashing settles on the real loop. */
export async function advanceUntil(condition: () => boolean, what: string): Promise<void> {
  for (let pass = 0; pass < MAX_ADVANCE_PASSES && !condition(); pass += 1) {
    await advance(0);
  }
  if (!condition()) {
    throw new Error(`${what} was not reached within ${MAX_ADVANCE_PASSES} timer passes`);
  }
}

/** A Plugin with one page and its sidebar entry, which the tests open. */
export function pagePlugin(
  id: string,
  overrides: Partial<PluginManifest> = {},
  entries: Record<string, string> = {}
): PluginFolder {
  return pluginFolder(entries, {
    ...PLUGIN_MANIFEST,
    id,
    name: id,
    platforms: ["desktop", "web"],
    contributes: {
      commands: [{ id: "open", label: "Open report", contexts: ["global"], navigates: true }],
      pages: [{ id: "report", title: "Report", command: "open" }],
      sidebarEntries: [{ page: "report", icon: "book-open" }],
    },
    ...overrides,
  });
}

/** A folder whose manifest the launch scan refuses (`manifest-invalid`). */
export function invalidManifestFolder(id: string): PluginFolder {
  const folder = pluginFolder({ "manifest.json": JSON.stringify({ id, name: id }) });
  return { ...folder, name: id };
}

export interface LifecycleHarnessOptions {
  /** Approved, enabled folders whose pinned hash matches. */
  approved?: PluginFolder[];
  /** Enabled folders whose pin is stale: the copy changed and needs review. */
  changed?: PluginFolder[];
  /** Enabled folders the scan refuses; their pin is the folder's hash. */
  refusedAtScan?: PluginFolder[];
  /** Stored dataVersion per Plugin id. */
  data?: Record<string, number>;
  /** Frames that do not signal ready by themselves (a startup that times out). */
  deferReady?: boolean;
  /** Installs the lifecycle as the app's one, so the UI reads it. Defaults to true. */
  install?: boolean;
}

export interface LifecycleHarness {
  lifecycle: PluginLifecycle;
  framesFor(pluginId: string): FakePluginFrame[];
  /** Launches and lets every persistent start run. */
  launch(): Promise<void>;
}

let restoreMessageChannel: (() => void) | null = null;
const live: PluginLifecycle[] = [];

async function approve(folder: PluginFolder, pinnedHash?: string): Promise<void> {
  savePluginApproval({
    pluginId: folder.name,
    pinnedHash: pinnedHash ?? (await hashPluginDirectory(folder.files)),
    granted: [],
    enabled: true,
    approvedVersion: "",
    approvedPermissions: { required: [], optional: [] },
    approvedFiles: {},
  });
}

export async function createLifecycleHarness(
  options: LifecycleHarnessOptions = {}
): Promise<LifecycleHarness> {
  restoreMessageChannel ??= installMicrotaskMessageChannel();
  const folders = new Map<string, PluginFolder>();
  for (const folder of options.approved ?? []) {
    folders.set(folder.name, folder);
    await approve(folder);
  }
  for (const folder of options.changed ?? []) {
    folders.set(folder.name, folder);
    await approve(folder, "h1:stale");
  }
  for (const folder of options.refusedAtScan ?? []) {
    folders.set(folder.name, folder);
    await approve(folder);
  }
  const frames: { pluginId: string; frame: FakePluginFrame }[] = [];
  const dataVersions = new Map<string, number>(Object.entries(options.data ?? {}));
  const directory: PluginDirectoryAdapter = {
    kind: "web",
    listFolders: async () => [...folders.keys()],
    readFolder: async (name: string) => folders.get(name) ?? null,
  };
  const lifecycle = createPluginLifecycle({
    directory,
    createFrame: (_document, manifest) => {
      const frame = fakePluginFrame(options.deferReady ? { ready: false } : {});
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
    stopMessage: () => null,
  });
  live.push(lifecycle);
  if (options.install !== false) setPluginLifecycleInstance(lifecycle);

  return {
    lifecycle,
    framesFor(pluginId) {
      return frames.filter((entry) => entry.pluginId === pluginId).map((entry) => entry.frame);
    },
    async launch() {
      let settled = false;
      void lifecycle.launch().finally(() => {
        settled = true;
      });
      await advanceUntil(() => settled, "lifecycle.launch()");
      await advance(0);
    },
  };
}

export function disposeLifecycleHarness(): void {
  for (const lifecycle of live.splice(0)) lifecycle.dispose();
  setPluginLifecycleInstance(null);
  act(() => {
    vi.runOnlyPendingTimers();
  });
  restoreMessageChannel?.();
  restoreMessageChannel = null;
  localStorage.removeItem(PLUGIN_APPROVALS_STORAGE_KEY);
  localStorage.removeItem(PLUGIN_SIDEBAR_SNAPSHOT_KEY);
  resetPluginContributionsForTests();
}
