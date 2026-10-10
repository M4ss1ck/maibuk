import { act, render } from "@testing-library/react";
import { useEffect, useImperativeHandle, type Ref } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorHandle } from "@/components/editor/Editor";
import type { DatabaseAdapter } from "@/lib/platform/types";
import { createTestDatabase } from "@/test/support/db-test-context";

// The dataSafety harness, with the real book/chapter stores, the real Change
// Feed wiring, and a real in-memory Library: an outside writer (a Plugin, an
// import, an agent) reaches the open Chapter editor through its store, and
// typing the writer flushed first is never lost.

let testDb: DatabaseAdapter;

const { mockGetDatabase, mockReindex } = vi.hoisted(() => ({
  mockGetDatabase: vi.fn(),
  mockReindex: vi.fn(),
}));

vi.mock("../../../lib/db", () => ({
  getDatabase: mockGetDatabase,
}));

vi.mock("../../../features/links/link-index", () => ({
  reindexSource: mockReindex,
}));

// The mocked Editor stands in for TipTap's coalescer: `burst` holds keystrokes
// the real Editor has not handed to `onUpdate` yet. It drains them the same
// two ways the real one does: through the flush handle, and while unmounting.
const { editorProps, burst } = vi.hoisted(() => ({
  editorProps: {
    current: null as null | {
      content?: string | null;
      onUpdate: (content: string) => void;
      onExternalContent?: (content: string, wordCount: number) => void;
    },
  },
  burst: { current: null as string | null },
}));

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

vi.mock("../../../features/settings/store", async () => {
  const { DEFAULT_SHORTCUT_SETTINGS } =
    await vi.importActual<typeof import("@/lib/shortcut-resolve")>("@/lib/shortcut-resolve");
  const state: Record<string, unknown> = {
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

vi.mock("../../../components/editor", async () => {
  const { SaveStatus } = await vi.importActual<typeof import("@/components/editor/SaveStatus")>(
    "@/components/editor/SaveStatus"
  );
  return {
    ChapterList: () => null,
    Editor: (props: {
      ref?: Ref<EditorHandle>;
      content?: string | null;
      onUpdate: (content: string) => void;
      onExternalContent?: (content: string, wordCount: number) => void;
    }) => {
      editorProps.current = props;
      useImperativeHandle(props.ref, () => ({ flush: drainBurst, focus: () => {} }));
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
import { useBookStore } from "@/features/books/store";
import { useChapterStore } from "@/features/chapters/store";
import { useNoteStore } from "@/features/notes/store";
import type { Chapter, UpdateChapterInput } from "@/features/chapters/types";
import { updateChapterRow } from "@/features/chapters/write";
import {
  flushPendingEdits,
  PendingEditsFlushError,
  resetPendingEditsForTests,
} from "@/features/sync/pending-edits";
import { installViewRefresh, resetViewRefreshForTests } from "@/features/sync/view-refresh";
import {
  isEntityChange,
  onChange,
  resetChangeFeedForTests,
  type ChangeFeedSignal,
} from "@/features/sync/change-feed";

async function settle() {
  await act(async () => {});
}

async function storedContent(): Promise<string | null> {
  const rows = await testDb.select<{ content: string | null }[]>(
    "SELECT content FROM chapters WHERE id = 'chapter-1'"
  );
  return rows[0]?.content ?? null;
}

type SaveChapter = (id: string, input: UpdateChapterInput) => Promise<Chapter | null>;
let realSaveChapter: SaveChapter | null = null;

/** Records the content of every save the editor's store performs. */
function trackChapterSaves(): string[] {
  const saved: string[] = [];
  realSaveChapter = useChapterStore.getState().updateChapter;
  useChapterStore.setState({
    updateChapter: async (id, input) => {
      if (input.content !== undefined) saved.push(input.content);
      return realSaveChapter!(id, input);
    },
  });
  return saved;
}

/** Makes the editor's next store save fail, the way a full disk would. */
function failChapterSaves(): void {
  realSaveChapter = useChapterStore.getState().updateChapter;
  useChapterStore.setState({
    updateChapter: async () => {
      throw new Error("disk full");
    },
  });
}

describe("BookEditor after a local write from outside its store", () => {
  beforeEach(async () => {
    testDb = await createTestDatabase();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockGetDatabase.mockReset().mockResolvedValue(testDb);
    mockReindex.mockReset().mockResolvedValue(undefined);
    resetChangeFeedForTests();
    resetViewRefreshForTests();
    resetPendingEditsForTests();
    installViewRefresh();
    editorProps.current = null;
    burst.current = null;
    useBookStore.setState({ books: [], currentBook: null, isLoading: false, error: null });
    useChapterStore.setState({
      chapters: [],
      currentChapter: null,
      currentBookId: null,
      isLoading: false,
      error: null,
    });
    useNoteStore.setState({ notes: [], currentNote: null, isLoading: false, error: null });
    await testDb.execute(
      `INSERT INTO books (id, title, author_name, language, created_at, updated_at, content_updated_at)
       VALUES ('book-1', 'Draft', 'Author', 'en', 1000, 1000, 1000)`
    );
    await testDb.execute(
      `INSERT INTO chapters (id, book_id, title, content, "order", chapter_type, word_count, status, is_included_in_export, created_at, updated_at)
       VALUES ('chapter-1', 'book-1', 'Chapter 1', '<p>Original</p>', 0, 'chapter', 1, 'draft', 1, 1000, 1000)`
    );
  });

  afterEach(() => {
    if (realSaveChapter) {
      useChapterStore.setState({ updateChapter: realSaveChapter });
      realSaveChapter = null;
    }
    resetViewRefreshForTests();
    resetChangeFeedForTests();
    vi.restoreAllMocks();
  });

  it("reaches the open editor when a write bypasses its store", async () => {
    render(<BookEditor />);
    await settle();
    expect(editorProps.current?.content).toBe("<p>Original</p>");

    await act(async () => {
      await updateChapterRow("chapter-1", { content: "<p>Written outside</p>" }, "local");
    });

    expect(editorProps.current?.content).toBe("<p>Written outside</p>");
  });

  it("flushes debounced typing before an outside write replaces the editor", async () => {
    const saved = trackChapterSaves();
    render(<BookEditor />);
    await settle();

    act(() => {
      editorProps.current?.onUpdate("<p>Unsaved mine</p>");
    });
    // No manual flush: the outside write itself must land the pending typing
    // before it persists, so nothing typed is lost silently.
    await act(async () => {
      await updateChapterRow("chapter-1", { content: "<p>Written outside</p>" }, "local");
    });

    expect(saved).toEqual(["<p>Unsaved mine</p>"]);
    expect(editorProps.current?.content).toBe("<p>Written outside</p>");
    expect(await storedContent()).toBe("<p>Written outside</p>");
  });

  it("flushes a coalescing burst before an outside write replaces the editor", async () => {
    const saved = trackChapterSaves();
    render(<BookEditor />);
    await settle();

    // The Editor still holds these keystrokes; the outside write's flush must
    // drain them through the flush handle before persisting.
    burst.current = "<p>Still coalescing</p>";
    await act(async () => {
      await updateChapterRow("chapter-1", { content: "<p>Written outside</p>" }, "local");
    });

    expect(saved).toEqual(["<p>Still coalescing</p>"]);
    expect(editorProps.current?.content).toBe("<p>Written outside</p>");
    expect(await storedContent()).toBe("<p>Written outside</p>");
  });

  it("refuses an outside write when the pending save fails", async () => {
    const signals: ChangeFeedSignal[] = [];
    const off = onChange((signal) => {
      signals.push(signal);
    });
    failChapterSaves();
    render(<BookEditor />);
    await settle();

    act(() => {
      editorProps.current?.onUpdate("<p>Precious</p>");
    });
    await act(async () => {
      await expect(
        updateChapterRow("chapter-1", { content: "<p>Written outside</p>" }, "local")
      ).rejects.toBeInstanceOf(PendingEditsFlushError);
    });
    off();

    // Nothing persisted, nothing emitted, and the editor still holds the text.
    expect(await storedContent()).toBe("<p>Original</p>");
    expect(editorProps.current?.content).toBe("<p>Original</p>");
    expect(signals.filter(isEntityChange)).toEqual([]);
  });

  it("keeps typing typed after the outside write when the store saves it", async () => {
    render(<BookEditor />);
    await settle();

    await act(async () => {
      await updateChapterRow("chapter-1", { content: "<p>Written outside</p>" }, "local");
    });
    expect(editorProps.current?.content).toBe("<p>Written outside</p>");

    // The author types on top of the outside content; the next save carries it.
    act(() => {
      editorProps.current?.onUpdate("<p>Written outside, then mine</p>");
    });
    await act(async () => {
      await flushPendingEdits();
    });

    expect(await storedContent()).toBe("<p>Written outside, then mine</p>");
  });
});
