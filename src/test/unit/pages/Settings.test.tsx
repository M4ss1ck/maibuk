import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsRevealStore } from "@/features/settings/settings-reveal-store";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { resolvedLanguage: "en" } }),
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

const { syncState } = vi.hoisted(() => ({
  syncState: {
    apiUrl: "",
    setApiUrl: vi.fn(),
    authStatus: "logged-out" as "logged-out" | "logged-in",
    userEmail: null as string | null,
    logout: vi.fn(),
  },
}));

vi.mock("../../../features/sync/store", () => ({
  useSyncStore: (selector?: (state: typeof syncState) => unknown) =>
    selector ? selector(syncState) : syncState,
}));

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
vi.mock("@/components/settings/DictationSection", () => ({ DictationSection: () => null }));
vi.mock("@/components/settings/AsciiBanner", () => ({ AsciiBanner: () => null }));
vi.mock("@/components/settings/AsciiFieldBackground", () => ({ AsciiFieldBackground: () => null }));
vi.mock("@/components/sync/SyncControls", () => ({ SyncControls: () => null }));
vi.mock("@/components/sync/AuthDialog", () => ({ AuthDialog: () => null }));
vi.mock("@/components/sync/PassphraseDialog", () => ({ PassphraseDialog: () => null }));
vi.mock("@/components/sync/ConflictDialog", () => ({ ConflictDialog: () => null }));

const { Settings } = await import("@/pages/Settings");
const { useSettingsStore } = await import("@/features/settings/store");

// Settings reads the route hash (to scroll to a linked section), so it needs a Router.
function renderSettings(initialEntries: string[] = ["/settings"]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Settings />
    </MemoryRouter>
  );
}

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
    renderSettings();

    const wrapper = document.querySelector(".max-w-2xl");
    expect(wrapper).not.toBeNull();
    expect(wrapper).toHaveClass("@container");
    // Page-shell padding stays a viewport decision.
    expect(wrapper).toHaveClass("p-4", "sm:p-8");
    // The scroll area is a container too: the outline beside the sections
    // appears once the panel (not the viewport) is wide enough.
    expect(document.querySelector(".overflow-auto")).toHaveClass("@container");
  });

  // Regression: the hash scrolled two frames after mount, before the Backup
  // list above Dictation had loaded; its growth left the page on Editor. The
  // hash now goes through the row request, which waits for that loading
  // (SettingsRows.test covers the request's scroll and focus).
  it("requests the Dictation section's first row when linked by hash", () => {
    const requestRow = vi.spyOn(useSettingsRevealStore.getState(), "requestRow");
    try {
      renderSettings(["/settings#dictation"]);
      expect(requestRow).toHaveBeenCalledWith("dictationEnabled", "section");
    } finally {
      requestRow.mockRestore();
      useSettingsRevealStore.getState().clearRow();
    }
  });

  it("does not scroll when Settings opens without a hash", async () => {
    const original = Element.prototype.scrollIntoView;
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      renderSettings();
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      );
      expect(scrollIntoView).not.toHaveBeenCalled();
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("keys heading and section density to the content container", () => {
    renderSettings();

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveClass("text-xl", "@lg:text-2xl");
    expect(heading).not.toHaveClass("sm:text-2xl");

    const section = screen.getByRole("heading", { name: "settings.appearance" }).closest("section");
    expect(section).not.toBeNull();
    expect(section).toHaveClass("p-4", "@lg:p-5", "mb-6", "@lg:mb-8");
    expect(section).not.toHaveClass("sm:p-5");
  });

  it("changes the primary color by keyboard without a native color input", async () => {
    const user = userEvent.setup();
    renderSettings();
    const trigger = screen.getByRole("button", { name: "settings.primaryColor" });
    trigger.focus();
    await user.keyboard("{Enter}");
    const field = await screen.findByRole("textbox", { name: "colorPicker.hexValue" });
    await user.clear(field);
    await user.type(field, "#f50{Enter}");
    expect(useSettingsStore.getState().primaryColor).toBe("#FF5500");
    expect(
      screen.queryByLabelText("settings.primaryColor", { selector: 'input[type="color"]' })
    ).toBeNull();
  });

  it("marks the current theme as pressed and switches it from the keyboard", async () => {
    const user = userEvent.setup();
    const { useThemeStore } = await import("@/features/theme/store");
    useThemeStore.setState({ theme: "system" });
    renderSettings();

    const group = screen.getByRole("group", { name: "settings.theme" });
    const button = (name: string) => within(group).getByRole("button", { name });
    expect(button("settings.system")).toHaveAttribute("aria-pressed", "true");
    expect(button("settings.dark")).toHaveAttribute("aria-pressed", "false");

    button("settings.light").focus();
    await user.keyboard("{Tab}{Enter}");

    expect(useThemeStore.getState().theme).toBe("dark");
    expect(button("settings.dark")).toHaveAttribute("aria-pressed", "true");
    expect(button("settings.system")).toHaveAttribute("aria-pressed", "false");
  });

  it("uses container variants for setting rows", () => {
    renderSettings();

    const themeRow = screen.getByRole("button", { name: "settings.light" }).closest(".py-3");
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

  it("renders every section as the same card with an h2 title", () => {
    renderSettings();

    const headings = [...document.querySelectorAll<HTMLElement>("[data-settings-section]")];
    // Every section the web build shows (Window is desktop-only).
    expect(headings.map((h) => h.dataset.settingsSection)).toEqual([
      "appearance",
      "general",
      "shortcuts",
      "sync",
      "backups",
      "metrics",
      "editor",
      "dictation",
      "export",
      "tutorial",
      "advanced",
      "about",
    ]);
    const cardClass = headings[0].closest("section")?.className;
    expect(cardClass).toContain("rounded-xl");
    for (const heading of headings) {
      expect(heading.tagName).toBe("H2");
      expect(heading.closest("section")?.className).toBe(cardClass);
    }
  });

  it("sizes the sync server input from the container instead of the viewport", () => {
    renderSettings();

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

describe("Settings page — automatic sync", () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({ autoSync: true } as never);
    syncState.authStatus = "logged-in";
    syncState.userEmail = "writer@example.com";
  });

  afterEach(() => {
    syncState.authStatus = "logged-out";
    syncState.userEmail = null;
  });

  it("is on by default and can be switched off from the keyboard", async () => {
    const user = userEvent.setup();
    renderSettings();

    const toggle = screen.getByRole("switch", { name: "sync.autoSync" });
    expect(toggle).toBeChecked();
    expect(screen.getByText("sync.autoSyncDescription")).toBeInTheDocument();

    toggle.focus();
    await user.keyboard(" ");

    expect(useSettingsStore.getState().autoSync).toBe(false);
    expect(screen.getByRole("switch", { name: "sync.autoSync" })).not.toBeChecked();
  });

  it("is hidden while logged out", () => {
    syncState.authStatus = "logged-out";
    renderSettings();

    expect(screen.queryByRole("switch", { name: "sync.autoSync" })).not.toBeInTheDocument();
  });
});

describe("Settings page — sync server URL", () => {
  afterEach(() => {
    syncState.apiUrl = "";
    syncState.setApiUrl.mockClear();
  });

  // Signing in from the Log In dialog sets the server URL while Settings is
  // open. The field used to keep its first, empty value and write it back on
  // blur, pointing every later Sync at the app's own origin (issue #222).
  it("follows a server URL set elsewhere and does not write a stale one back on blur", async () => {
    const user = userEvent.setup();
    const { rerender } = renderSettings();
    const field = screen.getByRole("textbox", { name: "sync.serverUrl" });
    expect(field).toHaveValue("");

    syncState.apiUrl = "http://127.0.0.1:8090";
    rerender(
      <MemoryRouter initialEntries={["/settings"]}>
        <Settings />
      </MemoryRouter>
    );
    expect(field).toHaveValue("http://127.0.0.1:8090");

    field.focus();
    await user.tab();
    expect(syncState.setApiUrl).not.toHaveBeenCalled();
  });

  it("saves an edited server URL, normalized, when the field loses focus", async () => {
    const user = userEvent.setup();
    renderSettings();
    const field = screen.getByRole("textbox", { name: "sync.serverUrl" });

    field.focus();
    await user.keyboard("sync.example.org");
    await user.tab();
    expect(syncState.setApiUrl).toHaveBeenCalledWith("https://sync.example.org");
    expect(field).toHaveValue("https://sync.example.org");
  });
});
