import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NotesList } from "../../../../components/notes/NotesList";
import type { Note } from "../../../../features/notes";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: { count?: number }) => {
      const map: Record<string, string> = {
        "notes.title": "Notes",
        "notes.newNote": "New note",
        "notes.search": "Search notes...",
        "notes.empty": "No notes",
      };

      if (key === "notes.noteCount_one") {
        return `${params?.count ?? 0} note`;
      }

      if (key === "notes.noteCount_other") {
        return `${params?.count ?? 0} notes`;
      }

      return map[key] ?? key;
    },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

function buildNote(overrides: Partial<Note>): Note {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    title: overrides.title ?? "",
    content: overrides.content ?? "",
    tags: overrides.tags ?? [],
    pinned: overrides.pinned ?? false,
    order: overrides.order ?? 0,
    wordCount: overrides.wordCount ?? 0,
    collapsedHeadings: overrides.collapsedHeadings ?? [],
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
  };
}

describe("NotesList", () => {
  it("reorders the full list on drop when search is not active", () => {
    const onReorderNotes = vi.fn();
    const notes = [
      buildNote({ id: "a", title: "Alpha", order: 0 }),
      buildNote({ id: "b", title: "Bravo", order: 1 }),
      buildNote({ id: "c", title: "Charlie", order: 2 }),
    ];

    render(
      <NotesList
        notes={notes}
        currentNoteId={null}
        onSelectNote={vi.fn()}
        onCreateNote={vi.fn()}
        onReorderNotes={onReorderNotes}
      />,
    );

    const source = screen.getByText("Charlie").closest("li");
    const target = screen.getByText("Alpha").closest("li");

    expect(source).not.toBeNull();
    expect(target).not.toBeNull();

    if (!source || !target) {
      throw new Error("Expected note rows to exist");
    }

    const dataTransfer = {
      effectAllowed: "",
      dropEffect: "",
      setData: vi.fn(),
    } as unknown as DataTransfer;

    fireEvent.dragStart(source, { dataTransfer });
    fireEvent.dragOver(target, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });

    expect(onReorderNotes).toHaveBeenCalledWith(["c", "a", "b"]);
  });

  it("disables dragging while a search query is active", () => {
    const onReorderNotes = vi.fn();
    const notes = [
      buildNote({ id: "a", title: "Alpha", content: "" }),
      buildNote({ id: "b", title: "Bravo", content: "" }),
    ];

    render(
      <NotesList
        notes={notes}
        currentNoteId={null}
        onSelectNote={vi.fn()}
        onCreateNote={vi.fn()}
        onReorderNotes={onReorderNotes}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Search notes..."), {
      target: { value: "alp" },
    });

    const row = screen.getByText("Alpha").closest("li");
    expect(row).not.toBeNull();

    if (!row) {
      throw new Error("Expected filtered row to exist");
    }

    expect(row).not.toHaveAttribute("draggable");

    fireEvent.drop(row);
    expect(onReorderNotes).not.toHaveBeenCalled();
  });
});
