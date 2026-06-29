import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BookNotesView } from "../../../../components/book/BookNotesView";
import type { Note } from "../../../../features/notes";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "bookNotes.quickPlaceholder": "Quick note...",
        "bookNotes.add": "Add note",
        "bookNotes.empty": "No notes for this book yet",
        "notes.untitled": "Untitled note",
      };
      return map[key] ?? key;
    },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("../../../../components/book/QuickNoteEditor", () => ({
  QuickNoteEditor: ({
    onChange,
    placeholder,
  }: {
    onChange: (html: string) => void;
    placeholder?: string;
  }) => (
    <textarea
      aria-label="quick-note-editor"
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

function buildNote(overrides: Partial<Note>): Note {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    title: overrides.title ?? "",
    content: overrides.content ?? "",
    language: overrides.language ?? "en",
    tags: overrides.tags ?? [],
    pinned: overrides.pinned ?? false,
    order: overrides.order ?? 0,
    wordCount: overrides.wordCount ?? 0,
    collapsedHeadings: overrides.collapsedHeadings ?? [],
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
    contentUpdatedAt: overrides.contentUpdatedAt ?? overrides.updatedAt ?? 1,
  };
}

describe("BookNotesView", () => {
  it("lists the book's notes and opens one on click", () => {
    const onOpenNote = vi.fn();
    const notes = [
      buildNote({ id: "n1", title: "Outline" }),
      buildNote({ id: "n2", title: "Character ideas" }),
    ];

    render(<BookNotesView notes={notes} onCreateNote={vi.fn()} onOpenNote={onOpenNote} />);

    expect(screen.getByText("Outline")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Character ideas"));
    expect(onOpenNote).toHaveBeenCalledWith("n2");
  });

  it("shows an empty state when the book has no notes", () => {
    render(<BookNotesView notes={[]} onCreateNote={vi.fn()} onOpenNote={vi.fn()} />);

    expect(screen.getByText("No notes for this book yet")).toBeInTheDocument();
  });

  it("creates a note from the quick-note input", () => {
    const onCreateNote = vi.fn();

    render(<BookNotesView notes={[]} onCreateNote={onCreateNote} onOpenNote={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("quick-note-editor"), {
      target: { value: "<p>A fresh idea</p>" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));

    expect(onCreateNote).toHaveBeenCalledWith("<p>A fresh idea</p>");
  });

  it("ignores a quick note with no text content", () => {
    const onCreateNote = vi.fn();

    render(<BookNotesView notes={[]} onCreateNote={onCreateNote} onOpenNote={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("quick-note-editor"), {
      target: { value: "<p></p>" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));

    expect(onCreateNote).not.toHaveBeenCalled();
  });
});
