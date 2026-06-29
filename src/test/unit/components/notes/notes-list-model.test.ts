import { describe, expect, it } from "vitest";
import type { Book } from "@/features/books/types";
import type { Note } from "@/features/notes";
import {
  buildBookNoteGroups,
  buildDateNoteGroups,
  buildListNoteSections,
  buildTagNoteGroups,
  filterNotes,
  notePlainText,
  sortNotesBy,
} from "@/components/notes/notes-list-model";

type NoteInput = Partial<Note> & { id: string; title: string; bookId?: string | null };

function note(input: NoteInput): Note & { bookId?: string | null } {
  const updatedAt = input.updatedAt ?? 1;
  return {
    content: "",
    language: "en",
    tags: [],
    pinned: false,
    order: 0,
    wordCount: 0,
    collapsedHeadings: [],
    createdAt: 1,
    updatedAt,
    contentUpdatedAt: updatedAt,
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

  it("extracts searchable text from TipTap JSON content", () => {
    const content = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Hidden orchard" }],
        },
      ],
    });

    expect(notePlainText(content)).toBe("Hidden orchard");
    expect(filterNotes([note({ id: "a", title: "Research", content })], "orchard")).toHaveLength(1);
  });

  it("filters notes by exact tag case-insensitively", () => {
    const notes = [
      note({ id: "a", title: "Research", tags: ["Craft", "revision"] }),
      note({ id: "b", title: "Scene", tags: ["draft"] }),
    ];

    expect(filterNotes(notes, { tag: "craft" })).toEqual([notes[0]]);
  });

  it("filters notes by multiple selected tags", () => {
    const notes = [
      note({ id: "a", title: "Research", tags: ["craft", "revision"] }),
      note({ id: "b", title: "Scene", tags: ["craft"] }),
      note({ id: "c", title: "Draft", tags: ["revision"] }),
    ];

    expect(filterNotes(notes, { tags: ["craft", "revision"] })).toEqual([notes[0]]);
  });

  it("filters notes by inclusive updated date range", () => {
    const notes = [
      note({
        id: "a",
        title: "Before",
        updatedAt: new Date(2026, 5, 9, 23, 59, 59).getTime() / 1000,
      }),
      note({
        id: "b",
        title: "Inside",
        updatedAt: new Date(2026, 5, 10, 12).getTime() / 1000,
      }),
      note({
        id: "c",
        title: "After",
        updatedAt: new Date(2026, 5, 12).getTime() / 1000,
      }),
    ];

    expect(filterNotes(notes, { dateFrom: "2026-06-10", dateTo: "2026-06-11" })).toEqual([
      notes[1],
    ]);
  });

  it("combines query, tag, and date filters", () => {
    const notes = [
      note({
        id: "a",
        title: "Moon research",
        tags: ["craft"],
        updatedAt: Date.parse("2026-06-11T12:00:00Z") / 1000,
      }),
      note({
        id: "b",
        title: "Moon scene",
        tags: ["draft"],
        updatedAt: Date.parse("2026-06-11T12:00:00Z") / 1000,
      }),
      note({
        id: "c",
        title: "Moon archive",
        tags: ["craft"],
        updatedAt: Date.parse("2026-05-01T12:00:00Z") / 1000,
      }),
    ];

    expect(
      filterNotes(notes, {
        query: "moon",
        tag: "craft",
        dateFrom: "2026-06-01",
      })
    ).toEqual([notes[0]]);
  });

  it("splits list mode into pinned and all-notes sections", () => {
    const pinned = note({ id: "p", title: "Pinned", pinned: true });
    const regular = note({ id: "r", title: "Regular" });

    expect(buildListNoteSections([pinned, regular], "")).toEqual([
      { id: "pinned", notes: [pinned] },
      { id: "all", notes: [regular] },
    ]);
  });

  it("sorts notes by last modified date and by title in both directions", () => {
    const older = note({ id: "old", title: "Beta", updatedAt: 100 });
    const newer = note({ id: "new", title: "Alpha", updatedAt: 200 });

    expect(sortNotesBy([older, newer], "date-desc")).toEqual([newer, older]);
    expect(sortNotesBy([newer, older], "date-asc")).toEqual([older, newer]);
    expect(sortNotesBy([older, newer], "title-asc")).toEqual([newer, older]);
    expect(sortNotesBy([newer, older], "title-desc")).toEqual([older, newer]);
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

  it("groups by contentUpdatedAt, ignoring a later updatedAt from a non-content change", () => {
    const now = new Date("2026-06-12T12:00:00Z");
    // Content last edited last year, but re-tagged today (updatedAt bumped).
    const retagged = note({
      id: "retagged",
      title: "Retagged",
      contentUpdatedAt: Date.parse("2025-03-01T08:00:00Z") / 1000,
      updatedAt: Date.parse("2026-06-12T08:00:00Z") / 1000,
    });

    expect(buildDateNoteGroups([retagged], now)).toEqual([
      { id: "2025", title: "2025", notes: [retagged] },
    ]);
  });

  it("filters by contentUpdatedAt date range, ignoring updatedAt", () => {
    const retagged = note({
      id: "retagged",
      title: "Retagged",
      contentUpdatedAt: new Date(2026, 5, 10, 12).getTime() / 1000,
      updatedAt: new Date(2026, 5, 20, 12).getTime() / 1000,
    });

    expect(filterNotes([retagged], { dateFrom: "2026-06-10", dateTo: "2026-06-11" })).toEqual([
      retagged,
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
