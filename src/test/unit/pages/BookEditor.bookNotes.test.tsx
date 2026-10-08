import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

const {
  mockNavigate,
  mockNoteState,
  mockBookSidePanel,
  mockSetShowNotesChapter,
  mockSetBookSidePanelTab,
  mockSetSidebarWidth,
  mockSettings,
} = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockNoteState: {
    notes: [
      { id: "n1", title: "Filed A", bookId: "book-1" },
      { id: "n2", title: "Other book", bookId: "book-2" },
      { id: "n3", title: "Loose", bookId: null },
    ],
    loadNotes: vi.fn(() => Promise.resolve()),
    createNote: vi.fn(() => Promise.resolve({ id: "new" })),
  },
  mockBookSidePanel: vi.fn((_props: Record<string, unknown>) => null),
  mockSetShowNotesChapter: vi.fn(),
  mockSetBookSidePanelTab: vi.fn(),
  mockSetSidebarWidth: vi.fn(),
  mockSettings: { showNotesChapter: true },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("react-router-dom", () => ({
  useParams: () => ({ bookId: "book-1" }),
  useNavigate: () => mockNavigate,
  useLocation: () => ({ state: null, pathname: "/book/book-1" }),
}));

vi.mock("../../../lib/shortcuts", () => ({ useShortcuts: vi.fn() }));
vi.mock("../../../lib/platform", () => ({
  IS_ANDROID: false,
  IS_TAURI: true,
  IS_DESKTOP: true,
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
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    },
    loadBook: vi.fn(),
    updateWordCount: vi.fn(),
    updateBook: vi.fn(),
    deleteBook: vi.fn(),
  }),
}));

vi.mock("../../../features/chapters/store", () => ({
  useChapterStore: () => ({
    chapters: [],
    currentChapter: null,
    loadChapters: vi.fn(),
    createChapter: vi.fn(),
    updateChapter: vi.fn(),
    deleteChapter: vi.fn(),
    reorderChapters: vi.fn(),
    setCurrentChapter: vi.fn(),
  }),
}));

vi.mock("../../../features/notes", () => {
  const useNoteStore = (selector: (s: typeof mockNoteState) => unknown) => selector(mockNoteState);
  return { useNoteStore };
});

vi.mock("../../../features/settings/store", async () => {
  const { DEFAULT_SHORTCUT_SETTINGS } =
    await vi.importActual<typeof import("@/lib/shortcut-resolve")>("@/lib/shortcut-resolve");
  const state: Record<string, unknown> = {
    sidebarWidth: 256,
    setSidebarWidth: mockSetSidebarWidth,
    notesSidebarWidth: 280,
    setNotesSidebarWidth: vi.fn(),
    showInlineFootnotes: true,
    get showNotesChapter() {
      return mockSettings.showNotesChapter;
    },
    setShowNotesChapter: mockSetShowNotesChapter,
    bookSidePanelTab: "notes",
    setBookSidePanelTab: mockSetBookSidePanelTab,
    hideKeyboardHints: false,
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

vi.mock("../../../components/editor", () => ({
  ChapterList: () => <div data-testid="chapter-list" />,
  Editor: () => <div data-testid="editor" />,
  SaveStatus: () => null,
}));
vi.mock("../../../components/ThemeToggle", () => ({
  ThemeToggle: () => <button type="button">theme</button>,
}));
vi.mock("../../../components/export", () => ({ ExportDialog: () => null }));
vi.mock("../../../components/book/BookSettingsDialog", () => ({
  BookSettingsDialog: () => null,
}));
vi.mock("../../../components/sync/SyncStatusButton", () => ({
  SyncStatusButton: () => <button type="button">sync</button>,
}));
vi.mock("../../../components/versions/VersionPanel", () => ({
  VersionPanel: () => null,
}));
vi.mock("../../../components/versions/HistoryMenuButton", () => ({
  HistoryMenuButton: () => <button type="button">history</button>,
}));
vi.mock("../../../components/book/BookSidePanel", () => ({
  BookSidePanel: (props: Record<string, unknown>) => {
    mockBookSidePanel(props);
    return null;
  },
}));

import { BookEditor } from "@/pages/BookEditor";

describe("BookEditor book notes panel", () => {
  beforeEach(() => {
    mockBookSidePanel.mockClear();
    mockNavigate.mockClear();
    mockSetShowNotesChapter.mockClear();
    mockSetBookSidePanelTab.mockClear();
    mockSetSidebarWidth.mockClear();
    mockSettings.showNotesChapter = true;
  });

  it("passes only this book's notes to the side panel on the notes tab", () => {
    render(<BookEditor />);

    expect(mockBookSidePanel).toHaveBeenLastCalledWith(
      expect.objectContaining({
        isOpen: true,
        activeTab: "notes",
        notes: [{ id: "n1", title: "Filed A", bookId: "book-1" }],
      })
    );
  });

  it("opens the notes tab when the book notes button is clicked", async () => {
    mockSettings.showNotesChapter = false;
    const user = userEvent.setup();
    render(<BookEditor />);

    await user.click(screen.getByRole("button", { name: "nav.bookNotes" }));

    expect(mockSetBookSidePanelTab).toHaveBeenCalledWith("notes");
    expect(mockSetShowNotesChapter).toHaveBeenCalledWith(true);
  });

  it("disables the book notes button while the side panel is open", () => {
    mockSettings.showNotesChapter = true;
    render(<BookEditor />);

    expect(screen.getByRole("button", { name: "nav.bookNotes" })).toBeDisabled();
  });

  it("navigates to the note in the notes view with a return target", () => {
    render(<BookEditor />);

    const calls = mockBookSidePanel.mock.calls;
    const props = calls[calls.length - 1][0] as unknown as {
      onOpenNote: (id: string) => void;
    };
    props.onOpenNote("n1");

    expect(mockNavigate).toHaveBeenCalledWith("/notes/n1", {
      state: { returnTo: "/book/book-1", returnLabel: "Draft" },
    });
  });

  it("widens the chapter sidebar with ArrowRight on the resize handle", async () => {
    const user = userEvent.setup();
    render(<BookEditor />);

    const handle = screen.getByRole("separator", { name: "nav.resizeChaptersSidebar" });
    handle.focus();
    await user.keyboard("{ArrowRight}");

    expect(mockSetSidebarWidth).toHaveBeenCalledWith(272);
  });
});
