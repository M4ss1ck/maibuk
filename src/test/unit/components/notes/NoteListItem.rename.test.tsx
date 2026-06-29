import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NoteListItem } from "../../../../components/notes/NoteListItem";
import type { Note } from "../../../../features/notes";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: {
    type: "3rdParty",
    init: vi.fn(),
  },
}));

function buildNote(overrides: Partial<Note> = {}): Note {
  return {
    id: "note-1",
    bookId: null,
    title: "Old title",
    content: "<p>Preview</p>",
    language: "en",
    tags: [],
    order: 0,
    wordCount: 1,
    createdAt: 1,
    updatedAt: 1,
    contentUpdatedAt: 1,
    pinned: false,
    collapsedHeadings: [],
    ...overrides,
  };
}

describe("NoteListItem title editing", () => {
  it("saves a renamed note title from the sidebar row", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    const note = buildNote();

    render(
      <ul>
        <NoteListItem note={note} isSelected={false} onSelect={vi.fn()} onRename={onRename} />
      </ul>
    );

    await user.click(screen.getByRole("button", { name: "common.edit" }));
    const input = screen.getByDisplayValue("Old title");

    await user.clear(input);
    await user.type(input, "New title{Enter}");

    expect(onRename).toHaveBeenCalledWith(note, "New title");
  });
});
