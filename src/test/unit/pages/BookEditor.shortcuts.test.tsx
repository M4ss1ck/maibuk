import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockUseShortcuts } = vi.hoisted(() => ({
  mockUseShortcuts: vi.fn(),
}));
const { mockVersionPanel } = vi.hoisted(() => ({
  mockVersionPanel: vi.fn(() => null),
}));
const { mockHistoryMenuButton } = vi.hoisted(() => ({
  mockHistoryMenuButton: vi.fn(() => <button type="button">history menu</button>),
}));
const { mockIsMac } = vi.hoisted(() => ({
  mockIsMac: vi.fn(() => false),
}));
const { mockNavigateFn } = vi.hoisted(() => ({
  mockNavigateFn: vi.fn(),
}));
const { mockUpdateChapter, mockCreateVersion, mockSyncSingleBook } = vi.hoisted(() => ({
  mockUpdateChapter: vi.fn().mockResolvedValue(undefined),
  mockCreateVersion: vi.fn().mockResolvedValue(null),
  mockSyncSingleBook: vi.fn().mockResolvedValue(undefined),
}));
const { i18nState } = vi.hoisted(() => ({
  i18nState: { language: "en" as "en" | "es" },
}));

const bookEditorTranslations = {
  en: { "common.closeChapters": "Close chapters", "chapters.title": "Chapters" },
  es: { "common.closeChapters": "Cerrar capítulos", "chapters.title": "Capítulos" },
} as const;

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const lang = i18nState.language;
      return (bookEditorTranslations as Record<string, Record<string, string>>)[lang]?.[key] ?? key;
    },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("react-router-dom", () => ({
  useParams: () => ({ bookId: "book-1" }),
  useNavigate: () => mockNavigateFn,
  useLocation: () => ({ state: null, pathname: "/book/book-1" }),
}));

vi.mock("../../../lib/shortcuts", () => ({
  useShortcuts: mockUseShortcuts,
}));

vi.mock("../../../lib/platform", () => ({
  IS_TAURI: false,
  isMac: mockIsMac,
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

vi.mock("../../../features/settings/store", () => ({
  useSettingsStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
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
    }),
}));

vi.mock("../../../features/versions/useAutoCheckpoint", () => ({
  useAutoCheckpoint: vi.fn(),
}));

vi.mock("../../../features/versions/store", () => ({
  useVersionStore: { getState: () => ({ createVersion: mockCreateVersion }) },
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
      authStatus: "logged-in",
      syncStatus: "idle",
      syncSingleBook: mockSyncSingleBook,
      syncSingleNote: vi.fn(),
      syncAll: vi.fn(),
    }),
  },
}));

vi.mock("../../../features/sync/crypto", () => ({ getPassphrase: () => "passphrase" }));
vi.mock("../../../hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../hooks")>();
  return { ...actual, useActiveShortcuts: () => [] };
});
vi.mock("../../../components/ShortcutsHelpDialog", () => ({ ShortcutsHelpDialog: () => null }));

vi.mock("../../../lib/metrics/MetricsService", () => ({
  metricsService: { endSession: vi.fn(), flushNow: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock("../../../lib/db", () => ({
  getDatabase: vi.fn(),
}));

// ── Component mocks ──
vi.mock("../../../components/editor", () => ({
  ChapterList: () => <div data-testid="chapter-list" />,
  Editor: ({ onEscape }: { onEscape?: () => void }) => (
    // biome-ignore lint/a11y/useSemanticElements: A contenteditable rich-text editor is correctly exposed as a textbox.
    <div
      aria-label="Editor content"
      data-testid="editor"
      contentEditable
      suppressContentEditableWarning
      tabIndex={0}
      role="textbox"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onEscape?.();
        }
      }}
    />
  ),
  SaveStatus: () => null,
}));
vi.mock("../../../components/book/BookSidePanel", () => ({
  BookSidePanel: () => <div data-testid="book-side-panel" />,
}));
vi.mock("../../../components/ThemeToggle", () => ({
  ThemeToggle: () => <button type="button">theme</button>,
}));
vi.mock("../../../components/export", () => ({
  ExportDialog: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="export-dialog" role="dialog" /> : null,
}));
vi.mock("../../../components/book/BookSettingsDialog", () => ({
  BookSettingsDialog: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="book-settings-dialog" role="dialog" /> : null,
}));
vi.mock("../../../components/sync/SyncStatusButton", () => ({
  SyncStatusButton: () => <button type="button">sync</button>,
}));
vi.mock("../../../components/versions/VersionPanel", () => ({
  VersionPanel: mockVersionPanel,
}));
vi.mock("../../../components/versions/HistoryMenuButton", () => ({
  HistoryMenuButton: mockHistoryMenuButton,
}));

import { BookEditor } from "@/pages/BookEditor";
import { GlobalShortcuts } from "@/components/GlobalShortcuts";
import { SHORTCUTS } from "@/lib/shortcut-registry";

const { useShortcuts: useRealShortcuts } =
  await vi.importActual<typeof import("@/lib/shortcuts")>("@/lib/shortcuts");

type ShortcutConfig = Parameters<typeof useRealShortcuts>[0][number];
type SequenceDefinition = Extract<
  (typeof SHORTCUTS)[keyof typeof SHORTCUTS],
  { readonly sequence: readonly string[] }
>;

function BareSequenceHarness({ onTrigger }: { onTrigger: () => void }) {
  const sequences = Object.values(SHORTCUTS)
    .filter(
      (definition): definition is SequenceDefinition =>
        "sequence" in definition && definition.sequence[0] === "g"
    )
    .map<ShortcutConfig>((definition) => ({ sequence: definition.sequence, onTrigger }));
  useRealShortcuts(sequences);
  return (
    // biome-ignore lint/a11y/useSemanticElements: A contenteditable rich-text editor is correctly exposed as a textbox.
    <div
      aria-label="Sequence editor"
      contentEditable
      suppressContentEditableWarning
      tabIndex={0}
      role="textbox"
    />
  );
}

describe("BookEditor shortcuts", () => {
  beforeEach(() => {
    i18nState.language = "en";
    mockUseShortcuts.mockClear();
    mockVersionPanel.mockClear();
    mockHistoryMenuButton.mockClear();
    mockIsMac.mockReturnValue(false);
    mockNavigateFn.mockClear();
    mockUpdateChapter.mockClear();
    mockCreateVersion.mockClear();
    mockSyncSingleBook.mockClear();
    mockUseShortcuts.mockImplementation(() => undefined);
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
  });

  function enableRealShortcuts(): void {
    mockUseShortcuts.mockImplementation(
      (configs: ShortcutConfig[], options?: Parameters<typeof useRealShortcuts>[1]) =>
        useRealShortcuts(configs, options)
    );
  }

  it("keeps Backspace in contenteditable and navigates only from outside", async () => {
    const user = userEvent.setup();
    enableRealShortcuts();
    render(<BookEditor />);

    const editor = screen.getByRole("textbox", { name: "Editor content" });
    editor.focus();
    await user.keyboard("{Backspace}");
    expect(mockNavigateFn).not.toHaveBeenCalled();
    expect(editor).toHaveFocus();

    screen.getByRole("button", { name: "theme" }).focus();
    await user.keyboard("{Backspace}");
    expect(mockNavigateFn).toHaveBeenCalledWith("/");
  });

  it("fires save and save-version shortcuts while editor content is focused", async () => {
    const user = userEvent.setup();
    enableRealShortcuts();
    render(<BookEditor />);

    const editor = screen.getByRole("textbox", { name: "Editor content" });
    editor.focus();
    await user.keyboard("{Control>}s{/Control}");
    await waitFor(() => {
      expect(mockUpdateChapter).toHaveBeenCalledWith("c1", { content: "<p>x</p>" });
    });

    mockUpdateChapter.mockClear();
    editor.focus();
    await user.keyboard("{Control>}{Alt>}s{/Alt}{/Control}");
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    expect(mockUpdateChapter).toHaveBeenCalledWith("c1", { content: "<p>x</p>" });
  });

  it("enters and exits focus mode from editor content without moving to chapters", async () => {
    const user = userEvent.setup();
    enableRealShortcuts();
    const { container } = render(<BookEditor />);

    const editor = screen.getByRole("textbox", { name: "Editor content" });
    editor.focus();
    await user.keyboard("{F11}");
    await waitFor(() => expect(container.querySelector(".focus-mode")).not.toBeNull());
    expect(editor).toHaveFocus();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(container.querySelector(".focus-mode")).toBeNull());
    expect(editor).toHaveFocus();
    expect(container.querySelector('[data-focus-pane="chapters"]')).not.toHaveFocus();
  });

  it("reveals and focuses the desktop chapter pane from editor Escape", async () => {
    const user = userEvent.setup();
    enableRealShortcuts();
    const { container } = render(<BookEditor />);
    const editor = screen.getByRole("textbox", { name: "Editor content" });
    const panes = container.querySelectorAll<HTMLElement>('[data-focus-pane="chapters"]');

    editor.focus();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(panes[1]).toHaveFocus());
    expect(mockNavigateFn).not.toHaveBeenCalled();
  });

  it("opens and focuses the mobile chapter pane from editor Escape", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 500 });
    const user = userEvent.setup();
    enableRealShortcuts();
    const { container } = render(<BookEditor />);
    const editor = screen.getByRole("textbox", { name: "Editor content" });
    const panes = container.querySelectorAll<HTMLElement>('[data-focus-pane="chapters"]');

    editor.focus();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(panes[0]).toHaveFocus());
    expect(panes[0]).toHaveClass("translate-x-0");
  });

  it("suppresses every registered bare g sequence while typing", async () => {
    const user = userEvent.setup();
    const onTrigger = vi.fn();
    render(<BareSequenceHarness onTrigger={onTrigger} />);
    const editor = screen.getByRole("textbox", { name: "Sequence editor" });
    editor.focus();

    for (const secondKey of ["p", "n", "c", "m", "s", "t", "h", "v"]) {
      await user.keyboard(`g${secondKey}`);
    }

    expect(onTrigger).not.toHaveBeenCalled();
    expect(editor).toHaveFocus();
  });

  it("fires sync and F6 pane cycling while editor content is focused", async () => {
    const user = userEvent.setup();
    enableRealShortcuts();
    render(
      <>
        <GlobalShortcuts />
        {/* biome-ignore lint/a11y/useSemanticElements: A contenteditable rich-text editor is correctly exposed as a textbox. */}
        <div
          aria-label="Global editor"
          contentEditable
          suppressContentEditableWarning
          tabIndex={0}
          role="textbox"
        />
        <section data-focus-pane="target" tabIndex={-1} aria-label="Target pane" />
      </>
    );
    const editor = screen.getByRole("textbox", { name: "Global editor" });
    editor.focus();

    await user.keyboard("{Control>}{Shift>}y{/Shift}{/Control}");
    expect(mockSyncSingleBook).toHaveBeenCalledWith("book-1", "passphrase", expect.any(Function));

    editor.focus();
    await user.keyboard("{F6}");
    expect(screen.getByRole("region", { name: "Target pane" })).toHaveFocus();
  });

  // ── Existing coverage ──
  it("renders an h1 with data-route-heading and a main landmark", () => {
    const { container } = render(<BookEditor />);
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveAttribute("data-route-heading");
    expect(container.querySelectorAll("main")).toHaveLength(1);
  });

  it("close-chapters button has English accessible name", () => {
    render(<BookEditor />);
    expect(screen.getByRole("button", { name: "Close chapters" })).toBeInTheDocument();
  });

  it("close-chapters button has Spanish accessible name", () => {
    i18nState.language = "es";
    render(<BookEditor />);
    expect(screen.getByRole("button", { name: "Cerrar capítulos" })).toBeInTheDocument();
  });

  it("editor-main pane has correct accessible name", () => {
    const { container } = render(<BookEditor />);
    expect(container.querySelector('[data-focus-pane="editor-main"]')).toHaveAccessibleName(
      "panes.editorMain"
    );
  });

  it("HistoryMenuButton receives version shortcuts", () => {
    render(<BookEditor />);
    expect(mockHistoryMenuButton).toHaveBeenCalledWith(
      expect.objectContaining({
        saveVersionShortcut: "Ctrl+Alt+S",
        panelShortcut: "g v",
      }),
      undefined
    );
  });
});
