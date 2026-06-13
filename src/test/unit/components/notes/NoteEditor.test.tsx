import { fireEvent, render, screen, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NoteEditor } from "../../../../components/notes/NoteEditor";
import type { Note, UpdateNoteInput } from "../../../../features/notes";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: { title?: string }) => {
      const map: Record<string, string> = {
        "common.back": "Back",
        "common.words": "words",
        "notes.saving": "Saving",
        "notes.saved": "Saved",
        "notes.titlePlaceholder": "Note title",
        "notes.bodyPlaceholder": "Start writing...",
        "notes.pin": "Pin",
        "notes.unpin": "Unpin",
      };
      if (key === "notes.backToBook") return `Back to ${params?.title ?? ""}`;
      return map[key] ?? key;
    },
    i18n: { language: "en" },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("../../../../features/settings/store", () => ({
  useSettingsStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ alwaysOnTop: false, setAlwaysOnTop: vi.fn() }),
}));

vi.mock("../../../../components/ThemeToggle", () => ({
  ThemeToggle: () => <button type="button">Theme</button>,
}));

vi.mock("../../../../lib/platform", () => ({
  IS_TAURI: false,
  createDatabase: vi.fn(() =>
    Promise.resolve({
      execute: vi.fn(() => Promise.resolve({ rowsAffected: 0 })),
      select: vi.fn(() => Promise.resolve([])),
      close: vi.fn(() => Promise.resolve()),
      exportData: vi.fn(() => Promise.resolve(new Uint8Array())),
      importData: vi.fn(() => Promise.resolve()),
    }),
  ),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("../../../../components/editor", () => ({
  Editor: ({
    onUpdate,
    onWordCountChange,
    headerContent,
  }: {
    onUpdate: (content: string) => void;
    onWordCountChange: (count: number) => void;
    headerContent?: React.ReactNode;
  }) => (
    <div>
      {headerContent}
      <button
        type="button"
        onClick={() => {
          onUpdate("<p>Updated body</p>");
          onWordCountChange(42);
        }}
      >
        Apply editor update
      </button>
    </div>
  ),
  SaveStatus: ({ status, onSave }: { status: string; onSave: () => void }) => (
    <button type="button" onClick={onSave}>
      Save status: {status}
    </button>
  ),
}));

function buildNote(overrides: Partial<Note>): Note {
  return {
    id: overrides.id ?? "note-1",
    title: overrides.title ?? "Initial",
    content: overrides.content ?? "<p>Initial body</p>",
    tags: overrides.tags ?? [],
    pinned: overrides.pinned ?? false,
    order: overrides.order ?? 0,
    wordCount: overrides.wordCount ?? 10,
    collapsedHeadings: overrides.collapsedHeadings ?? [],
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
  };
}

describe("NoteEditor", () => {
  it("debounces and saves full payload after title and content changes", async () => {
    vi.useFakeTimers();
    const onSave = vi.fn<(input: UpdateNoteInput) => Promise<void>>().mockResolvedValue();

    render(
      <NoteEditor
        note={buildNote({ pinned: false })}
        onSave={onSave}
        onBack={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Note title"), {
      target: { value: "Edited title" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Apply editor update" }));

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await vi.runAllTimersAsync();
    });

    expect(onSave).toHaveBeenCalledWith({
      id: "note-1",
      title: "Edited title",
      content: "<p>Updated body</p>",
      wordCount: 42,
    });

    vi.useRealTimers();
  });

  it("saves immediately when the manual save button is clicked", async () => {
    const onSave = vi.fn<(input: UpdateNoteInput) => Promise<void>>().mockResolvedValue();

    render(
      <NoteEditor
        note={buildNote({ title: "Initial" })}
        onSave={onSave}
        onBack={vi.fn()}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Save status/ }));
    });

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ id: "note-1", title: "Initial" }),
    );
  });

  it("renders a back-to-book button that returns to the book when a target is set", () => {
    const onReturnToBook = vi.fn();

    render(
      <NoteEditor
        note={buildNote({})}
        onSave={vi.fn<(input: UpdateNoteInput) => Promise<void>>().mockResolvedValue()}
        onBack={vi.fn()}
        onReturnToBook={onReturnToBook}
        returnLabel="My Book"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Back to My Book" }));
    expect(onReturnToBook).toHaveBeenCalled();
  });

  it("omits the back-to-book button when no return target is provided", () => {
    render(
      <NoteEditor
        note={buildNote({})}
        onSave={vi.fn<(input: UpdateNoteInput) => Promise<void>>().mockResolvedValue()}
        onBack={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: /Back to/ })).not.toBeInTheDocument();
  });
});
