import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NoteListItem } from "../../../../components/notes/NoteListItem";
import type { Note } from "../../../../features/notes";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      if (key === "notes.untitled") return "Untitled note";
      return key;
    },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

function buildNote(overrides: Partial<Note>): Note {
  return {
    id: overrides.id ?? "note-1",
    title: overrides.title ?? "A note",
    content: overrides.content ?? "<p>Body</p>",
    tags: overrides.tags ?? ["a", "b", "c", "d"],
    pinned: overrides.pinned ?? false,
    order: overrides.order ?? 0,
    wordCount: overrides.wordCount ?? 5,
    collapsedHeadings: overrides.collapsedHeadings ?? [],
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
  };
}

describe("NoteListItem tags", () => {
  // jsdom reports zero element widths, so the row falls back to showing the
  // first tag plus a counter for the rest.
  it("shows at least one tag and a counter for the overflow", () => {
    render(
      <ul>
        <NoteListItem
          note={buildNote({ tags: ["draft", "ideas", "research", "plot"] })}
          isSelected={false}
          onSelect={vi.fn()}
        />
      </ul>,
    );

    // The hidden measurement layer also contains chips, so query by visible row.
    expect(screen.getAllByText("draft").length).toBeGreaterThan(0);
    expect(screen.getByText("+3")).toBeInTheDocument();
  });

  it("renders no counter when there are no tags", () => {
    render(
      <ul>
        <NoteListItem note={buildNote({ tags: [] })} isSelected={false} onSelect={vi.fn()} />
      </ul>,
    );

    expect(screen.queryByText(/^\+\d+$/)).not.toBeInTheDocument();
  });

  it("positions the drag handle over the meta line on the right", () => {
    render(
      <ul>
        <NoteListItem note={buildNote({ content: "<p>Preview text</p>" })} isSelected={false} onSelect={vi.fn()} />
      </ul>,
    );

    const handle = screen.getByTestId("note-drag-handle");
    expect(handle).toHaveClass("absolute");
    expect(handle).toHaveClass("right-0");
  });

  it("uses a drag cursor for draggable rows", () => {
    render(
      <ul>
        <NoteListItem note={buildNote({ title: "Draggable" })} isSelected={false} onSelect={vi.fn()} draggable />
      </ul>,
    );

    const row = screen.getByText("Draggable").closest("li");
    expect(row).not.toBeNull();
    expect(row).toHaveClass("cursor-grab");
    expect(row).toHaveClass("active:cursor-grabbing");
  });
});
