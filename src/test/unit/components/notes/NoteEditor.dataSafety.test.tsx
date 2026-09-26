import { act, render, screen } from "@testing-library/react";
import { useEffect, useImperativeHandle, type Ref } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NoteEditor } from "@/components/notes/NoteEditor";
import type { EditorHandle } from "@/components/editor/Editor";
import type { Note, UpdateNoteInput } from "@/features/notes";
import { flushPendingEdits, PendingEditsFlushError } from "@/features/sync/pending-edits";

// The mocked Editor stands in for TipTap's coalescer: `burst` holds keystrokes
// the real Editor has not handed to `onUpdate` yet. It drains them the same two
// ways the real one does: through the flush handle, and while unmounting.
const { editorProps, burst } = vi.hoisted(() => ({
  editorProps: {
    current: null as null | {
      onUpdate: (content: string) => void;
      onExternalContent?: (content: string, wordCount: number) => void;
      onSpellCheckLanguageChange?: (language: "en" | "es") => void;
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

vi.mock("../../../../features/settings/store", () => ({
  useSettingsStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ alwaysOnTop: false, setAlwaysOnTop: vi.fn() }),
}));

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
      onUpdate: (content: string) => void;
      onExternalContent?: (content: string, wordCount: number) => void;
    }) => {
      editorProps.current = props;
      useImperativeHandle(props.ref, () => ({ flush: drainBurst, focus: () => {} }));
      useEffect(() => () => drainBurst(), []);
      return null;
    },
    SaveStatus,
  };
});

vi.mock("../../../../features/notes/store", () => ({
  useNoteStore: (selector: (state: { notes: Note[] }) => unknown) => selector({ notes: [] }),
}));

function buildNote(overrides: Partial<Note> = {}): Note {
  return {
    id: "note-1",
    title: "Title",
    content: "<p>Local</p>",
    language: "en",
    tags: [],
    pinned: false,
    order: 0,
    wordCount: 1,
    collapsedHeadings: [],
    createdAt: 1,
    updatedAt: 1,
    contentUpdatedAt: 1,
    ...overrides,
  };
}

async function settle() {
  await act(async () => {});
}

describe("NoteEditor never silently loses an edit", () => {
  let onSave: ReturnType<typeof vi.fn<(input: UpdateNoteInput) => Promise<void>>>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    onSave = vi.fn<(input: UpdateNoteInput) => Promise<void>>().mockResolvedValue();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    editorProps.current = null;
    burst.current = null;
  });

  it("saves typed text when the author switches to another note", async () => {
    const { unmount } = render(<NoteEditor note={buildNote()} onSave={onSave} />);

    act(() => {
      editorProps.current?.onUpdate("<p>Typed, then switched</p>");
    });
    unmount();
    await settle();

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ id: "note-1", content: "<p>Typed, then switched</p>" })
    );
  });

  it("saves the keystrokes the editor drains while it closes", async () => {
    const { unmount } = render(<NoteEditor note={buildNote()} onSave={onSave} />);

    burst.current = "<p>Last burst</p>";
    unmount();
    await settle();

    expect(onSave).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "note-1", content: "<p>Last burst</p>" })
    );
  });

  it("lets a sync flush save keystrokes the editor is still coalescing", async () => {
    render(<NoteEditor note={buildNote()} onSave={onSave} />);

    burst.current = "<p>Still coalescing</p>";
    await act(async () => {
      await flushPendingEdits();
    });

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ content: "<p>Still coalescing</p>" })
    );
  });

  it("does not save on a sync flush when nothing was typed", async () => {
    render(<NoteEditor note={buildNote()} onSave={onSave} />);

    await act(async () => {
      await flushPendingEdits();
    });

    expect(onSave).not.toHaveBeenCalled();
  });

  it("shows Not saved and stops a sync until the save lands", async () => {
    onSave
      .mockRejectedValueOnce(new Error("disk full"))
      .mockRejectedValueOnce(new Error("disk full"));
    render(<NoteEditor note={buildNote()} onSave={onSave} />);

    act(() => {
      editorProps.current?.onUpdate("<p>Precious</p>");
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText("editor.notSaved")).toBeInTheDocument();

    // Still unsaved, so the sync flush retries; this attempt fails too.
    await act(async () => {
      await expect(flushPendingEdits()).rejects.toBeInstanceOf(PendingEditsFlushError);
    });
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(screen.getByText("editor.notSaved")).toBeInTheDocument();

    await act(async () => {
      await expect(flushPendingEdits()).resolves.toBeUndefined();
    });
    expect(onSave).toHaveBeenCalledTimes(3);
    expect(onSave).toHaveBeenLastCalledWith(
      expect.objectContaining({ content: "<p>Precious</p>" })
    );
    expect(screen.getByText("editor.saved")).toBeInTheDocument();

    // Saved now: the next flush has nothing to do.
    await act(async () => {
      await flushPendingEdits();
    });
    expect(onSave).toHaveBeenCalledTimes(3);
  });

  it("retries a failed save on the next edit", async () => {
    onSave.mockRejectedValueOnce(new Error("disk full"));
    render(<NoteEditor note={buildNote()} onSave={onSave} />);

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

    expect(onSave).toHaveBeenLastCalledWith(
      expect.objectContaining({ content: "<p>First and second</p>" })
    );
    expect(screen.getByText("editor.saved")).toBeInTheDocument();
  });

  it("tries a failed save again when the author switches to another note", async () => {
    onSave.mockRejectedValueOnce(new Error("disk full"));
    const { unmount } = render(<NoteEditor note={buildNote()} onSave={onSave} />);

    act(() => {
      editorProps.current?.onUpdate("<p>Failed once</p>");
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText("editor.notSaved")).toBeInTheDocument();

    unmount();
    await settle();

    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave).toHaveBeenLastCalledWith(
      expect.objectContaining({ content: "<p>Failed once</p>" })
    );
  });

  it("keeps a closed note whose save failed in the next sync Flush until it saves", async () => {
    onSave
      .mockRejectedValueOnce(new Error("disk full"))
      .mockRejectedValueOnce(new Error("disk full"));
    const { unmount } = render(<NoteEditor note={buildNote()} onSave={onSave} />);

    act(() => {
      editorProps.current?.onUpdate("<p>Stuck</p>");
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    // Closing retries once, and that fails too.
    unmount();
    await settle();
    expect(onSave).toHaveBeenCalledTimes(2);

    await act(async () => {
      await expect(flushPendingEdits()).resolves.toBeUndefined();
    });
    expect(onSave).toHaveBeenCalledTimes(3);
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ content: "<p>Stuck</p>" }));

    // Saved: the closed note leaves the Flush.
    await act(async () => {
      await flushPendingEdits();
    });
    expect(onSave).toHaveBeenCalledTimes(3);
  });

  it("waits for a running content save before saving the note language", async () => {
    let finishContentSave!: () => void;
    onSave.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishContentSave = resolve;
        })
    );
    render(<NoteEditor note={buildNote()} onSave={onSave} />);

    act(() => {
      editorProps.current?.onUpdate("<p>Typed</p>");
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(onSave).toHaveBeenCalledTimes(1);

    act(() => {
      editorProps.current?.onSpellCheckLanguageChange?.("es");
    });
    await settle();
    // The store rewrites the whole row, so the two writes must not overlap.
    expect(onSave).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishContentSave();
    });
    await settle();

    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave).toHaveBeenLastCalledWith({ id: "note-1", language: "es" });
  });

  it("leaves no status timer running after it closes", async () => {
    const { unmount } = render(<NoteEditor note={buildNote()} onSave={onSave} />);

    act(() => {
      editorProps.current?.onUpdate("<p>Saved</p>");
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText("editor.saved")).toBeInTheDocument();

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});
