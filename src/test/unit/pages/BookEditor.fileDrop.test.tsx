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
    promises: [] as Promise<void>[],
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
          importControl.promises.push(importControl.promise);
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
    importControl.promises = [];
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

  it("reveals positional imports as each chapter is created in its final list position", async () => {
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
    expect(displayedTitles()).toEqual(["First|Alpha|Second", "First|Alpha|Second"]);

    firstUpdate.resolve();
    await flush();
    rerender(<BookEditor />);
    expect(chapterState.chapters.map((chapter) => chapter.title)).toEqual([
      "First",
      "Second",
      "Alpha",
      "Beta",
    ]);
    expect(displayedTitles()).toEqual(["First|Alpha|Beta|Second", "First|Alpha|Beta|Second"]);

    secondUpdate.resolve();
    await flush();
    rerender(<BookEditor />);
    expect(mockReorderChapters).toHaveBeenCalledWith("book-1", [
      "chapter-1",
      "imported-1",
      "imported-2",
      "chapter-2",
    ]);
    expect(displayedTitles()).toEqual(["First|Alpha|Beta|Second", "First|Alpha|Beta|Second"]);

    reorder.resolve();
    await act(async () => {
      await importControl.promise;
    });
    rerender(<BookEditor />);
    expect(displayedTitles()).toEqual(["First|Alpha|Beta|Second", "First|Alpha|Beta|Second"]);
  });

  it("reveals append imports while their content is still being populated", async () => {
    const update = deferred();
    mockUpdateChapter.mockImplementation(() => update.promise);
    importControl.files = [{ stem: "Append", extension: ".md", text: "Append body" }];

    const { rerender } = render(<BookEditor />);
    fireEvent.click(screen.getAllByRole("button", { name: "import files" })[0]);
    await flush();
    rerender(<BookEditor />);
    expect(displayedTitles()).toEqual(["First|Second|Append", "First|Second|Append"]);

    update.resolve();
    await act(async () => {
      await importControl.promise;
    });
    rerender(<BookEditor />);
    expect(mockReorderChapters).not.toHaveBeenCalled();
    expect(displayedTitles()).toEqual(["First|Second|Append", "First|Second|Append"]);
  });

  it("keeps a created chapter visible after its content import fails", async () => {
    const error = new Error("content update failed");
    const update = deferred();
    mockUpdateChapter.mockImplementation(() => update.promise);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    importControl.files = [{ stem: "Failed", extension: ".md", text: "Failed body" }];

    const { rerender } = render(<BookEditor />);
    fireEvent.click(screen.getAllByRole("button", { name: "import files" })[0]);
    await flush();
    rerender(<BookEditor />);
    expect(displayedTitles()).toEqual(["First|Second|Failed", "First|Second|Failed"]);

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

  it("serializes overlapping imports through persistence before starting the next batch", async () => {
    const firstUpdate = deferred();
    const secondUpdate = deferred();
    const firstReorder = deferred();
    const secondReorder = deferred();
    mockUpdateChapter
      .mockImplementationOnce(() => firstUpdate.promise)
      .mockImplementationOnce(() => secondUpdate.promise);
    mockReorderChapters
      .mockImplementationOnce(async (_bookId: string, ids: string[]) => {
        await firstReorder.promise;
        chapterState.chapters = ids.map((id, order) => ({
          ...chapterState.chapters.find((chapter) => chapter.id === id)!,
          order,
        }));
      })
      .mockImplementationOnce(async (_bookId: string, ids: string[]) => {
        await secondReorder.promise;
        chapterState.chapters = ids.map((id, order) => ({
          ...chapterState.chapters.find((chapter) => chapter.id === id)!,
          order,
        }));
      });

    const { rerender } = render(<BookEditor />);
    importControl.files = [{ stem: "Alpha", extension: ".md", text: "Alpha body" }];
    importControl.target = { id: "chapter-1", placement: "after" };
    fireEvent.click(screen.getAllByRole("button", { name: "import files" })[0]);
    await flush();

    importControl.files = [{ stem: "Beta", extension: ".md", text: "Beta body" }];
    importControl.target = { id: "chapter-2", placement: "before" };
    fireEvent.click(screen.getAllByRole("button", { name: "import files" })[0]);
    await flush();
    rerender(<BookEditor />);

    expect(importControl.promises).toHaveLength(2);
    let secondSettled = false;
    void importControl.promises[1].then(() => {
      secondSettled = true;
    });
    expect(mockCreateChapter).toHaveBeenCalledTimes(1);
    expect(mockUpdateChapter).toHaveBeenCalledTimes(1);
    expect(mockReorderChapters).not.toHaveBeenCalled();
    expect(secondSettled).toBe(false);
    expect(displayedTitles()).toEqual(["First|Alpha|Second", "First|Alpha|Second"]);

    secondUpdate.resolve();
    firstUpdate.resolve();
    await flush();
    rerender(<BookEditor />);
    expect(mockReorderChapters).toHaveBeenCalledTimes(1);
    expect(mockCreateChapter).toHaveBeenCalledTimes(1);
    expect(secondSettled).toBe(false);
    expect(displayedTitles()).toEqual(["First|Alpha|Second", "First|Alpha|Second"]);

    firstReorder.resolve();
    await flush();
    await flush();
    rerender(<BookEditor />);
    expect(mockCreateChapter).toHaveBeenCalledTimes(2);
    expect(mockUpdateChapter).toHaveBeenCalledTimes(2);
    expect(mockReorderChapters).toHaveBeenCalledTimes(2);
    expect(secondSettled).toBe(false);
    expect(displayedTitles()).toEqual(["First|Alpha|Beta|Second", "First|Alpha|Beta|Second"]);

    secondReorder.resolve();
    await act(async () => {
      await Promise.all(importControl.promises);
    });
    rerender(<BookEditor />);
    expect(secondSettled).toBe(true);
    expect(displayedTitles()).toEqual(["First|Alpha|Beta|Second", "First|Alpha|Beta|Second"]);
  });

  it("keeps the import and next queued batch pending through book metadata persistence", async () => {
    const firstMetadataUpdate = deferred();
    mockUpdateChapter.mockResolvedValue(undefined);
    mockUpdateBook
      .mockImplementationOnce(() => firstMetadataUpdate.promise)
      .mockResolvedValueOnce(undefined);

    render(<BookEditor />);
    importControl.files = [{ stem: "Alpha", extension: ".md", text: "Alpha body" }];
    fireEvent.click(screen.getAllByRole("button", { name: "import files" })[0]);
    await flush();
    await flush();
    expect(mockUpdateBook).toHaveBeenCalledTimes(1);

    importControl.files = [{ stem: "Beta", extension: ".md", text: "Beta body" }];
    fireEvent.click(screen.getAllByRole("button", { name: "import files" })[0]);
    await flush();

    let firstSettled = false;
    let secondSettled = false;
    void importControl.promises[0].then(() => {
      firstSettled = true;
    });
    void importControl.promises[1].then(() => {
      secondSettled = true;
    });
    await flush();
    expect(firstSettled).toBe(false);
    expect(secondSettled).toBe(false);
    expect(mockCreateChapter).toHaveBeenCalledTimes(1);

    firstMetadataUpdate.resolve();
    await act(async () => {
      await Promise.all(importControl.promises);
    });

    expect(firstSettled).toBe(true);
    expect(secondSettled).toBe(true);
    expect(mockCreateChapter).toHaveBeenCalledTimes(2);
    expect(mockUpdateBook).toHaveBeenCalledTimes(2);
  });

  it("catches metadata persistence failure and continues the next queued import", async () => {
    const firstMetadataUpdate = deferred();
    const error = new Error("metadata update failed");
    mockUpdateChapter.mockResolvedValue(undefined);
    mockUpdateBook
      .mockImplementationOnce(() => firstMetadataUpdate.promise)
      .mockResolvedValueOnce(undefined);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    render(<BookEditor />);
    importControl.files = [{ stem: "Alpha", extension: ".md", text: "Alpha body" }];
    fireEvent.click(screen.getAllByRole("button", { name: "import files" })[0]);
    await flush();
    await flush();

    importControl.files = [{ stem: "Beta", extension: ".md", text: "Beta body" }];
    fireEvent.click(screen.getAllByRole("button", { name: "import files" })[0]);
    await flush();
    expect(mockCreateChapter).toHaveBeenCalledTimes(1);

    firstMetadataUpdate.reject(error);
    await act(async () => {
      await Promise.all(importControl.promises);
    });

    expect(mockToastError).toHaveBeenCalledWith("editor.importMarkdownFailed");
    expect(consoleError).toHaveBeenCalledWith("File import failed:", error);
    expect(mockCreateChapter).toHaveBeenCalledTimes(2);
    expect(mockUpdateBook).toHaveBeenCalledTimes(2);
    consoleError.mockRestore();
  });

  it("continues queued imports after an earlier batch fails", async () => {
    const firstUpdate = deferred();
    mockUpdateChapter
      .mockImplementationOnce(() => firstUpdate.promise)
      .mockResolvedValueOnce(undefined);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    render(<BookEditor />);
    importControl.files = [{ stem: "Failed", extension: ".md", text: "Failed body" }];
    fireEvent.click(screen.getAllByRole("button", { name: "import files" })[0]);
    await flush();

    importControl.files = [{ stem: "Next", extension: ".md", text: "Next body" }];
    fireEvent.click(screen.getAllByRole("button", { name: "import files" })[0]);
    await flush();
    expect(mockCreateChapter).toHaveBeenCalledTimes(1);

    firstUpdate.reject(new Error("first batch failed"));
    await act(async () => {
      await Promise.all(importControl.promises);
    });

    expect(mockCreateChapter).toHaveBeenCalledTimes(2);
    expect(mockUpdateChapter).toHaveBeenCalledTimes(2);
    expect(mockToastError).toHaveBeenCalledTimes(1);
    expect(displayedTitles()).toEqual(["First|Second|Failed|Next", "First|Second|Failed|Next"]);
    consoleError.mockRestore();
  });

  it("abandons a queued batch when its book is no longer loaded", async () => {
    const firstUpdate = deferred();
    mockUpdateChapter
      .mockImplementationOnce(() => firstUpdate.promise)
      .mockResolvedValueOnce(undefined);

    render(<BookEditor />);
    importControl.files = [{ stem: "First import", extension: ".md", text: "First body" }];
    importControl.target = { id: "chapter-1", placement: "after" };
    fireEvent.click(screen.getAllByRole("button", { name: "import files" })[0]);
    await flush();

    importControl.files = [{ stem: "Stale import", extension: ".md", text: "Stale body" }];
    fireEvent.click(screen.getAllByRole("button", { name: "import files" })[0]);
    await flush();
    expect(mockCreateChapter).toHaveBeenCalledTimes(1);

    chapterState.currentBookId = "book-2";
    chapterState.chapters = [
      { ...buildChapter("other-chapter", "Other book chapter", 0), bookId: "book-2" },
    ];
    firstUpdate.resolve();
    await act(async () => {
      await Promise.all(importControl.promises);
    });

    expect(mockCreateChapter).toHaveBeenCalledTimes(1);
    expect(mockUpdateChapter).toHaveBeenCalledTimes(1);
    expect(mockReorderChapters).not.toHaveBeenCalled();
    expect(mockSetCurrentChapter).not.toHaveBeenCalled();
    expect(mockUpdateBook).not.toHaveBeenCalled();
  });

  it("finishes content persistence when navigation happens during chapter creation", async () => {
    const create = deferred<Chapter>();
    const imported = buildChapter("imported-after-navigation", "Import", 2);
    mockCreateChapter.mockImplementationOnce(() => create.promise);
    mockUpdateChapter.mockResolvedValue(undefined);

    render(<BookEditor />);
    importControl.files = [{ stem: "Import", extension: ".md", text: "Import body" }];
    importControl.target = { id: "chapter-1", placement: "after" };
    fireEvent.click(screen.getAllByRole("button", { name: "import files" })[0]);
    await flush();
    expect(mockCreateChapter).toHaveBeenCalledTimes(1);

    chapterState.currentBookId = "book-2";
    chapterState.chapters = [
      { ...buildChapter("other-chapter", "Other book chapter", 0), bookId: "book-2" },
    ];
    create.resolve(imported);
    await act(async () => {
      await importControl.promise;
    });

    expect(mockUpdateChapter).toHaveBeenCalledWith(imported.id, {
      content: "<p>Import body</p>",
    });
    expect(mockReorderChapters).not.toHaveBeenCalled();
    expect(mockSetCurrentChapter).not.toHaveBeenCalled();
    expect(mockUpdateBook).not.toHaveBeenCalled();
  });

  it("does not select or update the old book when navigation happens during reorder", async () => {
    const reorder = deferred();
    mockUpdateChapter.mockResolvedValue(undefined);
    mockReorderChapters.mockImplementation(() => reorder.promise);

    const { rerender } = render(<BookEditor />);
    importControl.files = [{ stem: "Import", extension: ".md", text: "Import body" }];
    importControl.target = { id: "chapter-1", placement: "after" };
    fireEvent.click(screen.getAllByRole("button", { name: "import files" })[0]);
    await flush();
    await flush();
    expect(mockReorderChapters).toHaveBeenCalledTimes(1);

    chapterState.currentBookId = "book-2";
    chapterState.chapters = [
      { ...buildChapter("other-chapter", "Other book chapter", 0), bookId: "book-2" },
    ];
    reorder.resolve();
    await act(async () => {
      await importControl.promise;
    });
    rerender(<BookEditor />);

    expect(mockSetCurrentChapter).not.toHaveBeenCalled();
    expect(mockUpdateBook).not.toHaveBeenCalled();
    expect(displayedTitles()).toEqual(["Other book chapter", "Other book chapter"]);
  });
});
