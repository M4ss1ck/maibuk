import { act, render } from "@testing-library/react";
import { useEffect, useImperativeHandle, type Ref } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorHandle } from "@/components/editor/Editor";
import type { Note, UpdateNoteInput } from "@/features/notes";
import type { DatabaseAdapter } from "@/lib/platform/types";
import { createTestDatabase } from "@/test/support/db-test-context";

// The NoteEditor dataSafety harness with the real Note store, the real Change
// Feed wiring, and a real in-memory Library: a local write from outside the
// store flushes the editor's pending saves before it persists, so keystrokes
// the author still holds are never dropped silently.

let testDb: DatabaseAdapter;

const { mockGetDatabase, mockReindex } = vi.hoisted(() => ({
  mockGetDatabase: vi.fn(),
  mockReindex: vi.fn(),
}));

vi.mock("../../../../lib/db", () => ({
  getDatabase: mockGetDatabase,
}));

vi.mock("../../../../features/links/link-index", () => ({
  reindexSource: mockReindex,
}));

// The mocked Editor stands in for TipTap's coalescer: `burst` holds keystrokes
// the real Editor has not handed to `onUpdate` yet. It drains them the same two
// ways the real one does: through the flush handle, and while unmounting.
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
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("../../../../features/settings/store", async () => {
  const { DEFAULT_SHORTCUT_SETTINGS } =
    await vi.importActual<typeof import("@/lib/shortcut-resolve")>("@/lib/shortcut-resolve");
  const state: Record<string, unknown> = {
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

vi.mock("../../../../components/ThemeToggle", () => ({
  ThemeToggle: () => null,
}));

vi.mock("../../../../components/sync/SyncStatusButton", () => ({
  SyncStatusButton: () => null,
}));

vi.mock("../../../../lib/platform", () => ({
  IS_ANDROID: false,
  IS_TAURI: false,
  IS_DESKTOP: false,
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("../../../../components/notes/NoteBacklinks", () => ({
  NoteBacklinks: () => null,
}));

vi.mock("../../../../components/editor", async () => {
  const { SaveStatus } = await vi.importActual<typeof import("@/components/editor/SaveStatus")>(
    "@/components/editor/SaveStatus"
  );
  return {
    Editor: (props: {
      ref?: Ref<EditorHandle>;
      content?: string | null;
      onUpdate: (content: string) => void;
      onExternalContent?: (content: string, wordCount: number) => void;
    }) => {
      editorProps.current = props;
      useImperativeHandle(props.ref, () => ({ flush: drainBurst, focus: () => {} }));
      useEffect(() => () => drainBurst(), []);
      // The real Editor drops a dirty burst when outside content replaces the
      // document (ADR 0002); the session must hand the burst over first.
      useEffect(() => {
        burst.current = null;
      }, [props.content]);
      return null;
    },
    SaveStatus,
  };
});

import { NoteEditor } from "@/components/notes/NoteEditor";
import { useNoteStore } from "@/features/notes/store";
import { updateNoteRow } from "@/features/notes/write";
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
function NoteEditorHarness({
  onSave,
}: {
  onSave: (input: UpdateNoteInput) => Promise<Note | null | void>;
}) {
  const note = useNoteStore((state) => state.currentNote);
  if (!note) return null;
  return <NoteEditor note={note} onSave={onSave} />;
}

async function settle() {
  await act(async () => {});
}

async function storedContent(): Promise<string | null> {
  const rows = await testDb.select<{ content: string | null }[]>(
    "SELECT content FROM notes WHERE id = 'note-1'"
  );
  return rows[0]?.content ?? null;
}

type SaveNote = (input: UpdateNoteInput) => Promise<Note | null>;
let realSaveNote: SaveNote | null = null;

/** Records the content of every save the editor's store performs. */
function trackNoteSaves(): string[] {
  const saved: string[] = [];
  realSaveNote = useNoteStore.getState().updateNote;
  useNoteStore.setState({
    updateNote: async (input) => {
      if (input.content !== undefined) saved.push(input.content);
      return realSaveNote!(input);
    },
  });
  return saved;
}

/** Makes the editor's next store save fail, the way a full disk would. */
function failNoteSaves(): void {
  realSaveNote = useNoteStore.getState().updateNote;
  useNoteStore.setState({
    updateNote: async () => {
      throw new Error("disk full");
    },
  });
}

const save = (input: UpdateNoteInput) => useNoteStore.getState().updateNote(input);

describe("NoteEditor after a local write from outside its store", () => {
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
    useNoteStore.setState({ notes: [], currentNote: null, isLoading: false, error: null });
    await testDb.execute(
      `INSERT INTO notes (id, title, content, language, tags, pinned, "order", word_count, collapsed_headings, created_at, updated_at, content_updated_at)
       VALUES ('note-1', 'Title', '<p>Original</p>', 'en', '[]', 0, 0, 1, '[]', 1000, 1000, 1000)`
    );
    await useNoteStore.getState().loadNotes();
    await useNoteStore.getState().loadNote("note-1");
  });

  afterEach(() => {
    if (realSaveNote) {
      useNoteStore.setState({ updateNote: realSaveNote });
      realSaveNote = null;
    }
    resetViewRefreshForTests();
    resetChangeFeedForTests();
    vi.restoreAllMocks();
  });

  it("flushes debounced typing before an outside write replaces the editor", async () => {
    const saved = trackNoteSaves();
    render(<NoteEditorHarness onSave={save} />);
    await settle();
    expect(editorProps.current?.content).toBe("<p>Original</p>");

    act(() => {
      editorProps.current?.onUpdate("<p>Unsaved mine</p>");
    });
    // No manual flush: the outside write itself must land the pending typing
    // before it persists, so nothing typed is lost silently.
    await act(async () => {
      await updateNoteRow({ id: "note-1", content: "<p>Written outside</p>" }, "local");
    });

    expect(saved).toEqual(["<p>Unsaved mine</p>"]);
    expect(editorProps.current?.content).toBe("<p>Written outside</p>");
    expect(await storedContent()).toBe("<p>Written outside</p>");
  });

  it("flushes a coalescing burst before an outside write replaces the editor", async () => {
    const saved = trackNoteSaves();
    render(<NoteEditorHarness onSave={save} />);
    await settle();

    burst.current = "<p>Still coalescing</p>";
    await act(async () => {
      await updateNoteRow({ id: "note-1", content: "<p>Written outside</p>" }, "local");
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
    failNoteSaves();
    render(<NoteEditorHarness onSave={save} />);
    await settle();

    act(() => {
      editorProps.current?.onUpdate("<p>Precious</p>");
    });
    await act(async () => {
      await expect(
        updateNoteRow({ id: "note-1", content: "<p>Written outside</p>" }, "local")
      ).rejects.toBeInstanceOf(PendingEditsFlushError);
    });
    off();

    expect(await storedContent()).toBe("<p>Original</p>");
    expect(editorProps.current?.content).toBe("<p>Original</p>");
    expect(signals.filter(isEntityChange)).toEqual([]);
  });

  it("keeps typing done while the outside write awaits the database", async () => {
    const saved = trackNoteSaves();
    render(<NoteEditorHarness onSave={save} />);
    await settle();

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reachedDatabase = false;
    mockGetDatabase.mockImplementationOnce(() => {
      reachedDatabase = true;
      return gate.then(() => testDb);
    });

    let write!: Promise<unknown>;
    await act(async () => {
      write = updateNoteRow({ id: "note-1", content: "<p>Written outside</p>" }, "local");
      // The write flushed the open editors and is waiting on the database.
      for (let tick = 0; tick < 50 && !reachedDatabase; tick++) await Promise.resolve();
    });
    expect(reachedDatabase).toBe(true);

    // The author types after that flush, before the view refresh lands.
    act(() => {
      editorProps.current?.onUpdate("<p>Typed during the write</p>");
    });

    await act(async () => {
      release();
      await write;
    });
    await settle();
    await act(async () => {
      await flushPendingEdits();
    });

    expect(saved).toEqual(["<p>Typed during the write</p>"]);
    expect(await storedContent()).toBe("<p>Typed during the write</p>");
    expect(editorProps.current?.content).not.toBe("<p>Written outside</p>");
  });

  it("keeps a coalescing burst typed while the outside write awaits the database", async () => {
    const saved = trackNoteSaves();
    render(<NoteEditorHarness onSave={save} />);
    await settle();

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reachedDatabase = false;
    mockGetDatabase.mockImplementationOnce(() => {
      reachedDatabase = true;
      return gate.then(() => testDb);
    });

    let write!: Promise<unknown>;
    await act(async () => {
      write = updateNoteRow({ id: "note-1", content: "<p>Written outside</p>" }, "local");
      for (let tick = 0; tick < 50 && !reachedDatabase; tick++) await Promise.resolve();
    });
    expect(reachedDatabase).toBe(true);

    // The Editor still holds these keystrokes; they were not in the flush.
    burst.current = "<p>Coalescing during the write</p>";

    await act(async () => {
      release();
      await write;
    });
    await settle();
    await act(async () => {
      await flushPendingEdits();
    });

    expect(saved).toEqual(["<p>Coalescing during the write</p>"]);
    expect(await storedContent()).toBe("<p>Coalescing during the write</p>");
  });
});
