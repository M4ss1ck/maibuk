import { act, render, screen } from "@testing-library/react";
import { useEffect, useImperativeHandle, type Ref } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorHandle } from "@/components/editor/Editor";
import { flushPendingEdits, PendingEditsFlushError } from "@/features/sync/pending-edits";

// The mocked Editor stands in for TipTap's coalescer: `burst` holds keystrokes
// the real Editor has not handed to `onUpdate` yet. It drains them the same two
// ways the real one does: through the flush handle, and while unmounting.
const { chapter, otherChapter, chapterState, editorProps, burst, mockUpdateChapter } = vi.hoisted(
  () => {
    const base = {
      bookId: "book-1",
      chapterType: "chapter",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    };
    const first = {
      ...base,
      id: "chapter-1",
      title: "Chapter 1",
      content: "<p>Local</p>",
      order: 1,
      wordCount: 1,
    };
    return {
      chapter: first,
      otherChapter: {
        ...base,
        id: "chapter-2",
        title: "Chapter 2",
        content: "<p>Other</p>",
        order: 2,
        wordCount: 1,
      },
      chapterState: { current: first },
      editorProps: {
        current: null as null | {
          onUpdate: (content: string) => void;
          onExternalContent?: (content: string, wordCount: number) => void;
        },
      },
      burst: { current: null as string | null },
      mockUpdateChapter: vi.fn(),
    };
  }
);

function drainBurst() {
  const pending = burst.current;
  if (pending === null) return;
  burst.current = null;
  editorProps.current?.onUpdate(pending);
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

vi.mock("../../../lib/shortcuts", () => ({
  useShortcuts: vi.fn(),
}));

vi.mock("../../../lib/platform", () => ({
  IS_ANDROID: false,
  IS_DESKTOP: true,
  IS_TAURI: true,
  isMac: () => false,
}));

vi.mock("../../../lib/metrics/MetricsService", () => ({
  metricsService: { endSession: vi.fn(), flushNow: vi.fn().mockResolvedValue(undefined) },
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
    chapters: [chapter, otherChapter],
    currentBookId: "book-1",
    currentChapter: chapterState.current,
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

vi.mock("../../../components/editor", async () => {
  const { SaveStatus } = await vi.importActual<typeof import("@/components/editor/SaveStatus")>(
    "@/components/editor/SaveStatus"
  );
  return {
    ChapterList: () => null,
    Editor: (props: {
      ref?: Ref<EditorHandle>;
      onUpdate: (content: string) => void;
      onExternalContent?: (content: string, wordCount: number) => void;
    }) => {
      editorProps.current = props;
      useImperativeHandle(props.ref, () => ({ flush: drainBurst }));
      useEffect(() => () => drainBurst(), []);
      return <div data-testid="editor" />;
    },
    SaveStatus,
  };
});

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

async function settle() {
  await act(async () => {});
}

/** Saves of `content` to `chapterId` made after the first (failed) attempt. */
function retriesOf(chapterId: string, content: string) {
  return mockUpdateChapter.mock.calls
    .slice(1)
    .filter(([id, input]) => id === chapterId && input?.content === content);
}

describe("BookEditor never silently loses an edit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockUpdateChapter.mockReset().mockResolvedValue(undefined);
    editorProps.current = null;
    burst.current = null;
    chapterState.current = chapter;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("saves typed text when the author leaves the book", async () => {
    const { unmount } = render(<BookEditor />);

    act(() => {
      editorProps.current?.onUpdate("<p>Typed, then left</p>");
    });
    unmount();
    await settle();

    expect(mockUpdateChapter).toHaveBeenCalledWith("chapter-1", {
      content: "<p>Typed, then left</p>",
    });
  });

  it("saves the keystrokes the editor drains while it closes", async () => {
    const { unmount } = render(<BookEditor />);

    burst.current = "<p>Last burst</p>";
    unmount();
    await settle();

    expect(mockUpdateChapter).toHaveBeenLastCalledWith("chapter-1", {
      content: "<p>Last burst</p>",
    });
  });

  it("lets a sync flush save keystrokes the editor is still coalescing", async () => {
    render(<BookEditor />);

    burst.current = "<p>Still coalescing</p>";
    await act(async () => {
      await flushPendingEdits();
    });

    expect(mockUpdateChapter).toHaveBeenCalledWith("chapter-1", {
      content: "<p>Still coalescing</p>",
    });
  });

  it("does not save on a sync flush when nothing was typed", async () => {
    render(<BookEditor />);

    await act(async () => {
      await flushPendingEdits();
    });

    expect(mockUpdateChapter).not.toHaveBeenCalled();
  });

  it("shows Not saved and stops a sync until the save lands", async () => {
    mockUpdateChapter
      .mockRejectedValueOnce(new Error("disk full"))
      .mockRejectedValueOnce(new Error("disk full"));
    render(<BookEditor />);

    act(() => {
      editorProps.current?.onUpdate("<p>Precious</p>");
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText("editor.notSaved")).toBeInTheDocument();

    await act(async () => {
      await expect(flushPendingEdits()).rejects.toBeInstanceOf(PendingEditsFlushError);
    });
    expect(mockUpdateChapter).toHaveBeenCalledTimes(2);
    expect(screen.getByText("editor.notSaved")).toBeInTheDocument();

    await act(async () => {
      await expect(flushPendingEdits()).resolves.toBeUndefined();
    });
    expect(mockUpdateChapter).toHaveBeenCalledTimes(3);
    expect(mockUpdateChapter).toHaveBeenLastCalledWith("chapter-1", { content: "<p>Precious</p>" });
    expect(screen.getByText("editor.saved")).toBeInTheDocument();

    await act(async () => {
      await flushPendingEdits();
    });
    expect(mockUpdateChapter).toHaveBeenCalledTimes(3);
  });

  it("tries a failed save again when the author leaves the book", async () => {
    mockUpdateChapter.mockRejectedValueOnce(new Error("disk full"));
    const { unmount } = render(<BookEditor />);

    act(() => {
      editorProps.current?.onUpdate("<p>Failed once</p>");
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText("editor.notSaved")).toBeInTheDocument();

    unmount();
    await settle();

    expect(retriesOf("chapter-1", "<p>Failed once</p>").length).toBeGreaterThan(0);
  });

  it("tries a failed save of an earlier chapter again when the author leaves the book", async () => {
    mockUpdateChapter.mockRejectedValueOnce(new Error("disk full"));
    const { rerender, unmount } = render(<BookEditor />);

    act(() => {
      editorProps.current?.onUpdate("<p>Failed in chapter one</p>");
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText("editor.notSaved")).toBeInTheDocument();

    // The author moves on to chapter two; the close checkpoint only covers that one.
    chapterState.current = otherChapter;
    rerender(<BookEditor />);
    unmount();
    await settle();

    expect(retriesOf("chapter-1", "<p>Failed in chapter one</p>").length).toBeGreaterThan(0);
  });

  it("retries a failed save on the next edit", async () => {
    mockUpdateChapter.mockRejectedValueOnce(new Error("disk full"));
    render(<BookEditor />);

    act(() => {
      editorProps.current?.onUpdate("<p>First</p>");
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText("editor.notSaved")).toBeInTheDocument();

    act(() => {
      editorProps.current?.onUpdate("<p>First and second</p>");
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(mockUpdateChapter).toHaveBeenLastCalledWith("chapter-1", {
      content: "<p>First and second</p>",
    });
    expect(screen.getByText("editor.saved")).toBeInTheDocument();
  });
});
