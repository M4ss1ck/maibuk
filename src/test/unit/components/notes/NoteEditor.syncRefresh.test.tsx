import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NoteEditor } from "@/components/notes/NoteEditor";
import type { Note, UpdateNoteInput } from "@/features/notes";
import { flushPendingEdits } from "@/features/sync/pending-edits";

const { editorProps } = vi.hoisted(() => ({
  editorProps: {
    current: null as null | {
      content?: string | null;
      onUpdate: (content: string) => void;
      onExternalContent?: (content: string, wordCount: number) => void;
    },
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => (key === "notes.addTag" ? "Add tag" : key),
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
  createDatabase: vi.fn(() =>
    Promise.resolve({
      execute: vi.fn(() => Promise.resolve({ rowsAffected: 0 })),
      select: vi.fn(() => Promise.resolve([])),
      close: vi.fn(() => Promise.resolve()),
      exportData: vi.fn(() => Promise.resolve(new Uint8Array())),
      importData: vi.fn(() => Promise.resolve()),
    })
  ),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("../../../../components/editor", () => ({
  Editor: (props: {
    headerContent?: React.ReactNode;
    onUpdate: (content: string) => void;
    onExternalContent?: (content: string, wordCount: number) => void;
  }) => {
    editorProps.current = props;
    return <div>{props.headerContent}</div>;
  },
  SaveStatus: () => null,
}));

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

describe("NoteEditor after a sync pull replaces the document", () => {
  afterEach(() => {
    vi.useRealTimers();
    editorProps.current = null;
  });

  it("drops a save queued for the old text and shows the pulled text", async () => {
    vi.useFakeTimers();
    const onSave = vi.fn<(input: UpdateNoteInput) => Promise<void>>().mockResolvedValue();
    const { rerender } = render(<NoteEditor note={buildNote()} onSave={onSave} />);

    act(() => {
      editorProps.current?.onUpdate("<p>Typed before the pull</p>");
    });
    rerender(<NoteEditor note={buildNote({ content: "<p>Remote</p>" })} onSave={onSave} />);
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });

    expect(onSave).not.toHaveBeenCalled();
    expect(editorProps.current?.content).toBe("<p>Remote</p>");
  });

  it("lets an automatic sync land the pending save before it reads the database", async () => {
    vi.useFakeTimers();
    const { flushPendingEdits } = await import("@/features/sync/pending-edits");
    const onSave = vi.fn<(input: UpdateNoteInput) => Promise<void>>().mockResolvedValue();
    const { unmount } = render(<NoteEditor note={buildNote()} onSave={onSave} />);

    act(() => {
      editorProps.current?.onUpdate("<p>Typed just before the sync</p>");
    });
    await act(async () => {
      await flushPendingEdits();
    });

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ content: "<p>Typed just before the sync</p>" })
    );

    // Unmounted editors are no longer flushed.
    unmount();
    onSave.mockClear();
    await flushPendingEdits();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("saves later edits on top of the pulled text, with its word count", async () => {
    const onSave = vi.fn<(input: UpdateNoteInput) => Promise<void>>().mockResolvedValue();
    const { rerender } = render(<NoteEditor note={buildNote()} onSave={onSave} />);

    const pulled = buildNote({ content: "<p>Pulled from another device</p>", wordCount: 4 });
    rerender(<NoteEditor note={pulled} onSave={onSave} />);
    // The Editor applies the pulled document and reports its word count.
    act(() => {
      editorProps.current?.onExternalContent?.("<p>Pulled from another device</p>", 4);
    });
    act(() => {
      editorProps.current?.onUpdate("<p>Pulled from another device</p><p>More</p>");
    });
    await act(async () => {
      await flushPendingEdits();
    });

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "<p>Pulled from another device</p><p>More</p>",
        wordCount: 4,
      })
    );
    expect(onSave).not.toHaveBeenCalledWith(expect.objectContaining({ content: "<p>Local</p>" }));
  });
});
