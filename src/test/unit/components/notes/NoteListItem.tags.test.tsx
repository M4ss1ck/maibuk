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
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
  };
}

describe("NoteListItem tags", () => {
  it("renders up to three tag chips", () => {
    render(
      <ul>
        <NoteListItem
          note={buildNote({ tags: ["draft", "ideas", "research", "plot"] })}
          isSelected={false}
          onSelect={vi.fn()}
        />
      </ul>,
    );

    expect(screen.getByText("draft")).toBeInTheDocument();
    expect(screen.getByText("ideas")).toBeInTheDocument();
    expect(screen.getByText("research")).toBeInTheDocument();
    expect(screen.queryByText("plot")).not.toBeInTheDocument();
  });
});
