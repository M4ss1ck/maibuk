import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { chapter, editorProps, mockUpdateChapter } = vi.hoisted(() => ({
  chapter: {
    id: "chapter-1",
    bookId: "book-1",
    title: "Chapter 1",
    content: "<p>Local</p>",
    order: 1,
    wordCount: 1,
    chapterType: "chapter",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  },
  editorProps: {
    current: null as null | {
      onUpdate: (content: string) => void;
      onExternalContent?: (content: string, wordCount: number) => void;
    },
  },
  mockUpdateChapter: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("react-router-dom", () => ({
  useParams: () => ({ bookId: "book-1" }),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ state: null, pathname: "/book/book-1" }),
}));

vi.mock("../../../lib/shortcuts", () => ({
  useShortcuts: vi.fn(),
}));

vi.mock("../../../lib/platform", () => ({
  IS_ANDROID: false,
  IS_DESKTOP: true,
  IS_TAURI: true,
  isMac: () => false,
}));

vi.mock("../../../features/books/store", () => ({
  useBookStore: () => ({
    currentBook: {
      id: "book-1",
      title: "Draft",
      authorName: "Author",
      language: "en",
      wordCount: 1,
      status: "draft",
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

vi.mock("../../../features/chapters/store", () => ({
  useChapterStore: () => ({
    chapters: [chapter],
    currentBookId: "book-1",
    currentChapter: chapter,
    isLoading: false,
    loadChapters: vi.fn(),
    createChapter: vi.fn(),
    updateChapter: mockUpdateChapter,
    deleteChapter: vi.fn(),
    reorderChapters: vi.fn(),
    setCurrentChapter: vi.fn(),
  }),
}));

vi.mock("../../../features/settings/store", () => ({
  useSettingsStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      sidebarWidth: 256,
      setSidebarWidth: vi.fn(),
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
  ChapterList: () => null,
  Editor: (props: {
    onUpdate: (content: string) => void;
    onExternalContent?: (content: string, wordCount: number) => void;
  }) => {
    editorProps.current = props;
    return <div data-testid="editor" />;
  },
  SaveStatus: () => null,
}));

vi.mock("../../../components/book/BookSidePanel", () => ({ BookSidePanel: () => null }));
vi.mock("../../../components/ThemeToggle", () => ({ ThemeToggle: () => null }));
vi.mock("../../../components/export", () => ({ ExportDialog: () => null }));
vi.mock("../../../components/book/BookSettingsDialog", () => ({ BookSettingsDialog: () => null }));
vi.mock("../../../components/sync/SyncStatusButton", () => ({ SyncStatusButton: () => null }));
vi.mock("../../../components/versions/VersionPanel", () => ({ VersionPanel: () => null }));
vi.mock("../../../components/versions/HistoryMenuButton", () => ({
  HistoryMenuButton: () => null,
}));

import { BookEditor } from "@/pages/BookEditor";

describe("BookEditor after a sync pull replaces the open chapter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockUpdateChapter.mockReset().mockResolvedValue(undefined);
    editorProps.current = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("autosaves typed content when nothing external happens (harness check)", async () => {
    render(<BookEditor />);

    act(() => {
      editorProps.current?.onUpdate("<p>Typed</p>");
    });
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });

    expect(mockUpdateChapter).toHaveBeenCalledWith("chapter-1", { content: "<p>Typed</p>" });
  });

  it("lets an automatic sync land the pending autosave before it reads the database", async () => {
    const { flushPendingEdits } = await import("@/features/sync/pending-edits");
    render(<BookEditor />);

    act(() => {
      editorProps.current?.onUpdate("<p>Typed just before the sync</p>");
    });
    await act(async () => {
      await flushPendingEdits();
    });

    expect(mockUpdateChapter).toHaveBeenCalledWith("chapter-1", {
      content: "<p>Typed just before the sync</p>",
    });
  });

  it("drops the save queued for the old text and adopts the pulled word count", async () => {
    render(<BookEditor />);

    act(() => {
      editorProps.current?.onUpdate("<p>Typed before the pull</p>");
      editorProps.current?.onExternalContent?.("<p>Remote</p>", 42);
    });
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });

    expect(mockUpdateChapter).not.toHaveBeenCalled();
    expect(screen.getByText(/^42\s+common\.words$/)).toBeInTheDocument();
  });
});
