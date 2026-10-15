import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { focusSettingsRow } from "@/features/settings/focus-row";
import { useSettingsRevealStore } from "@/features/settings/settings-reveal-store";
import { registerPluginSettingsRows } from "@/features/settings/rows";
import { buildSettingsItems } from "@/features/command-palette/settings-items";
import {
  resetPluginLifecycleForTests,
  setPluginLifecycleInstance,
} from "@/features/plugins/lifecycle-instance";
import { createTestHost } from "@/features/plugins/test-kit";
import type { PluginLifecycle, PluginRuntime } from "@/features/plugins/types";
import { createPluginClient } from "@/plugin-sdk";
import { ui } from "@/plugin-sdk/ui";
import { servePluginUi } from "@/plugin-sdk/ui-serve";
import { PLUGIN_UI_MOUNT_REQUEST } from "@/plugin-sdk/protocol";
import { PLUGIN_MANIFEST } from "@/test/support/plugin-fixtures";

const { platformState, mockT, syncState } = vi.hoisted(() => ({
  platformState: { isWeb: true, isDesktop: false, isAndroid: false },
  mockT: (key: string) => key,
  syncState: {
    apiUrl: "",
    setApiUrl: vi.fn(),
    authStatus: "logged-in" as "logged-out" | "logged-in",
    userEmail: "writer@example.com" as string | null,
    logout: vi.fn(),
    syncStatus: "idle",
    pendingDeletions: [],
    syncLog: [],
    confirmPendingDeletions: vi.fn(async () => {}),
    clearSyncLog: vi.fn(),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: mockT,
    i18n: { language: "en", resolvedLanguage: "en" },
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

vi.mock("@/i18n", () => ({
  default: {
    language: "en",
    changeLanguage: vi.fn(),
    use: vi.fn().mockReturnThis(),
    init: vi.fn(),
  },
  detectSystemLocale: vi.fn().mockResolvedValue("en"),
}));

vi.mock("@/lib/platform", () => ({
  get IS_WEB() {
    return platformState.isWeb;
  },
  get IS_TAURI() {
    return !platformState.isWeb;
  },
  get IS_DESKTOP() {
    return platformState.isDesktop;
  },
  get IS_ANDROID() {
    return platformState.isAndroid;
  },
  isMac: () => false,
  dictationPlatform: () => "web",
  setLaunchOnStartup: vi.fn(async () => undefined),
  getOS: vi.fn(async () => ({})),
  getDialog: vi.fn(async () => ({})),
  getWebDialog: vi.fn(async () => ({})),
  getFileSystem: vi.fn(async () => ({})),
  BACKUP_DIRECTORY_NOT_APPROVED: "BACKUP_DIRECTORY_NOT_APPROVED",
  createBackup: vi.fn(async () => ({
    listBackupsPage: async () => ({
      entries: [],
      totalCount: 0,
      totalSizeBytes: 0,
      page: 1,
      pageSize: 10,
    }),
  })),
  getDefaultBackupDirectory: vi.fn(async () => null),
  pickBackupDirectory: vi.fn(async () => null),
  requestBackupDirectory: vi.fn(async () => true),
  restoreBackupDirectory: vi.fn(async () => undefined),
  forgetBackupDirectory: vi.fn(async () => undefined),
}));

vi.mock("@/lib/db", () => ({
  getDatabase: vi.fn(async () => ({})),
  exportDatabase: vi.fn(async () => new Uint8Array()),
  importDatabase: vi.fn(async () => undefined),
  resetDatabase: vi.fn(async () => undefined),
}));

vi.mock("@/features/metrics/events-repo", () => ({
  getCategoryMeasuringSince: vi.fn(async () => null),
}));

vi.mock("@/features/dictation/runtime", () => ({
  getDictation: async () => ({
    stats: { summary: () => null },
    host: { inputDevice: async () => null },
  }),
}));

vi.mock("@/features/sync/store", () => ({
  useSyncStore: (selector?: (state: typeof syncState) => unknown) =>
    selector ? selector(syncState) : syncState,
}));

vi.mock("@/features/sync/useSyncFlow", () => ({
  useSyncFlow: () => ({
    showPassphraseDialog: false,
    closePassphraseDialog: vi.fn(),
    syncAllWithSessionPassphrase: vi.fn(async () => {}),
    completePassphraseFlow: vi.fn(),
    activeConflict: null,
    resolveConflict: vi.fn(),
  }),
}));

vi.mock("@/components/shortcuts/ShortcutEditorDialog", () => ({
  ShortcutEditorDialog: () => null,
}));
vi.mock("@/components/sync/AuthDialog", () => ({ AuthDialog: () => null }));
vi.mock("@/components/sync/PassphraseDialog", () => ({ PassphraseDialog: () => null }));
vi.mock("@/components/sync/ConflictDialog", () => ({ ConflictDialog: () => null }));
vi.mock("@/components/settings/AsciiBanner", () => ({ AsciiBanner: () => null }));
vi.mock("@/components/settings/AsciiFieldBackground", () => ({
  AsciiFieldBackground: () => null,
}));

const { Settings } = await import("@/pages/Settings");
const { useSettingsStore } = await import("@/features/settings/store");
const { useDictationStore } = await import("@/features/dictation/store");

const unregisters: Array<() => void> = [];
afterEach(() => {
  while (unregisters.length > 0) unregisters.pop()?.();
});

/** The mounted row anchor; throws until it exists, so `waitFor` can poll it. */
function settingsRow(id: string): HTMLElement {
  const row = document.querySelector<HTMLElement>(`[data-settings-row="${id}"]`);
  if (row === null) throw new Error(`Settings row ${id} is not mounted`);
  return row;
}

function renderSettings() {
  return render(
    <MemoryRouter initialEntries={["/settings"]}>
      <Settings />
    </MemoryRouter>
  );
}

function resetStores() {
  localStorage.clear();
  useSettingsStore.setState({
    autoSave: true,
    language: "en",
    customDictionary: [],
    autoSync: true,
  } as never);
  useDictationStore.setState({
    enabled: true,
    support: { supported: true },
    installed: [],
    downloads: {},
    preferredTier: { en: "fast", es: "fast" },
    languageOverride: null,
  } as never);
  useSettingsRevealStore.setState({
    pendingRowId: null,
    advancedOpen: false,
    pasteCleanupAdvancedOpen: false,
    pluginOpen: {},
  });
}

describe("Plugins Settings section", () => {
  beforeEach(() => {
    resetStores();
  });

  it("shows its empty state with zero owners", () => {
    renderSettings();
    // Section heading from the static declaration.
    expect(document.querySelector('[data-settings-section="plugins"]')).not.toBeNull();
    expect(screen.getByText("settings.pluginsEmpty")).toBeInTheDocument();
    expect(screen.getByText("settings.pluginsEmptyDescription")).toBeInTheDocument();
  });

  it("finds runtime rows by Settings search without running anything", () => {
    unregisters.push(
      registerPluginSettingsRows("echoes", {
        displayName: "Echoes",
        rows: [
          {
            id: "threshold",
            label: "Echo threshold",
            description: "How alike two passages must be",
            keywords: ["echo", "repeat"],
          },
        ],
      })
    );
    const t = ((key: string) => key) as never;
    const items = buildSettingsItems({ t, platform: "web" });
    const found = items.find((item) => item.id === "plugin.echoes.threshold");
    expect(found).toBeDefined();
    expect(found?.label).toBe("Echo threshold");
    expect(found?.detail).toBe("settings.plugins");
    expect(found?.terms).toContain("How alike two passages must be");
    expect(found?.terms).toContain("echo");
  });

  it("opens the owning accordion by keyboard and mounts the row, and a search result reveals it", async () => {
    unregisters.push(
      registerPluginSettingsRows("echoes", {
        displayName: "Echoes",
        rows: [{ id: "threshold", label: "Echo threshold" }],
      })
    );
    const user = userEvent.setup();
    renderSettings();

    const rowIn = () =>
      document.querySelector('[data-settings-row="plugin.echoes.threshold"]');

    // The accordion starts closed: its row is not mounted.
    expect(rowIn()).toBeNull();

    // Tab to the accordion trigger and open it with Enter alone.
    const trigger = screen.getByRole("button", { name: "Echoes" });
    for (let i = 0; i < 200 && document.activeElement !== trigger; i++) {
      await user.tab();
    }
    expect(document.activeElement).toBe(trigger);
    await user.keyboard("{Enter}");
    // The row anchor mounts with the declaration's label. Its live controls are
    // the Plugin's Remote UI body, mounted only while a Plugin is running
    // (proved host-side in PluginsSection.test.tsx).
    expect(rowIn()).not.toBeNull();
    expect(screen.getByText("Echo threshold")).toBeInTheDocument();

    // The trigger keeps focus; Enter closes the accordion again.
    expect(document.activeElement).toBe(trigger);
    await user.keyboard("{Enter}");
    expect(rowIn()).toBeNull();

    // Following a search result opens the accordion and mounts the row.
    focusSettingsRow("plugin.echoes.threshold");
    await waitFor(() => expect(rowIn()).not.toBeNull());
    await waitFor(() => expect(useSettingsRevealStore.getState().pendingRowId).toBeNull());
    expect(useSettingsRevealStore.getState().pluginOpen.echoes).toBe(true);
  });

  it("reveals a Plugin Settings row and focuses its mounted control", async () => {
    unregisters.push(
      registerPluginSettingsRows("echoes", {
        displayName: "Echoes",
        rows: [{ id: "threshold", label: "Echo threshold" }],
      })
    );

    // A running Plugin serving the row's body, so the mounted control is real.
    const host = createTestHost({ manifest: PLUGIN_MANIFEST });
    try {
      function ThresholdBody() {
        return <ui.Switch label="Echo threshold" isSelected={false} onChange={() => {}} />;
      }
      servePluginUi(createPluginClient(host.port), {
        pages: {},
        settingsRows: { threshold: ThresholdBody },
      });
      installReadyLifecycle("echoes", {
        manifest: PLUGIN_MANIFEST,
        broker: host.broker,
        stop: () => {},
      });

      renderSettings();
      focusSettingsRow("plugin.echoes.threshold");

      // Query inside the row: a name lookup over the whole Settings page costs
      // most of a second per mutation and starves the mount it waits for.
      const row = await waitFor(() => settingsRow("plugin.echoes.threshold"));
      const control = await within(row).findByRole("switch", { name: "Echo threshold" });
      await waitFor(() => expect(document.activeElement).toBe(control));
      expect(useSettingsRevealStore.getState().pendingRowId).toBeNull();
    } finally {
      host.stop();
      resetPluginLifecycleForTests();
    }
  });

  it("keeps a reveal pending until a slow Plugin row body mounts its control", async () => {
    unregisters.push(
      registerPluginSettingsRows("echoes", {
        displayName: "Echoes",
        rows: [{ id: "threshold", label: "Echo threshold" }],
      })
    );

    // The Plugin answers `ui.mount` only when the test says so: the row anchor
    // is on screen long before its control, the way a cold or slow Plugin is.
    const host = createTestHost({ manifest: PLUGIN_MANIFEST });
    let answerMount = () => {};
    const mountAnswered = new Promise<void>((resolve) => {
      answerMount = resolve;
    });
    const client = createPluginClient(host.port);
    try {
      function ThresholdBody() {
        return <ui.Switch label="Echo threshold" isSelected={false} onChange={() => {}} />;
      }
      servePluginUi(
        {
          onHostRequest: (handler) =>
            client.onHostRequest(async (method, params) => {
              if (method === PLUGIN_UI_MOUNT_REQUEST) await mountAnswered;
              return handler(method, params);
            }),
        },
        { pages: {}, settingsRows: { threshold: ThresholdBody } }
      );
      installReadyLifecycle("echoes", {
        manifest: PLUGIN_MANIFEST,
        broker: host.broker,
        stop: () => {},
      });

      renderSettings();
      focusSettingsRow("plugin.echoes.threshold");

      const row = await waitFor(() => settingsRow("plugin.echoes.threshold"));
      // Well past the reveal's missing-control frame budget.
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(within(row).queryByRole("switch")).toBeNull();
      expect(useSettingsRevealStore.getState().pendingRowId).toBe("plugin.echoes.threshold");

      answerMount();
      const control = await within(row).findByRole("switch", { name: "Echo threshold" });
      await waitFor(() => expect(document.activeElement).toBe(control));
      expect(useSettingsRevealStore.getState().pendingRowId).toBeNull();
    } finally {
      host.stop();
      resetPluginLifecycleForTests();
    }
  });

  describe("with a Plugin that never answers its row mount", () => {
    let host: ReturnType<typeof createTestHost>;

    beforeEach(() => {
      unregisters.push(
        registerPluginSettingsRows("echoes", {
          displayName: "Echoes",
          rows: [{ id: "threshold", label: "Echo threshold" }],
        })
      );
      host = createTestHost({ manifest: PLUGIN_MANIFEST });
      const client = createPluginClient(host.port);
      servePluginUi(
        {
          onHostRequest: (handler) =>
            client.onHostRequest((method, params) =>
              method === PLUGIN_UI_MOUNT_REQUEST
                ? new Promise<never>(() => {})
                : handler(method, params)
            ),
        },
        { pages: {}, settingsRows: { threshold: () => null } }
      );
      installReadyLifecycle("echoes", {
        manifest: PLUGIN_MANIFEST,
        broker: host.broker,
        stop: () => {},
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
      host.stop();
      resetPluginLifecycleForTests();
    });

    it("still reveals a row in a later section", async () => {
      useSettingsRevealStore.setState({ pluginOpen: { echoes: true } });
      renderSettings();
      await waitFor(() => settingsRow("plugin.echoes.threshold"));

      focusSettingsRow("exportDatabase");

      await waitFor(() => expect(useSettingsRevealStore.getState().pendingRowId).toBeNull());
      expect(settingsRow("exportDatabase").contains(document.activeElement)).toBe(true);
    });

    it("gives up the wait on its own row once the start budget passes", async () => {
      renderSettings();
      focusSettingsRow("plugin.echoes.threshold");
      await waitFor(() => settingsRow("plugin.echoes.threshold"));
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(useSettingsRevealStore.getState().pendingRowId).toBe("plugin.echoes.threshold");

      const start = performance.now();
      vi.spyOn(performance, "now").mockImplementation(() => start + 60_000);

      await waitFor(() => expect(useSettingsRevealStore.getState().pendingRowId).toBeNull());
    });
  });
});

/**
 * Installs a fake lifecycle whose one Plugin is ready, so a Settings row mounts
 * the Plugin's Remote UI body the way the app does when it is running.
 */
function installReadyLifecycle(pluginId: string, runtime: PluginRuntime): void {
  const ready = { status: "ready", startReason: "enable" } as const;
  const lifecycle = {
    launch: async () => {},
    installed: () => [],
    launchScanned: () => true,
    onLaunchScanned: () => () => {},
    surfaceReached: () => {},
    surfaceLeft: () => {},
    start: async () => ({ ok: true, startReason: "enable" }),
    install: async () => ({ ok: true, startReason: "enable" }),
    uninstall: () => {},
    stop: () => {},
    state: (id: string) => (id === pluginId ? ready : null),
    runtime: (id: string) => (id === pluginId ? runtime : null),
    subscribe: () => () => {},
    dispose: () => {},
  } as unknown as PluginLifecycle;
  setPluginLifecycleInstance(lifecycle);
}
