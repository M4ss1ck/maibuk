import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NoteEditor } from "../../../../components/notes/NoteEditor";
import type { Note, UpdateNoteInput } from "../../../../features/notes";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "common.back": "Back",
        "common.words": "words",
        "notes.saving": "Saving",
        "notes.saved": "Saved",
        "notes.delete": "Delete note",
        "notes.deleteConfirm": "Delete this note?",
        "notes.titlePlaceholder": "Note title",
        "notes.bodyPlaceholder": "Start writing...",
        "notes.pin": "Pin",
        "notes.unpin": "Unpin",
      };
      return map[key] ?? key;
    },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("../../../../components/editor", () => ({
  Editor: ({
    onUpdate,
    onWordCountChange,
  }: {
    onUpdate: (content: string) => void;
    onWordCountChange: (count: number) => void;
  }) => (
    <div>
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
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
  };
}

describe("NoteEditor", () => {
  it("saves full payload immediately when pin is toggled", async () => {
    const onSave = vi.fn<(input: UpdateNoteInput) => Promise<void>>().mockResolvedValue();

    render(
      <NoteEditor
        note={buildNote({ pinned: false })}
        onSave={onSave}
        onDelete={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Note title"), {
      target: { value: "Edited title" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Apply editor update" }));
    fireEvent.click(screen.getByRole("button", { name: "Pin" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        id: "note-1",
        title: "Edited title",
        content: "<p>Updated body</p>",
        wordCount: 42,
        pinned: true,
      });
    });
  });
});
