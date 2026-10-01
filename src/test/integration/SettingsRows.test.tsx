import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { computeAccessibleName } from "dom-accessibility-api";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SETTINGS_SECTIONS,
  type SettingsRowId,
} from "@/components/settings/settings-sections";
import { currentSettingsPlatform, rowOnPlatform } from "@/features/settings/rows";
import { focusSettingsRow } from "@/features/settings/focus-row";
import { useSettingsRevealStore } from "@/features/settings/settings-reveal-store";

const { platformState, syncState, mockT } = vi.hoisted(() => ({
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
  // Stable t across renders: sections key effects on t, and a fresh function
  // identity every render would re-run them forever.
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

vi.mock("@/features/version", () => ({
  useVersionCheck: () => ({ latestVersion: null, isOutdated: false }),
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
  getDefaultBackupDirectory: vi.fn(async () =>
    platformState.isDesktop ? "/backups" : null
  ),
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
  });
  syncState.authStatus = "logged-in";
  syncState.userEmail = "writer@example.com";
}

/** Tabs from the top of the page until the named button is focused. */
async function tabToButton(user: ReturnType<typeof userEvent.setup>, name: string) {
  const target = screen.getByRole("button", { name });
  for (let i = 0; i < 200 && document.activeElement !== target; i++) {
    await user.tab();
  }
  expect(document.activeElement).toBe(target);
  return target;
}

/** Opens both collapsed blocks the way a keyboard author would (focus + Enter). */
async function openCollapsedBlocks(user: ReturnType<typeof userEvent.setup>) {
  for (const name of ["settings.advanced", "settings.pasteCleanup.advanced"]) {
    screen.getByRole("button", { name }).focus();
    await user.keyboard("{Enter}");
  }
}

const ORPHAN_SELECTOR =
  'button, input, select, textarea, [role="switch"], [role="slider"], [role="combobox"], [role="radio"]';

describe("Settings rows", () => {
  beforeEach(() => {
    platformState.isWeb = true;
    platformState.isDesktop = false;
    platformState.isAndroid = false;
    resetStores();
  });

  it.each(["web", "desktop"] as const)(
    "renders every declared row exactly once on %s",
    async (platform) => {
      platformState.isWeb = platform === "web";
      platformState.isDesktop = platform === "desktop";
      const user = userEvent.setup();
      renderSettings();

      // Rows inside the collapsed blocks only exist once opened.
      await openCollapsedBlocks(user);

      const actualPlatform = currentSettingsPlatform();
      expect(actualPlatform).toBe(platform);
      for (const section of SETTINGS_SECTIONS) {
        for (const row of section.rows) {
          const count = document.querySelectorAll(
            `[data-settings-row="${row.id}"]`
          ).length;
          expect(count, `${row.id} on ${platform}`).toBe(
            rowOnPlatform(row, actualPlatform) ? 1 : 0
          );
        }
      }
    }
  );

  it("keeps every named control inside a row", { timeout: 30_000 }, async () => {
    const user = userEvent.setup();
    renderSettings();
    await openCollapsedBlocks(user);

    const orphans: string[] = [];
    for (const element of document.querySelectorAll(ORPHAN_SELECTOR)) {
      const html = element as HTMLElement;
      // Dialogs portal outside the page; their buttons belong to the dialog.
      if (html.closest('[role="dialog"]')) continue;
      // Section disclosure toggles are not settings controls.
      if (html.matches("button[aria-expanded]") && !html.closest("[data-settings-row]"))
        continue;
      if (computeAccessibleName(html) === "") continue;
      if (!html.closest("[data-settings-row]")) {
        orphans.push(
          `${html.tagName.toLowerCase()}[${[...html.attributes].map((a) => a.name).join(",")}]`
        );
      }
    }
    expect(orphans).toEqual([]);
  });

  it("opens both collapsed blocks with Tab and Enter alone", async () => {
    const user = userEvent.setup();
    renderSettings();

    await tabToButton(user, "settings.pasteCleanup.advanced");
    await user.keyboard("{Enter}");
    expect(
      await screen.findByRole("switch", {
        name: "settings.pasteCleanup.option.demoteHeadings",
      })
    ).toBeInTheDocument();

    await tabToButton(user, "settings.advanced");
    await user.keyboard("{Enter}");
    expect(
      await screen.findByRole("button", { name: "settings.exportDatabaseButton" })
    ).toBeInTheDocument();
  }, 30_000);

  it("focuses the control of a normal row", async () => {
    renderSettings();
    const group = screen.getByRole("group", { name: "settings.theme" });
    const firstTheme = within(group).getAllByRole("button")[0];

    focusSettingsRow("theme");
    await waitFor(() => expect(document.activeElement).toBe(firstTheme));
    expect(useSettingsRevealStore.getState().pendingRowId).toBeNull();
  });

  it("opens the collapsed Advanced block to focus its row", async () => {
    renderSettings();
    expect(screen.queryByRole("button", { name: "settings.exportDatabaseButton" })).toBeNull();

    focusSettingsRow("exportDatabase");

    const button = await screen.findByRole("button", {
      name: "settings.exportDatabaseButton",
    });
    await waitFor(() => expect(document.activeElement).toBe(button));
  });

  it("opens the Paste Cleanup advanced block to focus its row", async () => {
    renderSettings();

    focusSettingsRow("pasteCleanupAdvanced");

    const row = await screen.findByRole("switch", {
      name: "settings.pasteCleanup.option.demoteHeadings",
    });
    await waitFor(() => expect(document.activeElement).toBe(row));
  });

  it("reveals a row inside the Dictation Language tab and focuses its control", async () => {
    useDictationStore.setState({
      support: { supported: true },
      installed: ["moonshine-tiny-en-260821", "moonshine-tiny-es-260824"],
    } as never);
    renderSettings();

    focusSettingsRow("dictationVocabulary");

    await waitFor(() => {
      const row = document.querySelector('[data-settings-row="dictationVocabulary"]');
      expect(row).not.toBeNull();
      expect(row?.contains(document.activeElement)).toBe(true);
    });
    expect(useSettingsRevealStore.getState().pendingRowId).toBeNull();
  });

  it("falls back to the section heading for a state-dependent row", async () => {
    syncState.authStatus = "logged-out";
    syncState.userEmail = null;
    renderSettings();
    expect(screen.queryByRole("switch", { name: "sync.autoSync" })).toBeNull();

    focusSettingsRow("syncAutoSync" as SettingsRowId);

    const heading = document.querySelector('[data-settings-section="sync"]') as HTMLElement;
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });
});
