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
import { getKnownPlugin, saveKnownPlugin } from "@/features/plugins/known";
import {
  resetPluginLifecycleForTests,
  setPluginLifecycleInstance,
} from "@/features/plugins/lifecycle-instance";
import {
  createPluginManagementStore,
  usePluginManagementStore,
} from "@/features/plugins/management";
import {
  createMemoryPluginFileGrantStore,
  registerPluginFileGrantStore,
} from "@/features/plugins/file-grants";
import {
  createMemoryPluginSecretStore,
  registerPluginSecretStore,
} from "@/features/plugins/secret-store";
import { getPluginStorageValue, setPluginStorageValue } from "@/features/plugins/storage";
import { createTestHost } from "@/features/plugins/test-kit";
import type {
  BuiltInPlugin,
  BuiltInPluginSource,
  PluginFolder,
  PluginLifecycle,
  PluginManifest,
  PluginStartReason,
} from "@/features/plugins/types";
import { voiceEligibleCommands } from "@/features/dictation/voice-commands";
import { resetAllSettings } from "@/features/settings/reset-all";
import { useSettingsStore } from "@/features/settings/store";
import { useShortcutSettingsStore } from "@/features/settings/shortcut-store";
import { normalizeShortcuts } from "@/lib/shortcut-resolve";
import type { PluginDirectoryAdapter } from "@/lib/platform/types";
import { createPluginClient } from "@/plugin-sdk";
import { createTestDatabase } from "@/test/support/db-test-context";
import { PLUGIN_MANIFEST, pluginFolder } from "@/test/support/plugin-fixtures";

// The real storage module reads the database; only the handle is a stand-in, so
// the Reset settings test can prove Plugin Library data survives the reset.
const mockGetDatabase = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDatabase: mockGetDatabase,
}));

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
  installReasons: Array<{ pluginId: string; reason: PluginStartReason }>;
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
    kind: "web",
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
  const installReasons: Array<{ pluginId: string; reason: PluginStartReason }> = [];
  const lifecycle = {
    installed: () => installed,
    uninstall: (pluginId: string) => {
      uninstalled.push(pluginId);
    },
    install: async (pluginId: string, reason: PluginStartReason) => {
      installedAgain.push(pluginId);
      installReasons.push({ pluginId, reason });
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
    installReasons,
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
  registerPluginSecretStore(null);
  registerPluginFileGrantStore(null);
  usePluginManagementStore.setState({ plugins: {}, notifications: [] });
  localStorage.removeItem(PLUGIN_APPROVALS_STORAGE_KEY);
  useSettingsStore.setState({ appFontSize: 16, pluginDevelopmentMode: false });
});

describe("resetAllSettings", () => {
  it("clears settings, shortcuts, approvals, and credentials, re-seeds Built-ins, and leaves an untouched one off", async () => {
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
    const clearFileGrants = vi.fn(async () => {});

    await resetAllSettings({
      clearCredentials,
      clearFileGrants,
      // Mirror the refreshed entries into the app's management singleton, as
      // the default refresh would.
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
    // So are File Grants.
    expect(clearFileGrants).toHaveBeenCalledTimes(1);

    // The third-party approval is cleared and the Plugin is stopped.
    expect(getPluginApproval(TRACER)).toBeNull();
    expect(harness.uninstalled).toEqual([TRACER, GUIDE]);
    expect(store.getState().plugins[TRACER].review.status).toBe("not-approved");

    // The untouched Built-in re-seeds to its shipped default: pre-granted but
    // off, so it is not started again even though it was running; the modified
    // copy stays review-required.
    expect(getPluginApproval(GUIDE)).toMatchObject({ enabled: false, granted: [] });
    expect(store.getState().plugins[GUIDE].review.status).toBe("approved");
    expect(harness.installedAgain).toEqual([]);
    const echoesApproval = getPluginApproval(ECHOES);
    expect(echoesApproval?.pinnedHash).toBe(harness.echoesShippedHash);
    expect(store.getState().plugins[ECHOES]).toMatchObject({
      modified: true,
      review: { status: "review-required" },
    });

    // The Plugin Directory was only read, never written.
    expect(harness.replaceCalls.value).toBe(0);
  });

  it("deletes every saved Plugin credential through the registered keyring", async () => {
    const keyring = createMemoryPluginSecretStore();
    await keyring.set(TRACER, "token", "tracer-token");
    await keyring.set(GUIDE, "token", "guide-token");
    registerPluginSecretStore(keyring);
    await expect(keyring.listNames(TRACER)).resolves.toHaveLength(1);
    await expect(keyring.listNames(GUIDE)).resolves.toHaveLength(1);

    await resetAllSettings({
      stopPlugins: () => {},
      refreshPlugins: async () => {},
    });

    // The store the app registered holds nothing after the reset.
    await expect(keyring.listNames(TRACER)).resolves.toEqual([]);
    await expect(keyring.listNames(GUIDE)).resolves.toEqual([]);
  });

  it("ends every File Grant through the registered store", async () => {
    const grants = createMemoryPluginFileGrantStore([
      { pluginId: TRACER, name: "a.pdf", bytes: new Uint8Array([1]) },
      { pluginId: GUIDE, name: "b.pdf", bytes: new Uint8Array([2]) },
    ]);
    registerPluginFileGrantStore(grants);
    await expect(grants.list(TRACER)).resolves.toHaveLength(1);

    await resetAllSettings({
      stopPlugins: () => {},
      refreshPlugins: async () => {},
    });

    await expect(grants.list(TRACER)).resolves.toEqual([]);
    await expect(grants.list(GUIDE)).resolves.toEqual([]);
  });

  it("erases every user-modified Plugin category while Plugin Library data stays", async () => {
    mockGetDatabase.mockResolvedValue(await createTestDatabase());

    // Grants, the integrity approval (pinned hash), and the enabled preference
    // all live on the approval record.
    savePluginApproval({
      pluginId: TRACER,
      pinnedHash: "h1:approved",
      granted: ["library:read"],
      enabled: false,
      approvedVersion: "1.0.0",
      approvedPermissions: { required: ["library:read"], optional: [] },
      approvedFiles: {},
    });
    saveKnownPlugin({
      pluginId: TRACER,
      manifest: PLUGIN_MANIFEST,
      builtIn: false,
      removed: false,
    });
    // A Plugin Custom Shortcut and a Plugin Voice Command.
    useShortcutSettingsStore.setState({
      shortcuts: normalizeShortcuts({
        version: 2,
        custom: { "plugin.tracer.report": [["Mod+Alt+t"]] },
        voice: { "plugin.tracer.report": { en: ["show tracer report"] } },
        singleKeyEnabled: false,
      }),
    });
    // A saved secret.
    const secrets = createMemoryPluginSecretStore();
    await secrets.set(TRACER, "token", "tracer-token");
    registerPluginSecretStore(secrets);
    // Plugin Library data is not a setting.
    await setPluginStorageValue(TRACER, "report", { kept: true });

    await resetAllSettings({
      // Only the Plugin lifecycle bits are stand-ins; every category store and
      // the keyring are the real ones.
      stopPlugins: () => {},
      refreshPlugins: async () => {},
    });

    expect(getPluginApproval(TRACER)).toBeNull();
    expect(getKnownPlugin(TRACER)).toBeNull();
    expect(useShortcutSettingsStore.getState().shortcuts.custom).toEqual({});
    expect(useShortcutSettingsStore.getState().shortcuts.voice).toEqual({});
    await expect(secrets.read(TRACER, "token")).resolves.toBeNull();
    // Plugin Library data survives the reset.
    await expect(getPluginStorageValue(TRACER, "report")).resolves.toEqual({ kept: true });
  });

  it("still runs every other step when deleting credentials fails, then rejects", async () => {
    const failure = new Error("keychain locked");
    const clearCredentials = vi.fn(async () => {
      throw failure;
    });
    const settings = vi.fn();
    const shortcuts = vi.fn();
    const approvals = vi.fn();
    const known = vi.fn();
    const stopPlugins = vi.fn();
    const refreshPlugins = vi.fn(async () => {});

    await expect(
      resetAllSettings({
        clearCredentials,
        settings,
        shortcuts,
        approvals,
        known,
        stopPlugins,
        refreshPlugins,
      })
    ).rejects.toBe(failure);

    expect(stopPlugins).toHaveBeenCalledTimes(1);
    expect(settings).toHaveBeenCalledTimes(1);
    expect(shortcuts).toHaveBeenCalledTimes(1);
    expect(approvals).toHaveBeenCalledTimes(1);
    expect(known).toHaveBeenCalledTimes(1);
    expect(refreshPlugins).toHaveBeenCalledTimes(1);
  });

  it("starts no Plugin again: a running Built-in returns to off and the third-party Plugin needs approval again", async () => {
    const harness = await setup();
    await harness.store.getState().refresh();

    await resetAllSettings({
      refreshPlugins: async () => {
        await harness.store.getState().refresh();
        usePluginManagementStore.setState({ plugins: harness.store.getState().plugins });
      },
    });

    // Reset returns every Plugin to its default, and a Built-in's default is
    // off, so nothing is started again.
    expect(harness.installReasons).toEqual([]);
    expect(harness.installedAgain).toEqual([]);
    expect(getPluginApproval(GUIDE)?.enabled).toBe(false);
    expect(getPluginApproval(TRACER)).toBeNull();
  });

  it("refuses a running Plugin's permission-gated call once the reset erases its grant", async () => {
    // The lifecycle feeds the broker `granted: () => getPluginApproval(id)?.granted`
    // (lifecycle.ts:561), re-read on every call.
    savePluginApproval({
      pluginId: PLUGIN_MANIFEST.id,
      pinnedHash: "h1:granted",
      granted: ["library:read"],
      enabled: true,
      approvedVersion: "1.0.0",
      approvedPermissions: { required: ["library:read"], optional: [] },
      approvedFiles: {},
    });
    const book = {
      id: "b1",
      title: "Dune",
      subtitle: null,
      authorName: "Frank",
      genre: null,
      language: "en",
      wordCount: 10,
      targetWordCount: null,
      status: "draft" as const,
      updatedAt: 0,
    };
    const host = createTestHost({
      manifest: {
        ...PLUGIN_MANIFEST,
        permissions: { required: ["library:read"], optional: [] },
      },
      permissions: ["library:read"],
      library: { books: [book] },
    });
    try {
      const client = createPluginClient(host.port);
      await expect(client.library.books.list()).resolves.toEqual([book]);

      await resetAllSettings({
        stopPlugins: () => {},
        refreshPlugins: async () => {},
      });

      // The reset erased the grant; the broker re-reads it and refuses the call.
      const remaining = getPluginApproval(PLUGIN_MANIFEST.id)?.granted ?? [];
      expect(remaining).toEqual([]);
      host.setGranted(remaining);
      await expect(client.library.books.list()).rejects.toMatchObject({
        code: "permission-denied",
      });
    } finally {
      host.stop();
    }
  });
});
