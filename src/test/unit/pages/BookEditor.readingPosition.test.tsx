import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { editorProps, mockNavigate, mockLocationState } = vi.hoisted(() => ({
  editorProps: [] as Array<Record<string, unknown>>,
  mockNavigate: vi.fn(),
  mockLocationState: { current: null as Record<string, unknown> | null },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("react-router-dom", () => ({
  useParams: () => ({ bookId: "book-1" }),
  useNavigate: () => mockNavigate,
  useLocation: () => ({
    state: mockLocationState.current,
    pathname: "/book/book-1",
  }),
}));

vi.mock("../../../lib/shortcuts", () => ({ useShortcuts: vi.fn() }));
vi.mock("../../../lib/platform", () => ({ IS_TAURI: true, isMac: () => false }));
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
      lastChapterId: "ch1",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    },
    isLoading: false,
    loadBook: vi.fn(),
    updateWordCount: vi.fn(),
    updateBook: vi.fn(),
    deleteBook: vi.fn(),
  }),
}));

vi.mock("../../../features/chapters/store", () => {
  const currentChapter = {
    id: "ch1",
    bookId: "book-1",
    title: "T",
    content: "<p>x</p>",
    order: 0,
    chapterType: "chapter",
    wordCount: 0,
    status: "draft",
    isIncludedInExport: true,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };

  return {
    useChapterStore: () => ({
      chapters: [currentChapter],
      currentBookId: "book-1",
      currentChapter,
      isLoading: false,
      loadChapters: vi.fn(),
      createChapter: vi.fn(),
      updateChapter: vi.fn(),
      deleteChapter: vi.fn(),
      reorderChapters: vi.fn(),
      setCurrentChapter: vi.fn(),
    }),
  };
});

vi.mock("../../../features/notes", () => ({
  useNoteStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      notes: [],
      loadNotes: vi.fn(),
      createNote: vi.fn(),
    }),
}));

vi.mock("../../../features/settings/store", () => ({
  useSettingsStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      sidebarWidth: 256,
      setSidebarWidth: vi.fn(),
      notesSidebarWidth: 320,
      setNotesSidebarWidth: vi.fn(),
      showInlineFootnotes: true,
      showNotesChapter: false,
      setShowNotesChapter: vi.fn(),
      bookSidePanelTab: "footnotes",
      setBookSidePanelTab: vi.fn(),
      hideKeyboardHints: false,
      alwaysOnTop: false,
      setAlwaysOnTop: vi.fn(),
    }),
}));

vi.mock("../../../features/versions/useAutoCheckpoint", () => ({
  useAutoCheckpoint: vi.fn(),
}));

vi.mock("../../../features/versions/store", () => ({
  useVersionStore: { getState: () => ({ createVersion: vi.fn() }) },
}));

vi.mock("../../../components/editor", () => ({
  ChapterList: () => <div data-testid="chapter-list" />,
  Editor: (props: Record<string, unknown>) => {
    editorProps.push(props);
    return <div data-testid="editor" />;
  },
  SaveStatus: () => null,
}));

vi.mock("../../../components/book/BookSidePanel", () => ({
  BookSidePanel: () => <div data-testid="book-side-panel" />,
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

import { BookEditor } from "@/pages/BookEditor";

describe("BookEditor reading-position wiring", () => {
  beforeEach(() => {
    editorProps.length = 0;
    mockNavigate.mockClear();
    mockLocationState.current = null;
  });

  it("passes a chapter-scoped restoreKey to Editor", () => {
    render(<BookEditor />);

    const last = editorProps[editorProps.length - 1];
    expect(last?.restoreKey).toBe("chapter:ch1");
    expect(last?.suppressRestore).toBe(false);
  });

  it("suppresses restore while a heading deep-link is pending", () => {
    mockLocationState.current = {
      openChapterId: "ch1",
      scrollToHeadingId: "heading-1",
    };

    render(<BookEditor />);

    const last = editorProps[editorProps.length - 1];
    expect(last?.restoreKey).toBe("chapter:ch1");
    expect(last?.suppressRestore).toBe(true);
  });
});
