/**
 * Reset settings (#442, plan decision 7): the orchestrator clears the settings
 * store, Custom Shortcuts and custom Voice Commands, toolbar config, every
 * Plugin approval and grant, and saved Plugin credentials; it stops running
 * Plugins, refreshes the management store so untouched Built-ins re-seed while
 * modified copies stay review-required, and starts an untouched Built-in that
 * was running again. Plugin files and Library data are never touched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PLUGIN_APPROVALS_STORAGE_KEY,
  getPluginApproval,
  savePluginApproval,
} from "@/features/plugins/approvals";
import { resetPluginContributionsForTests } from "@/features/plugins/contributions";
import { hashPluginDirectory } from "@/features/plugins/directory-hash";
import {
  resetPluginLifecycleForTests,
  setPluginLifecycleInstance,
} from "@/features/plugins/lifecycle-instance";
import {
  createPluginManagementStore,
  usePluginManagementStore,
} from "@/features/plugins/management";
import type {
  BuiltInPlugin,
  BuiltInPluginSource,
  PluginFolder,
  PluginLifecycle,
  PluginManifest,
} from "@/features/plugins/types";
import { voiceEligibleCommands } from "@/features/dictation/voice-commands";
import { resetAllSettings } from "@/features/settings/reset-all";
import { useSettingsStore } from "@/features/settings/store";
import { useShortcutSettingsStore } from "@/features/settings/shortcut-store";
import type { PluginDirectoryAdapter } from "@/lib/platform/types";
import { pluginFolder } from "@/test/support/plugin-fixtures";

const TRACER = "tracer";
const ECHOES = "echoes";
const GUIDE = "maibuk-guide";

/** The `BuiltInPlugin` a source reports for a folder. */
async function builtInOf(folder: PluginFolder): Promise<BuiltInPlugin> {
  const manifest = JSON.parse(
    new TextDecoder().decode(folder.files.find((file) => file.path === "manifest.json")?.bytes)
  ) as PluginManifest;
  return {
    id: manifest.id,
    manifest,
    hash: await hashPluginDirectory(folder.files),
    files: folder.files,
  };
}

interface Harness {
  store: ReturnType<typeof createPluginManagementStore>;
  uninstalled: string[];
  installedAgain: string[];
  replaceCalls: { value: number };
  echoesShippedHash: string;
}

async function setup(): Promise<Harness> {
  const tracer = pluginFolder(
    {},
    { id: TRACER, name: "Tracer", permissions: { required: ["library:read"], optional: [] } }
  );
  // The installed Echoes copy differs from what ships: a modified Built-in.
  const echoes = pluginFolder(
    { "index.js": "export const a = 2;" },
    { id: ECHOES, name: "Echoes", permissions: { required: ["library:read"], optional: [] } }
  );
  const echoesShipped = pluginFolder(
    { "index.js": "export const a = 1;" },
    { id: ECHOES, name: "Echoes", permissions: { required: ["library:read"], optional: [] } }
  );
  const guide = pluginFolder(
    {},
    { id: GUIDE, name: "Guide", permissions: { required: [], optional: [] } }
  );

  const folders = new Map<string, PluginFolder>([
    [tracer.name, tracer],
    [echoes.name, echoes],
    [guide.name, guide],
  ]);
  const replaceCalls = { value: 0 };
  const directory: PluginDirectoryAdapter = {
    listFolders: async () => [...folders.keys()],
    readFolder: async (name) => folders.get(name) ?? null,
    replaceFolder: async () => {
      replaceCalls.value += 1;
      return true;
    },
  };
  const echoesShippedBuiltIn = await builtInOf(echoesShipped);
  const builtInSource: BuiltInPluginSource = {
    list: async () => [echoesShippedBuiltIn, await builtInOf(guide)],
  };

  // The third-party Plugin and the untouched Built-in are running before reset.
  const installed = [{ pluginId: TRACER } as never, { pluginId: GUIDE } as never];
  const uninstalled: string[] = [];
  const installedAgain: string[] = [];
  const lifecycle = {
    installed: () => installed,
    uninstall: (pluginId: string) => {
      uninstalled.push(pluginId);
    },
    install: async (pluginId: string) => {
      installedAgain.push(pluginId);
      return { ok: true };
    },
    state: () => ({ status: "ready" }),
    subscribe: () => () => {},
    dispose: () => {},
  } as unknown as PluginLifecycle;
  setPluginLifecycleInstance(lifecycle);

  // The author already approved the third-party Plugin.
  savePluginApproval({
    pluginId: TRACER,
    pinnedHash: await hashPluginDirectory(tracer.files),
    granted: ["library:read"],
    enabled: true,
    approvedVersion: "1.0.0",
    approvedPermissions: { required: ["library:read"], optional: [] },
    approvedFiles: {},
  });

  const store = createPluginManagementStore({
    directory,
    lifecycle: () => lifecycle,
    builtInSource,
  });

  return {
    store,
    uninstalled,
    installedAgain,
    replaceCalls,
    echoesShippedHash: echoesShippedBuiltIn.hash,
  };
}

beforeEach(() => {
  localStorage.clear();
  useSettingsStore.setState({ appFontSize: 16, pluginDevelopmentMode: false, language: "en" });
  useShortcutSettingsStore.setState((state) => ({
    shortcuts: { ...state.shortcuts, custom: {}, voice: {} },
  }));
});

afterEach(() => {
  resetPluginLifecycleForTests();
  resetPluginContributionsForTests();
  usePluginManagementStore.setState({ plugins: {}, notifications: [] });
  localStorage.removeItem(PLUGIN_APPROVALS_STORAGE_KEY);
  useSettingsStore.setState({ appFontSize: 16, pluginDevelopmentMode: false });
});

describe("resetAllSettings", () => {
  it("clears settings, shortcuts, approvals, and credentials, re-seeds Built-ins, and restarts an untouched one", async () => {
    const harness = await setup();
    const { store } = harness;
    await store.getState().refresh();
    expect(store.getState().plugins[TRACER].review.status).toBe("approved");

    // The author has changed settings and shortcuts before resetting.
    useSettingsStore.setState({ appFontSize: 20, pluginDevelopmentMode: true });
    useShortcutSettingsStore.getState().setCommandShortcuts("common.save", [["Mod+k"]]);
    const voiceId = voiceEligibleCommands()[0];
    useShortcutSettingsStore.getState().setCommandVoicePhrases(voiceId, "en", ["custom phrase"]);

    const clearCredentials = vi.fn(async () => {});

    await resetAllSettings({
      clearCredentials,
      // The default restart reads the app's management singleton; mirror the
      // refreshed entries into it so the real restart path runs.
      refreshPlugins: async () => {
        await store.getState().refresh();
        usePluginManagementStore.setState({ plugins: store.getState().plugins });
      },
    });

    // Settings back to shipped defaults, Development mode included.
    expect(useSettingsStore.getState().appFontSize).toBe(16);
    expect(useSettingsStore.getState().pluginDevelopmentMode).toBe(false);

    // Custom Shortcuts and custom Voice Commands are gone.
    expect(useShortcutSettingsStore.getState().shortcuts.custom).toEqual({});
    expect(useShortcutSettingsStore.getState().shortcuts.voice).toEqual({});

    // Credentials are deleted through the injectable hook.
    expect(clearCredentials).toHaveBeenCalledTimes(1);

    // The third-party approval is cleared and the Plugin is stopped.
    expect(getPluginApproval(TRACER)).toBeNull();
    expect(harness.uninstalled).toEqual([TRACER, GUIDE]);
    expect(store.getState().plugins[TRACER].review.status).toBe("not-approved");

    // The untouched Built-in re-seeds to shipped defaults and starts again now;
    // the modified copy stays review-required and is not restarted.
    expect(getPluginApproval(GUIDE)).toMatchObject({ enabled: true, granted: [] });
    expect(store.getState().plugins[GUIDE].review.status).toBe("approved");
    expect(harness.installedAgain).toEqual([GUIDE]);
    const echoesApproval = getPluginApproval(ECHOES);
    expect(echoesApproval?.pinnedHash).toBe(harness.echoesShippedHash);
    expect(store.getState().plugins[ECHOES]).toMatchObject({
      modified: true,
      review: { status: "review-required" },
    });

    // The Plugin Directory was only read, never written.
    expect(harness.replaceCalls.value).toBe(0);
  });
});
