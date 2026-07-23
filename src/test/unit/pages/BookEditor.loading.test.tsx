import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockBookState, mockChapterState, mockLoadBook, mockLoadChapters, mockSetCurrentChapter, platformState } =
  vi.hoisted(() => ({
    platformState: { isDesktop: true },
    mockBookState: {
      currentBook: {
        id: "book-1",
        title: "Draft",
        authorName: "Author",
        language: "en",
        wordCount: 0,
        status: "draft",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      } as null | {
        id: string;
        title: string;
        authorName: string;
        language: string;
        wordCount: number;
        status: string;
        createdAt: Date;
        updatedAt: Date;
      },
      isLoading: false,
    },
    mockChapterState: {
      chapters: [] as Array<{
        id: string;
        bookId: string;
        title: string;
        content: string;
        order: number;
        wordCount: number;
        chapterType: string;
        createdAt: Date;
        updatedAt: Date;
      }>,
      currentBookId: "book-1" as string | null,
      currentChapter: null as null | {
        id: string;
        bookId: string;
        title: string;
        content: string;
        order: number;
        wordCount: number;
        chapterType: string;
        createdAt: Date;
        updatedAt: Date;
      },
      isLoading: false,
    },
    mockLoadBook: vi.fn(),
    mockLoadChapters: vi.fn(),
    mockSetCurrentChapter: vi.fn(),
  }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
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
  get IS_ANDROID() {
    return !platformState.isDesktop;
  },
  get IS_DESKTOP() {
    return platformState.isDesktop;
  },
  IS_TAURI: true,
  isMac: () => false,
}));

vi.mock("../../../hooks/useAutoSave", () => ({
  useDebouncedCallback: (callback: (...args: unknown[]) => void) => callback,
}));

vi.mock("../../../features/books/store", () => ({
  useBookStore: () => ({
    currentBook: mockBookState.currentBook,
    isLoading: mockBookState.isLoading,
    loadBook: mockLoadBook,
    updateWordCount: vi.fn(),
    updateBook: vi.fn(),
    deleteBook: vi.fn(),
  }),
}));

vi.mock("../../../features/chapters/store", () => ({
  useChapterStore: () => ({
    chapters: mockChapterState.chapters,
    currentBookId: mockChapterState.currentBookId,
    currentChapter: mockChapterState.currentChapter,
    isLoading: mockChapterState.isLoading,
    loadChapters: mockLoadChapters,
    createChapter: vi.fn(),
    updateChapter: vi.fn(),
    deleteChapter: vi.fn(),
    reorderChapters: vi.fn(),
    setCurrentChapter: mockSetCurrentChapter,
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
  useVersionStore: {
    getState: () => ({
      createVersion: vi.fn(),
    }),
  },
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
  ThemeToggle: () => null,
}));

vi.mock("../../../components/export", () => ({
  ExportDialog: () => null,
}));

vi.mock("../../../components/book/BookSettingsDialog", () => ({
  BookSettingsDialog: () => null,
}));

vi.mock("../../../components/sync/SyncStatusButton", () => ({
  SyncStatusButton: () => null,
}));

vi.mock("../../../components/versions/VersionPanel", () => ({
  VersionPanel: () => null,
}));

vi.mock("../../../components/versions/HistoryMenuButton", () => ({
  HistoryMenuButton: () => null,
}));

import { BookEditor } from "@/pages/BookEditor";

describe("BookEditor loading state", () => {
  beforeEach(() => {
    mockBookState.currentBook = {
      id: "book-1",
      title: "Draft",
      authorName: "Author",
      language: "en",
      wordCount: 0,
      status: "draft",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    };
    mockBookState.isLoading = false;
    mockChapterState.chapters = [];
    mockChapterState.currentBookId = "book-1";
    mockChapterState.currentChapter = null;
    mockChapterState.isLoading = false;
    mockLoadBook.mockClear();
    mockLoadChapters.mockClear();
    mockSetCurrentChapter.mockClear();
  });

  it("uses the Maibuk logo while the book is loading", () => {
    mockBookState.currentBook = null;
    mockBookState.isLoading = true;

    const { container } = render(<BookEditor />);

    const logo = container.querySelector("svg.loading-entrance");
    const loadingSurface = logo?.parentElement?.parentElement;
    expect(logo).toBeInTheDocument();
    expect(logo?.classList.contains("loading-entrance")).toBe(true);
    expect(loadingSurface).toHaveClass("h-dvh");
    expect(screen.getByText("editor.loading")).toBeInTheDocument();
  });

  it("shows an editor loading state while chapters are loading", () => {
    mockChapterState.isLoading = true;

    const { container } = render(<BookEditor />);

    const logo = container.querySelector("svg.loading-entrance");
    expect(logo).toBeInTheDocument();
    expect(logo?.classList.contains("loading-entrance")).toBe(true);
    expect(screen.getByText("editor.loadingEditor")).toBeInTheDocument();
    expect(screen.queryByText("editor.noChapter")).not.toBeInTheDocument();
  });

  it("keeps the editor loading state while an existing chapter is being selected", () => {
    mockChapterState.chapters = [
      {
        id: "chapter-1",
        bookId: "book-1",
        title: "Chapter 1",
        content: "<p>Loaded chapter</p>",
        order: 1,
        wordCount: 2,
        chapterType: "chapter",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      },
    ];

    const { container } = render(<BookEditor />);

    const logo = container.querySelector("svg.loading-entrance");
    expect(logo).toBeInTheDocument();
    expect(logo?.classList.contains("loading-entrance")).toBe(true);
    expect(screen.getByText("editor.loadingEditor")).toBeInTheDocument();
    expect(screen.queryByText("editor.noChapter")).not.toBeInTheDocument();
    expect(mockSetCurrentChapter).toHaveBeenCalledWith(mockChapterState.chapters[0]);
  });

  it("shows the empty chapter prompt after a loaded book has no chapters", () => {
    render(<BookEditor />);

    expect(screen.getByText("editor.noChapter")).toBeInTheDocument();
    expect(screen.queryByText("editor.loadingEditor")).not.toBeInTheDocument();
  });

  it("omits the always-on-top button from the desktop toolbar on Android", () => {
    platformState.isDesktop = false;
    render(<BookEditor />);

    expect(
      screen.queryByRole("button", { name: "settings.alwaysOnTop" })
    ).not.toBeInTheDocument();
  });

  it("omits the always-on-top button from the mobile more menu on Android", async () => {
    platformState.isDesktop = false;
    const user = userEvent.setup();
    render(<BookEditor />);

    const moreButton = screen.getByRole("button", { name: "common.more" });
    moreButton.focus();
    await user.keyboard("{Enter}");

    expect(
      screen.queryByRole("button", { name: "settings.alwaysOnTop" })
    ).not.toBeInTheDocument();
  });
});
