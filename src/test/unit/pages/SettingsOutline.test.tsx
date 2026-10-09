import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

// Settings reads the route hash (to scroll to a linked section), so it needs a Router.
function renderSettings(initialEntries: string[] = ["/settings"]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Settings />
    </MemoryRouter>
  );
}

const { useSettingsRevealStore } = await import("@/features/settings/settings-reveal-store");

function outlineTree() {
  return within(screen.getByRole("navigation", { name: "settings.outline.label" })).getByRole(
    "treegrid"
  );
}

function rowNames() {
  return within(outlineTree())
    .getAllByRole("row")
    .map((row) => row.getAttribute("aria-label") ?? row.textContent);
}

// jsdom has no layout: every element sits at 0,0 with no size. These give the
// section cards tops so the scroll spy has something to measure.
function layOutSections(tops: Record<string, number>) {
  const scroller = document.querySelector<HTMLElement>(".overflow-auto")!;
  scroller.getBoundingClientRect = () =>
    ({ top: 0, bottom: 800, left: 0, right: 1200, width: 1200, height: 800 }) as DOMRect;
  for (const [id, top] of Object.entries(tops)) {
    const card = document.querySelector(`[data-settings-section="${id}"]`)!.closest("section")!;
    card.getBoundingClientRect = () => ({ top, bottom: top + 300 }) as DOMRect;
  }
  return scroller;
}

describe("Settings outline", () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsRevealStore.setState({ pendingRowId: null } as never);
  });

  it("lists every section the screen renders, by name", () => {
    renderSettings();
    expect(outlineTree()).toHaveAttribute("data-focus-pane-entry");
    expect(rowNames()).toEqual([
      "settings.appearance",
      "settings.general",
      "shortcuts.title",
      "sync.title",
      "backup.title",
      "settings.metrics.title",
      "settings.editor",
      "dictation.section.title",
      "settings.export",
      "tutorial.settings.title",
      "settings.plugins",
      "settings.advanced",
      "settings.about",
    ]);
  });

  it("moves between sections with the arrow keys and jumps to one with Enter", async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByRole("searchbox", { name: "settings.outline.searchLabel" }));
    await user.tab();
    expect(document.activeElement).toHaveAttribute("aria-label", "settings.appearance");
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(document.activeElement).toHaveAttribute("aria-label", "shortcuts.title");

    await user.keyboard("{Enter}");
    expect(document.activeElement).toHaveAttribute("data-settings-section", "shortcuts");
    // The jumped-to section is current and lists its rows.
    expect(
      within(outlineTree()).getByRole("row", { name: "shortcuts.title, settings.outline.current" })
    ).toBeInTheDocument();
    expect(rowNames()).toContain("shortcutEditor.open");
  });

  it("opens a row's control through the same path as the Command Palette", async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(within(outlineTree()).getByRole("row", { name: "settings.general" }));
    expect(rowNames()).toContain("settings.language");
    await user.click(within(outlineTree()).getByRole("row", { name: "settings.language" }));
    // Clicked from the outline, not picked by scrolling.

    await waitFor(() =>
      expect(document.activeElement?.closest("[data-settings-row]")).toHaveAttribute(
        "data-settings-row",
        "language"
      )
    );
    expect(
      within(outlineTree()).getByRole("row", {
        name: "settings.language, settings.outline.current",
      })
    ).toBeInTheDocument();
  });

  it("opens another section's rows with ArrowRight without leaving the outline", async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByRole("searchbox", { name: "settings.outline.searchLabel" }));
    await user.tab();
    await user.keyboard("{ArrowDown}");
    expect(rowNames()).not.toContain("settings.autoSave");
    await user.keyboard("{ArrowRight}");
    expect(rowNames()).toContain("settings.autoSave");
    expect(document.activeElement).toHaveAttribute("aria-label", "settings.general");
  });

  it("filters sections and rows as the author types, and Escape clears it", async () => {
    const user = userEvent.setup();
    renderSettings();
    const search = screen.getByRole("searchbox", { name: "settings.outline.searchLabel" });
    expect(search).toHaveAttribute("placeholder", "settings.outline.searchPlaceholder");

    await user.click(search);
    await user.keyboard("language");
    expect(rowNames()).toEqual(["settings.general", "settings.language"]);

    await user.keyboard("zzz");
    expect(screen.queryByRole("treegrid")).toBeNull();
    expect(screen.getByText("settings.outline.noMatches")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(search).toHaveValue("");
    expect(rowNames()).toHaveLength(13);
  });

  it("follows the first section that starts in view as the page scrolls", async () => {
    renderSettings();
    const scroller = layOutSections({ appearance: -900, general: -400, shortcuts: 200, sync: 600 });

    act(() => {
      scroller.dispatchEvent(new Event("scroll"));
    });
    await waitFor(() =>
      expect(
        within(outlineTree()).getByRole("row", {
          name: "shortcuts.title, settings.outline.current",
        })
      ).toBeInTheDocument()
    );
    // No row is picked by scrolling.
    expect(document.querySelector('[role="row"][aria-level="2"].text-primary')).toBeNull();
  });

  it("keeps a clicked section current through its jump, until the author scrolls", async () => {
    const user = userEvent.setup();
    renderSettings();
    const scroller = layOutSections({ appearance: -900, general: -400, shortcuts: 200, sync: 600 });

    await user.click(within(outlineTree()).getByRole("row", { name: "sync.title" }));
    // The jump's own scroll does not move the selection to Shortcuts.
    act(() => {
      scroller.dispatchEvent(new Event("scroll"));
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(
      within(outlineTree()).getByRole("row", { name: "sync.title, settings.outline.current" })
    ).toBeInTheDocument();

    // Once the jump settles, the author's scroll hands back to the spy.
    await new Promise((resolve) => setTimeout(resolve, 450));
    act(() => {
      scroller.dispatchEvent(new Event("scroll"));
    });
    await waitFor(() =>
      expect(
        within(outlineTree()).getByRole("row", {
          name: "shortcuts.title, settings.outline.current",
        })
      ).toBeInTheDocument()
    );
  });
});

describe("Settings section menu (narrow screens)", () => {
  it("jumps to a section from the keyboard and names the current one", async () => {
    const user = userEvent.setup();
    renderSettings();

    const trigger = screen.getByRole("button", { name: /^settings\.outline\.jumpTo/ });
    trigger.focus();
    await user.keyboard("{Enter}");
    const menu = await screen.findByRole("menu");
    await waitFor(() => expect(document.activeElement).toHaveTextContent("settings.appearance"));
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toHaveTextContent("settings.general");
    await user.keyboard("{Enter}");

    expect(menu).not.toBeInTheDocument();
    await waitFor(() =>
      expect(document.activeElement).toHaveAttribute("data-settings-section", "general")
    );
  });

  it("closes on Escape and returns focus to its button", async () => {
    const user = userEvent.setup();
    renderSettings();
    const trigger = screen.getByRole("button", { name: /^settings\.outline\.jumpTo/ });
    trigger.focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("menu");
    await waitFor(() => expect(screen.getAllByRole("menuitem")[0]).toHaveFocus());
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
