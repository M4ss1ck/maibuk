import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Chapter } from "@/features/chapters/types";
import type { DroppedTextFile } from "@/hooks/useTextFileDrop";
import type { ListDropTarget } from "@/lib/drop-target";

const {
  chapterState,
  mockCreateChapter,
  mockUpdateChapter,
  mockReorderChapters,
  mockSetCurrentChapter,
  mockUpdateBook,
  mockToastError,
  importControl,
} = vi.hoisted(() => ({
  chapterState: {
    chapters: [] as Chapter[],
    currentBookId: "book-1" as string | null,
    currentChapter: null as Chapter | null,
    isLoading: false,
  },
  mockCreateChapter: vi.fn(),
  mockUpdateChapter: vi.fn(),
  mockReorderChapters: vi.fn(),
  mockSetCurrentChapter: vi.fn(),
  mockUpdateBook: vi.fn(),
  mockToastError: vi.fn(),
  importControl: {
    files: [] as DroppedTextFile[],
    target: null as ListDropTarget | null,
    promise: null as Promise<void> | null,
  },
}));

function buildChapter(id: string, title: string, order: number): Chapter {
  return {
    id,
    bookId: "book-1",
    title,
    content: "",
    order,
    chapterType: "chapter",
    wordCount: 0,
    status: "draft",
    isIncludedInExport: true,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

function displayedTitles() {
  return screen.getAllByTestId("chapter-list-titles").map((node) => node.textContent);
}

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("react-router-dom", () => ({
  useParams: () => ({ bookId: "book-1" }),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ state: null, pathname: "/book/book-1" }),
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
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    },
    isLoading: false,
    loadBook: vi.fn(),
    updateWordCount: vi.fn(),
    updateBook: mockUpdateBook,
    deleteBook: vi.fn(),
  }),
}));

vi.mock("../../../features/chapters/store", () => {
  const useChapterStore = () => ({
    ...chapterState,
    loadChapters: vi.fn(),
    createChapter: mockCreateChapter,
    updateChapter: mockUpdateChapter,
    deleteChapter: vi.fn(),
    reorderChapters: mockReorderChapters,
    setCurrentChapter: mockSetCurrentChapter,
  });
  useChapterStore.getState = () => chapterState;
  return { useChapterStore };
});

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

vi.mock("../../../features/versions/useAutoCheckpoint", () => ({ useAutoCheckpoint: vi.fn() }));
vi.mock("../../../features/versions/store", () => ({
  useVersionStore: { getState: () => ({ createVersion: vi.fn() }) },
}));
vi.mock("../../../components/ui/Toast", () => ({
  toast: { success: vi.fn(), error: mockToastError },
}));

vi.mock("../../../components/editor", () => ({
  ChapterList: (props: {
    chapters: Chapter[];
    onImportFiles: (files: DroppedTextFile[], target: ListDropTarget | null) => Promise<void>;
  }) => (
    <div>
      <span data-testid="chapter-list-titles">
        {props.chapters.map((chapter) => chapter.title).join("|")}
      </span>
      <button
        type="button"
        onClick={() => {
          importControl.promise = props.onImportFiles(importControl.files, importControl.target);
        }}
      >
        import files
      </button>
    </div>
  ),
  Editor: () => <div data-testid="editor" />,
  SaveStatus: () => null,
}));
vi.mock("../../../components/book/BookSidePanel", () => ({ BookSidePanel: () => null }));
vi.mock("../../../components/ThemeToggle", () => ({ ThemeToggle: () => null }));
vi.mock("../../../components/export", () => ({ ExportDialog: () => null }));
vi.mock("../../../components/book/BookSettingsDialog", () => ({
  BookSettingsDialog: () => null,
}));
vi.mock("../../../components/sync/SyncStatusButton", () => ({ SyncStatusButton: () => null }));
vi.mock("../../../components/versions/VersionPanel", () => ({ VersionPanel: () => null }));
vi.mock("../../../components/versions/HistoryMenuButton", () => ({
  HistoryMenuButton: () => null,
}));

import { BookEditor } from "@/pages/BookEditor";

describe("BookEditor file-drop imports", () => {
  beforeEach(() => {
    chapterState.chapters = [
      buildChapter("chapter-1", "First", 0),
      buildChapter("chapter-2", "Second", 1),
    ];
    chapterState.currentBookId = "book-1";
    chapterState.currentChapter = chapterState.chapters[0];
    chapterState.isLoading = false;
    importControl.files = [];
    importControl.target = null;
    importControl.promise = null;
    mockCreateChapter.mockReset();
    mockUpdateChapter.mockReset();
    mockReorderChapters.mockReset();
    mockSetCurrentChapter.mockReset();
    mockUpdateBook.mockReset();
    mockToastError.mockReset();

    let nextId = 1;
    mockCreateChapter.mockImplementation(async ({ title }: { title: string }) => {
      const chapter = buildChapter(`imported-${nextId++}`, title, chapterState.chapters.length);
      chapterState.chapters = [...chapterState.chapters, chapter];
      return chapter;
    });
  });

  it("keeps positional imports hidden until their final persisted order is ready", async () => {
    const firstUpdate = deferred();
    const secondUpdate = deferred();
    const reorder = deferred();
    mockUpdateChapter
      .mockImplementationOnce(() => firstUpdate.promise)
      .mockImplementationOnce(() => secondUpdate.promise);
    mockReorderChapters.mockImplementation(async (_bookId: string, ids: string[]) => {
      await reorder.promise;
      chapterState.chapters = ids.map((id, order) => ({
        ...chapterState.chapters.find((chapter) => chapter.id === id)!,
        order,
      }));
    });
    importControl.files = [
      { stem: "Alpha", extension: ".md", text: "Alpha body" },
      { stem: "Beta", extension: ".txt", text: "Beta body" },
    ];
    importControl.target = { id: "chapter-1", placement: "after" };

    const { rerender } = render(<BookEditor />);
    fireEvent.click(screen.getAllByRole("button", { name: "import files" })[0]);
    await flush();
    rerender(<BookEditor />);

    expect(chapterState.chapters.map((chapter) => chapter.title)).toEqual([
      "First",
      "Second",
      "Alpha",
    ]);
    expect(displayedTitles()).toEqual(["First|Second", "First|Second"]);

    firstUpdate.resolve();
    await flush();
    rerender(<BookEditor />);
    expect(chapterState.chapters.map((chapter) => chapter.title)).toEqual([
      "First",
      "Second",
      "Alpha",
      "Beta",
    ]);
    expect(displayedTitles()).toEqual(["First|Second", "First|Second"]);

    secondUpdate.resolve();
    await flush();
    rerender(<BookEditor />);
    expect(mockReorderChapters).toHaveBeenCalledWith("book-1", [
      "chapter-1",
      "imported-1",
      "imported-2",
      "chapter-2",
    ]);
    expect(displayedTitles()).toEqual(["First|Second", "First|Second"]);

    reorder.resolve();
    await act(async () => {
      await importControl.promise;
    });
    rerender(<BookEditor />);
    expect(displayedTitles()).toEqual([
      "First|Alpha|Beta|Second",
      "First|Alpha|Beta|Second",
    ]);
  });

  it("keeps append imports hidden through content population, then reveals them appended", async () => {
    const update = deferred();
    mockUpdateChapter.mockImplementation(() => update.promise);
    importControl.files = [
      { stem: "Append", extension: ".md", text: "Append body" },
    ];

    const { rerender } = render(<BookEditor />);
    fireEvent.click(screen.getAllByRole("button", { name: "import files" })[0]);
    await flush();
    rerender(<BookEditor />);
    expect(displayedTitles()).toEqual(["First|Second", "First|Second"]);

    update.resolve();
    await act(async () => {
      await importControl.promise;
    });
    rerender(<BookEditor />);
    expect(mockReorderChapters).not.toHaveBeenCalled();
    expect(displayedTitles()).toEqual(["First|Second|Append", "First|Second|Append"]);
  });

  it("clears the snapshot after failure so the persisted chapter list is not frozen", async () => {
    const error = new Error("content update failed");
    const update = deferred();
    mockUpdateChapter.mockImplementation(() => update.promise);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    importControl.files = [
      { stem: "Failed", extension: ".md", text: "Failed body" },
    ];

    const { rerender } = render(<BookEditor />);
    fireEvent.click(screen.getAllByRole("button", { name: "import files" })[0]);
    await flush();
    rerender(<BookEditor />);
    expect(displayedTitles()).toEqual(["First|Second", "First|Second"]);

    update.reject(error);
    await act(async () => {
      await importControl.promise;
    });
    rerender(<BookEditor />);

    expect(displayedTitles()).toEqual(["First|Second|Failed", "First|Second|Failed"]);
    expect(mockToastError).toHaveBeenCalledWith("editor.importMarkdownFailed");
    expect(consoleError).toHaveBeenCalledWith("File import failed:", error);
    consoleError.mockRestore();
  });
});
