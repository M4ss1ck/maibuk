import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

vi.mock("../../../i18n", () => ({
  default: {
    language: "en",
    changeLanguage: vi.fn(),
    use: vi.fn().mockReturnThis(),
    init: vi.fn(),
  },
  detectSystemLocale: vi.fn().mockResolvedValue("en"),
}));

vi.mock("../../../features/version", () => ({
  useVersionCheck: () => ({ latestVersion: null, isOutdated: false }),
}));

vi.mock("../../../lib/platform", () => ({
  IS_WEB: true,
  IS_TAURI: false,
  IS_ANDROID: false,
  IS_DESKTOP: false,
  isMac: () => false,
  getOS: vi.fn().mockResolvedValue({ platform: "linux" }),
  getDialog: vi.fn().mockResolvedValue({
    open: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue(null),
  }),
  getWebDialog: vi.fn().mockResolvedValue({
    openWithData: vi.fn().mockResolvedValue(null),
  }),
  getFileSystem: vi.fn().mockResolvedValue({}),
  createBackup: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../../lib/db", () => ({
  getDatabase: vi.fn().mockResolvedValue({}),
  exportDatabase: vi.fn().mockResolvedValue(new Uint8Array()),
  importDatabase: vi.fn().mockResolvedValue(undefined),
  resetDatabase: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../features/backup/backup-service", () => ({
  BackupService: vi.fn().mockImplementation(() => ({
    createBackup: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock("../../../features/sync/store", () => {
  const syncState = {
    apiUrl: "",
    setApiUrl: vi.fn(),
    authStatus: "logged-out",
    userEmail: null,
    logout: vi.fn(),
  };
  return {
    useSyncStore: (selector?: (state: typeof syncState) => unknown) =>
      selector ? selector(syncState) : syncState,
  };
});

vi.mock("../../../features/sync/useSyncFlow", () => ({
  useSyncFlow: () => ({
    showPassphraseDialog: false,
    closePassphraseDialog: vi.fn(),
    syncAllWithSessionPassphrase: vi.fn(),
    completePassphraseFlow: vi.fn(),
    activeConflict: null,
    resolveConflict: vi.fn(),
  }),
}));

// Sub-components are covered by their own tests; null them so this page test
// can assert page-level layout without pulling in their async data loads.
vi.mock("@/components/settings/BackupSection", () => ({ BackupSection: () => null }));
vi.mock("@/components/settings/MetricsSection", () => ({ MetricsSection: () => null }));
vi.mock("@/components/settings/PasteCleanupSection", () => ({ PasteCleanupSection: () => null }));
vi.mock("@/components/settings/AsciiBanner", () => ({ AsciiBanner: () => null }));
vi.mock("@/components/settings/AsciiFieldBackground", () => ({ AsciiFieldBackground: () => null }));
vi.mock("@/components/sync/SyncControls", () => ({ SyncControls: () => null }));
vi.mock("@/components/sync/AuthDialog", () => ({ AuthDialog: () => null }));
vi.mock("@/components/sync/PassphraseDialog", () => ({ PassphraseDialog: () => null }));
vi.mock("@/components/sync/ConflictDialog", () => ({ ConflictDialog: () => null }));

const { Settings } = await import("@/pages/Settings");
const { useSettingsStore } = await import("@/features/settings/store");

describe("Settings page — container-aware layout", () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({
      appFontSize: 16,
      appFont: "literata",
      primaryColor: "#3b82f6",
      autoSave: true,
      alwaysOnTop: false,
      launchOnStartup: false,
      closeToTray: false,
      language: "en",
      defaultExportFormat: "epub",
      spellCheckEnabled: true,
      customDictionary: [],
      dictionaryOpenInBrowser: false,
      showInlineFootnotes: false,
      showNotesChapter: false,
      hideKeyboardHints: false,
      editorAutoClose: false,
    } as never);
  });

  it("marks the content wrapper as the container, not the page shell", () => {
    render(<Settings />);

    const wrapper = document.querySelector(".max-w-2xl");
    expect(wrapper).not.toBeNull();
    expect(wrapper).toHaveClass("@container");
    // Page-shell padding stays a viewport decision.
    expect(wrapper).toHaveClass("p-4", "sm:p-8");
    expect(document.querySelector(".overflow-auto")).not.toHaveClass("@container");
  });

  it("keys heading and section density to the content container", () => {
    render(<Settings />);

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveClass("text-xl", "@lg:text-2xl");
    expect(heading).not.toHaveClass("sm:text-2xl");

    const section = screen.getByText("settings.appearance").closest("section");
    expect(section).not.toBeNull();
    expect(section).toHaveClass("p-4", "@lg:p-5", "mb-6", "@lg:mb-8");
    expect(section).not.toHaveClass("sm:p-5");
  });

  it("uses container variants for setting rows", () => {
    render(<Settings />);

    const themeRow = screen.getByRole("button", { name: "settings.light" }).closest(".py-2");
    expect(themeRow).not.toBeNull();
    expect(themeRow).toHaveClass(
      "flex-col",
      "@lg:flex-row",
      "@lg:items-center",
      "gap-2",
      "@lg:gap-4"
    );
    expect(themeRow).not.toHaveClass("sm:flex-row");

    // The sync server row hosts a fixed 320px input, so it waits for the
    // roomier container threshold.
    const syncRow = screen.getByPlaceholderText("sync.example.com").closest(".py-3");
    expect(syncRow).not.toBeNull();
    expect(syncRow).toHaveClass("@xl:flex-row", "@xl:items-center", "@xl:gap-4");
    expect(syncRow).not.toHaveClass("sm:flex-row");
  });

  it("sizes the sync server input from the container instead of the viewport", () => {
    render(<Settings />);

    const input = screen.getByPlaceholderText("sync.example.com");
    const row = input.closest(".py-3") as HTMLElement;
    const inputWrapper = Array.from(row.children).find(
      (el) => el instanceof HTMLElement && el.classList.contains("w-full")
    );
    expect(inputWrapper).not.toBeNull();
    expect(inputWrapper).toHaveClass("w-full", "@xl:w-80");
    expect(inputWrapper).not.toHaveClass("sm:w-80");
  });
});
