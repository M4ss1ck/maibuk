import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { focusSettingsRow } from "@/features/settings/focus-row";
import { useSettingsRevealStore } from "@/features/settings/settings-reveal-store";
import { registerPluginSettingsRows } from "@/features/settings/rows";
import { buildSettingsItems } from "@/features/command-palette/settings-items";

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

  it("opens the owning accordion by keyboard and focuses the row, and a search result reveals it", async () => {
    unregisters.push(
      registerPluginSettingsRows("echoes", {
        displayName: "Echoes",
        rows: [{ id: "threshold", label: "Echo threshold" }],
      })
    );
    const user = userEvent.setup();
    renderSettings();

    // The accordion starts closed: its row is not mounted.
    expect(screen.queryByLabelText("Echo threshold")).toBeNull();

    // Tab to the accordion trigger and open it with Enter alone.
    const trigger = screen.getByRole("button", { name: "Echoes" });
    trigger.focus();
    expect(document.activeElement).toBe(trigger);
    await user.keyboard("{Enter}");
    const field = await screen.findByLabelText("Echo threshold");
    expect(field).toBeInTheDocument();

    // Tab to the row's field with the keyboard alone.
    trigger.focus();
    await user.keyboard("{Enter}");
    // Closed again.
    expect(screen.queryByLabelText("Echo threshold")).toBeNull();

    // Following a search result opens the accordion and focuses the row.
    focusSettingsRow("plugin.echoes.threshold" as never);
    await waitFor(() => expect(screen.getByLabelText("Echo threshold")).toBeInTheDocument());
    await waitFor(() =>
      expect((screen.getByLabelText("Echo threshold") as HTMLElement) === document.activeElement).toBe(
        true
      )
    );
    expect(useSettingsRevealStore.getState().pendingRowId).toBeNull();
    expect(useSettingsRevealStore.getState().pluginOpen["echoes"]).toBe(true);
  });
});
