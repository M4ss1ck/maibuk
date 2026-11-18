import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const { mockNavigateFn, mockUpdateChapter, mockLocationState } = vi.hoisted(() => ({
  mockNavigateFn: vi.fn(),
  mockUpdateChapter: vi.fn().mockResolvedValue(undefined),
  mockLocationState: { value: null as unknown },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("react-router-dom", () => ({
  useParams: () => ({ bookId: "book-1" }),
  useNavigate: () => mockNavigateFn,
  useLocation: () => ({ state: mockLocationState.value, pathname: "/book/book-1" }),
}));

vi.mock("../../../lib/shortcuts", () => ({ useShortcuts: vi.fn() }));

vi.mock("../../../lib/platform", () => ({
  IS_ANDROID: false,
  IS_TAURI: false,
  IS_DESKTOP: false,
  isMac: () => false,
}));

vi.mock("../../../hooks/useAutoSave", () => ({
  useDebouncedCallback: (callback: (...args: unknown[]) => void) => callback,
}));

vi.mock("../../../features/books/store", () => ({
  useBookStore: () => ({
    currentBook: {
      id: "book-1",
      title: "Draft",
      authorName: "Author",
      language: "en",
      wordCount: 0,
      status: "draft",
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-01"),
    },
    isLoading: false,
    loadBook: vi.fn(),
    updateWordCount: vi.fn(),
    updateBook: vi.fn(),
    deleteBook: vi.fn(),
  }),
}));

vi.mock("../../../features/chapters/store", () => ({
  useChapterStore: () => ({
    chapters: [],
    currentBookId: "book-1",
    isLoading: false,
    currentChapter: {
      id: "c1",
      title: "Ch1",
      content: "<p>x</p>",
      wordCount: 1,
      order: 0,
      chapterType: "chapter",
    },
    loadChapters: vi.fn(),
    createChapter: vi.fn(),
    updateChapter: mockUpdateChapter,
    deleteChapter: vi.fn(),
    reorderChapters: vi.fn(),
    setCurrentChapter: vi.fn(),
  }),
}));

vi.mock("../../../features/settings/store", async () => {
  const { DEFAULT_SHORTCUT_SETTINGS } =
    await vi.importActual<typeof import("@/lib/shortcut-resolve")>("@/lib/shortcut-resolve");
  const state: Record<string, unknown> = {
    sidebarWidth: 256,
    setSidebarWidth: vi.fn(),
    notesSidebarWidth: 256,
    setNotesSidebarWidth: vi.fn(),
    showInlineFootnotes: true,
    showNotesChapter: false,
    setShowNotesChapter: vi.fn(),
    bookSidePanelTab: "footnotes",
    setBookSidePanelTab: vi.fn(),
    hideKeyboardHints: true,
    setHideKeyboardHints: vi.fn(),
    alwaysOnTop: false,
    setAlwaysOnTop: vi.fn(),
    shortcuts: DEFAULT_SHORTCUT_SETTINGS,
  };
  return {
    useSettingsStore: Object.assign(
      (selector: (s: Record<string, unknown>) => unknown) => selector(state),
      { getState: () => state, setState: vi.fn(), subscribe: () => () => {} }
    ),
  };
});

vi.mock("../../../features/versions/useAutoCheckpoint", () => ({
  useAutoCheckpoint: vi.fn(),
}));

vi.mock("../../../features/versions/store", () => ({
  useVersionStore: { getState: () => ({ createVersion: vi.fn() }) },
}));

vi.mock("../../../features/notes", () => ({
  useNoteStore: Object.assign(
    (selector?: (s: any) => any) => {
      const state = { notes: [], loadNotes: vi.fn(), createNote: vi.fn() };
      return selector ? selector(state) : state;
    },
    { getState: () => ({ currentNote: null }) }
  ),
}));

vi.mock("../../../features/theme", () => ({
  useThemeStore: (selector: (s: { theme: string; setTheme: () => void }) => unknown) =>
    selector({ theme: "light", setTheme: vi.fn() }),
  getCycledTheme: vi.fn(),
}));

vi.mock("../../../features/sync/store", () => ({
  useSyncStore: {
    getState: () => ({
      authStatus: "logged-out",
      syncStatus: "idle",
      syncSingleBook: vi.fn(),
      syncSingleNote: vi.fn(),
      syncAll: vi.fn(),
    }),
  },
}));

vi.mock("../../../features/sync/crypto", () => ({ getPassphrase: () => "passphrase" }));
vi.mock("../../../components/ShortcutsHelpDialog", () => ({ ShortcutsHelpDialog: () => null }));

vi.mock("../../../lib/metrics/MetricsService", () => ({
  metricsService: { endSession: vi.fn(), flushNow: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock("../../../lib/db", () => ({
  getDatabase: vi.fn(),
}));

vi.mock("../../../components/editor", () => ({
  ChapterList: () => <div data-testid="chapter-list" />,
  Editor: () => <div data-testid="editor" />,
  SaveStatus: () => null,
}));
vi.mock("../../../components/book/BookSidePanel", () => ({
  BookSidePanel: () => null,
}));
vi.mock("../../../components/ThemeToggle", () => ({
  ThemeToggle: () => <button type="button">theme</button>,
}));
vi.mock("../../../components/export", () => ({
  ExportDialog: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div role="dialog" aria-label="export dialog" /> : null,
}));
vi.mock("../../../components/book/BookSettingsDialog", () => ({
  BookSettingsDialog: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div role="dialog" aria-label="settings dialog" /> : null,
}));
vi.mock("../../../components/sync/SyncStatusButton", () => ({
  SyncStatusButton: () => <button type="button">sync</button>,
}));
vi.mock("../../../components/versions/VersionPanel", () => ({ VersionPanel: () => null }));
vi.mock("../../../components/versions/HistoryMenuButton", () => ({
  HistoryMenuButton: () => <button type="button">history</button>,
}));

import {
  BookEditor,
  splitTitleBarLabel,
  TITLE_BAR_LABELS_MIN,
  titleBarShowsLabels,
} from "@/pages/BookEditor";

/** Sets the width every element reports, which the title bar reads on mount. */
function renderAtWidth(width: number) {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(width);
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  return render(<BookEditor />);
}

const titleBarButton = (name: string) =>
  screen
    .getByRole("banner", { name: "panes.bookTitleBar" })
    .querySelector<HTMLElement>(`button[aria-label="${name}"]`);

describe("splitTitleBarLabel", () => {
  it("splits two words onto two lines", () => {
    expect(splitTitleBarLabel("Export Book")).toEqual(["Export", "Book"]);
    expect(splitTitleBarLabel("Diseñar Portada")).toEqual(["Diseñar", "Portada"]);
  });

  it("splits at the space that keeps the longer line shortest", () => {
    expect(splitTitleBarLabel("Configuración del Libro")).toEqual(["Configuración", "del Libro"]);
    expect(splitTitleBarLabel("Save a new version now")).toEqual(["Save a new", "version now"]);
  });

  it("keeps a single word on one line and trims stray spaces", () => {
    expect(splitTitleBarLabel("Export")).toEqual(["Export"]);
    expect(splitTitleBarLabel("  Book   Settings ")).toEqual(["Book", "Settings"]);
  });
});

describe("titleBarShowsLabels", () => {
  it("labels the actions from the threshold width up", () => {
    expect(titleBarShowsLabels(TITLE_BAR_LABELS_MIN - 1)).toBe(false);
    expect(titleBarShowsLabels(TITLE_BAR_LABELS_MIN)).toBe(true);
  });
});

describe("BookEditor title bar actions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the labels on a wide bar, skips the tooltip, and Enter opens Book Settings", async () => {
    const user = userEvent.setup();
    renderAtWidth(TITLE_BAR_LABELS_MIN);

    const settings = titleBarButton("bookSettings.title");
    expect(settings).toHaveTextContent("bookSettings.title");
    expect(titleBarButton("nav.exportBook")).toHaveTextContent("nav.exportBook");
    expect(titleBarButton("nav.designCover")).toHaveTextContent("nav.designCover");

    settings?.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("dialog", { name: "settings dialog" })).toBeInTheDocument();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("keeps a narrower bar icon-only, where focus shows the tooltip and Enter exports", async () => {
    const user = userEvent.setup();
    renderAtWidth(TITLE_BAR_LABELS_MIN - 1);

    const exportBook = titleBarButton("nav.exportBook");
    expect(exportBook).toHaveTextContent("");

    // Tab from the previous action, as an author would, so the tooltip opens on focus.
    titleBarButton("bookSettings.title")?.focus();
    await user.tab({ shift: true });
    await user.tab({ shift: true });
    expect(exportBook).toHaveFocus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("nav.exportBook");

    await user.keyboard("{Enter}");
    expect(screen.getByRole("dialog", { name: "export dialog" })).toBeInTheDocument();
  });

  it("Design Cover opens the Cover Designer from the keyboard in both tiers", async () => {
    const user = userEvent.setup();
    for (const width of [TITLE_BAR_LABELS_MIN, TITLE_BAR_LABELS_MIN - 1]) {
      mockNavigateFn.mockClear();
      const { unmount } = renderAtWidth(width);
      titleBarButton("nav.designCover")?.focus();
      await user.keyboard(" ");
      await waitFor(() => expect(mockNavigateFn).toHaveBeenCalledWith("/book/book-1/cover"));
      unmount();
      vi.restoreAllMocks();
    }
  });

  it("opens Book Settings from the More menu by keyboard", async () => {
    const user = userEvent.setup();
    renderAtWidth(500);

    screen.getByRole("button", { name: "common.more" }).focus();
    await user.keyboard("{Enter}");
    // jsdom applies no CSS, so the hidden desktop action shares the name; the
    // menu row is the one without an aria-label.
    const settingsRow = screen
      .getAllByRole("button", { name: "bookSettings.title" })
      .find((button) => !button.hasAttribute("aria-label"));
    while (document.activeElement !== settingsRow) await user.tab();
    await user.keyboard("{Enter}");

    expect(screen.getByRole("dialog", { name: "settings dialog" })).toBeInTheDocument();
    expect(settingsRow).not.toBeInTheDocument();
  });
});

describe("BookEditor return target", () => {
  afterEach(() => {
    mockLocationState.value = null;
    mockNavigateFn.mockClear();
    vi.restoreAllMocks();
  });

  /** Tabs from the start of the document until the title-bar button has focus. */
  async function tabToBackButton(name: string) {
    const user = userEvent.setup();
    const button = await waitFor(() => {
      const found = titleBarButton(name);
      if (!found) throw new Error(`no title-bar button named ${name}`);
      return found;
    });
    for (let press = 0; press < 60 && document.activeElement !== button; press++) {
      await user.tab();
    }
    expect(button).toHaveFocus();
    return { user, button };
  }

  it("returns to the Canvas that opened the Book", async () => {
    mockLocationState.value = { returnTo: "/canvas/c1", returnLabel: "Plot" };
    renderAtWidth(TITLE_BAR_LABELS_MIN);

    const { user, button } = await tabToBackButton("nav.backTo");
    // i18n is mocked to return keys, so the label is the key, not "Back to Plot".
    expect(button).toHaveAccessibleName("nav.backTo");

    await user.keyboard("{Enter}");
    expect(mockNavigateFn).toHaveBeenCalledWith("/canvas/c1");
  });

  it("goes home when nothing opened the Book", async () => {
    renderAtWidth(TITLE_BAR_LABELS_MIN);

    const { user, button } = await tabToBackButton("nav.backToHome");
    expect(button).toHaveAccessibleName("nav.backToHome");

    await user.keyboard("{Enter}");
    expect(mockNavigateFn).toHaveBeenCalledWith("/");
  });
});
