import { describe, expect, it } from "vitest";
import type { Book } from "../../../../features/books/types";
import type { Note } from "../../../../features/notes";
import {
  buildBookNoteGroups,
  buildDateNoteGroups,
  buildListNoteSections,
  buildTagNoteGroups,
  filterNotes,
} from "../../../../components/notes/notes-list-model";

type NoteInput = Partial<Note> & { id: string; title: string; bookId?: string | null };

function note(input: NoteInput): Note & { bookId?: string | null } {
  return {
    content: "",
    tags: [],
    pinned: false,
    order: 0,
    wordCount: 0,
    collapsedHeadings: [],
    createdAt: 1,
    updatedAt: 1,
    ...input,
  };
}

function book(input: Pick<Book, "id" | "title">): Book {
  return {
    id: input.id,
    title: input.title,
    authorName: "Author",
    language: "en",
    wordCount: 0,
    status: "draft",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

describe("notes list model", () => {
  it("filters notes by title and plain text content", () => {
    const notes = [
      note({ id: "a", title: "Research", content: "<p>Moon garden</p>" }),
      note({ id: "b", title: "Scene", content: "<p>Kitchen table</p>" }),
    ];

    expect(filterNotes(notes, "moon")).toEqual([notes[0]]);
    expect(filterNotes(notes, "scene")).toEqual([notes[1]]);
    expect(filterNotes(notes, "   ")).toEqual(notes);
  });

  it("splits list mode into pinned and all-notes sections", () => {
    const pinned = note({ id: "p", title: "Pinned", pinned: true });
    const regular = note({ id: "r", title: "Regular" });

    expect(buildListNoteSections([pinned, regular], "")).toEqual([
      { id: "pinned", notes: [pinned] },
      { id: "all", notes: [regular] },
    ]);
  });

  it("groups notes by book, keeps empty books, and appends unfiled notes last", () => {
    const bookA = book({ id: "book-a", title: "Book A" });
    const bookB = book({ id: "book-b", title: "Book B" });
    const filed = note({ id: "n1", title: "Filed", bookId: "book-a" });
    const unfiled = note({ id: "n2", title: "Loose" });

    expect(buildBookNoteGroups([filed, unfiled], [bookA, bookB])).toEqual([
      { id: "book-a", title: "Book A", book: bookA, notes: [filed] },
      { id: "book-b", title: "Book B", book: bookB, notes: [] },
      { id: "unfiled", title: "Unfiled", book: null, notes: [unfiled] },
    ]);
  });

  it("groups notes by tag and repeats notes with multiple tags", () => {
    const craft = note({ id: "a", title: "Craft", tags: ["craft", "revision"] });
    const revision = note({ id: "b", title: "Revision", tags: ["revision"] });

    expect(buildTagNoteGroups([craft, revision])).toEqual([
      { id: "craft", title: "craft", tag: "craft", notes: [craft] },
      { id: "revision", title: "revision", tag: "revision", notes: [craft, revision] },
    ]);
  });

  it("groups dates without repeating today in this week or this week in year groups", () => {
    const now = new Date("2026-06-12T12:00:00Z");
    const today = note({
      id: "today",
      title: "Today",
      updatedAt: Date.parse("2026-06-12T08:00:00Z") / 1000,
    });
    const thisWeek = note({
      id: "week",
      title: "Week",
      updatedAt: Date.parse("2026-06-09T08:00:00Z") / 1000,
    });
    const lastYear = note({
      id: "old",
      title: "Old",
      updatedAt: Date.parse("2025-03-01T08:00:00Z") / 1000,
    });

    expect(buildDateNoteGroups([today, thisWeek, lastYear], now)).toEqual([
      { id: "today", title: "Today", notes: [today] },
      { id: "this-week", title: "This week", notes: [thisWeek] },
      { id: "2025", title: "2025", notes: [lastYear] },
    ]);
  });
});
