import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GridList } from "react-aria-components/GridList";
import { NoteCard } from "@/components/notes/NoteCard";
import type { Note } from "@/features/notes";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => (key === "notes.untitled" ? "Untitled note" : key),
    i18n: { language: "en" },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

function buildNote(overrides: Partial<Note>): Note {
  return {
    id: overrides.id ?? "n1",
    title: overrides.title ?? "My note",
    content: overrides.content ?? "<p>Hello world</p>",
    language: overrides.language ?? "en",
    tags: overrides.tags ?? [],
    pinned: overrides.pinned ?? false,
    order: overrides.order ?? 0,
    wordCount: overrides.wordCount ?? 0,
    collapsedHeadings: overrides.collapsedHeadings ?? [],
    bookId: overrides.bookId ?? null,
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? Math.floor(Date.now() / 1000),
    contentUpdatedAt:
      overrides.contentUpdatedAt ?? overrides.updatedAt ?? Math.floor(Date.now() / 1000),
  };
}

describe("NoteCard", () => {
  it("renders title, stripped content preview and tags, and fires onClick", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <GridList aria-label="Notes" selectionMode="none">
        <NoteCard
          note={buildNote({
            title: "Research",
            content: "<p>Some <b>body</b> text</p>",
            tags: ["idea"],
          })}
          onClick={onClick}
        />
      </GridList>
    );

    expect(screen.getByText("Research")).toBeInTheDocument();
    expect(screen.getByText("Some body text")).toBeInTheDocument();
    expect(screen.getAllByText("idea").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("row"));
    expect(onClick).toHaveBeenCalled();
  });

  it("shows the untitled placeholder when the note has no title", () => {
    render(
      <GridList aria-label="Notes" selectionMode="none">
        <NoteCard note={buildNote({ title: "" })} onClick={vi.fn()} />
      </GridList>
    );
    expect(screen.getByText("Untitled note")).toBeInTheDocument();
  });

  it("renders the linked book title only when provided", () => {
    const { rerender } = render(
      <GridList aria-label="Notes" selectionMode="none">
        <NoteCard note={buildNote({})} bookTitle="My Book" onClick={vi.fn()} />
      </GridList>
    );
    expect(screen.getByText("My Book")).toBeInTheDocument();

    rerender(
      <GridList aria-label="Notes" selectionMode="none">
        <NoteCard note={buildNote({})} bookTitle={null} onClick={vi.fn()} />
      </GridList>
    );
    expect(screen.queryByText("My Book")).not.toBeInTheDocument();
  });
});
