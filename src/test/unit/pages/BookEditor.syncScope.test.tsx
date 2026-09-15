import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { chapter, chapterState, editorProps, syncButtonProps } = vi.hoisted(() => {
  const chapter = {
    id: "chapter-1",
    bookId: "book-1",
    title: "Chapter 1",
    content: "<p>Local</p>",
    order: 1,
    wordCount: 1,
    chapterType: "chapter",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
  return {
    chapter,
    chapterState: { current: chapter },
    editorProps: { current: null as null | { content?: string | null } },
    syncButtonProps: { current: null as null | { defaultScope?: string } },
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("react-router-dom", () => ({
  useParams: () => ({ bookId: "book-1" }),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ state: null, pathname: "/book/book-1" }),
}));

vi.mock("@/lib/shortcuts", () => ({
  useShortcuts: vi.fn(),
}));

vi.mock("@/lib/platform", () => ({
  IS_ANDROID: false,
  IS_DESKTOP: true,
  IS_TAURI: true,
  isMac: () => false,
}));

vi.mock("@/features/books/store", () => ({
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

vi.mock("@/features/chapters/store", () => ({
  useChapterStore: () => ({
    chapters: [chapterState.current],
    currentBookId: "book-1",
    currentChapter: chapterState.current,
    isLoading: false,
    loadChapters: vi.fn(),
    createChapter: vi.fn(),
    updateChapter: vi.fn(),
    deleteChapter: vi.fn(),
    reorderChapters: vi.fn(),
    setCurrentChapter: vi.fn(),
  }),
}));

vi.mock("@/features/settings/store", () => ({
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

vi.mock("@/features/versions/useAutoCheckpoint", () => ({
  useAutoCheckpoint: vi.fn(),
}));

vi.mock("@/features/versions/store", () => ({
  useVersionStore: { getState: () => ({ createVersion: vi.fn() }) },
}));

vi.mock("@/components/editor", () => ({
  ChapterList: () => null,
  Editor: (props: { content?: string | null }) => {
    editorProps.current = props;
    return <div data-testid="editor" />;
  },
  SaveStatus: () => null,
}));

vi.mock("@/components/book/BookSidePanel", () => ({ BookSidePanel: () => null }));
vi.mock("@/components/ThemeToggle", () => ({ ThemeToggle: () => null }));
vi.mock("@/components/export", () => ({ ExportDialog: () => null }));
vi.mock("@/components/book/BookSettingsDialog", () => ({ BookSettingsDialog: () => null }));
vi.mock("@/components/sync/SyncStatusButton", () => ({
  SyncStatusButton: (props: { defaultScope?: string }) => {
    syncButtonProps.current = props;
    return <button type="button">sync</button>;
  },
}));
vi.mock("@/components/versions/VersionPanel", () => ({ VersionPanel: () => null }));
vi.mock("@/components/versions/HistoryMenuButton", () => ({
  HistoryMenuButton: () => null,
}));
vi.mock("@/components/ui/TruncatedText", () => ({
  TruncatedText: ({ text }: { text: string }) => <p>{text}</p>,
}));

import { BookEditor } from "@/pages/BookEditor";

describe("BookEditor sync scope", () => {
  it("wires the sync button to the Books scope", () => {
    render(<BookEditor />);

    expect(screen.getByRole("button", { name: "sync" })).toBeInTheDocument();
    expect(syncButtonProps.current?.defaultScope).toBe("books");
    expect(chapter.id).toBe("chapter-1");
  });
});
