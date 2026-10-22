import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GridList, GridListItem } from "react-aria-components/GridList";
import { NoteListItem } from "@/components/notes/NoteListItem";
import { noteDateLabel, noteFullDate } from "@/components/notes/timeAgo";
import type { Note } from "@/features/notes";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => (key === "notes.untitled" ? "Untitled note" : key),
    i18n: { language: "en" },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

function buildNote(overrides: Partial<Note> = {}): Note {
  return {
    id: "note-1",
    title: "A note",
    content: "<p>Body</p>",
    language: "en",
    tags: [],
    pinned: false,
    order: 0,
    wordCount: 5,
    collapsedHeadings: [],
    bookId: null,
    createdAt: 1,
    updatedAt: 1,
    contentUpdatedAt: overrides.contentUpdatedAt ?? Math.floor(Date.now() / 1000),
    ...overrides,
  };
}

function renderRow(note: Note) {
  return render(
    <GridList aria-label="Notes" selectionMode="none">
      <GridListItem id={note.id} textValue={note.title}>
        <NoteListItem note={note} isSelected={false} onSelect={vi.fn()} />
      </GridListItem>
    </GridList>
  );
}

describe("NoteListItem date label", () => {
  it("shows the time of day, not a month and day, for a Note edited today", () => {
    const contentUpdatedAt = Math.floor(Date.now() / 1000);
    renderRow(buildNote({ contentUpdatedAt }));

    expect(screen.getAllByText(noteDateLabel(contentUpdatedAt, "en")).length).toBeGreaterThan(0);
    expect(screen.queryByText(/^[A-Z][a-z]{2} \d{1,2}$/)).not.toBeInTheDocument();
  });

  it("describes the row with the full date on the keyboard path", async () => {
    const user = userEvent.setup();
    const contentUpdatedAt = Math.floor(Date.now() / 1000);
    renderRow(buildNote({ contentUpdatedAt }));
    const row = screen.getByRole("row");

    await user.tab();
    if (document.activeElement !== row) await user.keyboard("{ArrowDown}");

    expect(row).toHaveFocus();
    expect(document.activeElement).toHaveAccessibleDescription(
      noteFullDate(contentUpdatedAt, "en")
    );
  });

  it("shows the full date in a tooltip over the date label", async () => {
    const user = userEvent.setup();
    const contentUpdatedAt = Math.floor(Date.now() / 1000);
    renderRow(buildNote({ contentUpdatedAt }));
    const label = screen.getAllByText(noteDateLabel(contentUpdatedAt, "en"))[0];

    await user.hover(label);

    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      noteFullDate(contentUpdatedAt, "en")
    );
  });
});
