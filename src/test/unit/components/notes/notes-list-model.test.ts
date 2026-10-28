import { describe, expect, it } from "vitest";
import type { Book } from "@/features/books/types";
import type { Note } from "@/features/notes";
import {
  buildBookNoteGroups,
  buildDateNoteGroups,
  buildListNoteSections,
  buildTagNoteGroups,
  countFilterCriteria,
  filterNotes,
  normalizeNotesSidebarSort,
  notePlainText,
  notesSortOptions,
  placeNote,
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
    contentUpdatedAt: new Date("2026-01-01T00:00:00Z"),
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

  it("hides notes carrying any excluded tag", () => {
    const notes = [
      note({ id: "a", title: "Research", tags: ["craft", "archive"] }),
      note({ id: "b", title: "Scene", tags: ["craft"] }),
      note({ id: "c", title: "Draft", tags: [] }),
    ];

    expect(filterNotes(notes, { excludeTags: ["archive"] })).toEqual([notes[1], notes[2]]);
  });

  it("matches excluded tags case-insensitively", () => {
    const notes = [note({ id: "a", title: "Research", tags: ["Archive"] })];

    expect(filterNotes(notes, { excludeTags: ["archive"] })).toEqual([]);
  });

  it("treats an empty exclude list as no filter", () => {
    const notes = [note({ id: "a", title: "Research", tags: ["craft"] })];

    expect(filterNotes(notes, { excludeTags: [] })).toEqual(notes);
  });

  it("excludes tags even when the note also matches the included tags", () => {
    const notes = [
      note({ id: "a", title: "Research", tags: ["craft", "archive"] }),
      note({ id: "b", title: "Scene", tags: ["craft"] }),
    ];

    expect(filterNotes(notes, { tags: ["craft"], excludeTags: ["archive"] })).toEqual([notes[1]]);
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

  it("sorts by Custom Order under Custom", () => {
    const second = note({ id: "second", title: "Alpha", order: 2 });
    const first = note({ id: "first", title: "Zulu", order: 1 });

    expect(sortNotesBy([second, first], "custom")).toEqual([first, second]);
  });

  it("breaks title and date ties by Custom Order", () => {
    const later = note({ id: "later", title: "Same", order: 5, updatedAt: 100 });
    const earlier = note({ id: "earlier", title: "same", order: 1, updatedAt: 100 });

    for (const sort of ["title-asc", "title-desc", "date-asc", "date-desc"] as const) {
      expect(
        sortNotesBy([later, earlier], sort).map((n) => n.id),
        sort
      ).toEqual(["earlier", "later"]);
    }
  });

  it("puts untitled Notes first under both title Sorts", () => {
    const alpha = note({ id: "alpha", title: "Alpha" });
    const untitled = note({ id: "untitled", title: "  " });
    const zulu = note({ id: "zulu", title: "Zulu" });

    expect(sortNotesBy([alpha, zulu, untitled], "title-asc").map((n) => n.id)).toEqual([
      "untitled",
      "alpha",
      "zulu",
    ]);
    expect(sortNotesBy([alpha, zulu, untitled], "title-desc").map((n) => n.id)).toEqual([
      "untitled",
      "zulu",
      "alpha",
    ]);
  });

  it("compares titles the way people read them: numbers in order, accents and case ignored", () => {
    const ten = note({ id: "ten", title: "Note 10", order: 0 });
    const two = note({ id: "two", title: "Note 2", order: 1 });
    const accented = note({ id: "accented", title: "Éclair", order: 2 });
    const plain = note({ id: "plain", title: "eclair", order: 3 });

    expect(sortNotesBy([ten, plain, two, accented], "title-asc").map((n) => n.id)).toEqual([
      "accented",
      "plain",
      "two",
      "ten",
    ]);
  });

  it("sorts each list section separately, keeping Pinned Notes apart", () => {
    const pinnedZ = note({ id: "pz", title: "Zed", pinned: true, order: 0 });
    const pinnedA = note({ id: "pa", title: "Ant", pinned: true, order: 1 });
    const restB = note({ id: "rb", title: "Bee", order: 0 });
    const restA = note({ id: "ra", title: "Aardvark", order: 1 });

    const ids = (sort: Parameters<typeof buildListNoteSections>[2]) =>
      buildListNoteSections([pinnedZ, pinnedA, restB, restA], "", sort).map((section) => [
        section.id,
        section.notes.map((n) => n.id),
      ]);

    expect(ids("title-asc")).toEqual([
      ["pinned", ["pa", "pz"]],
      ["all", ["ra", "rb"]],
    ]);
    expect(ids("custom")).toEqual([
      ["pinned", ["pz", "pa"]],
      ["all", ["rb", "ra"]],
    ]);
  });

  it("sorts Notes inside each book and tag group and keeps the groups' order", () => {
    const bookA = book({ id: "book-a", title: "Book A" });
    const bookB = book({ id: "book-b", title: "Book B" });
    const b2 = note({ id: "b2", title: "Bravo", bookId: "book-a", order: 0, tags: ["x"] });
    const b1 = note({ id: "b1", title: "Alpha", bookId: "book-a", order: 1, tags: ["x"] });
    const loose = note({ id: "loose", title: "Loose", order: 2, tags: ["a"] });

    expect(
      buildBookNoteGroups([b2, b1, loose], [bookB, bookA], "title-asc").map((group) => [
        group.id,
        group.notes.map((n) => n.id),
      ])
    ).toEqual([
      ["book-b", []],
      ["book-a", ["b1", "b2"]],
      ["unfiled", ["loose"]],
    ]);
    expect(
      buildTagNoteGroups([b2, b1, loose], "title-desc").map((group) => [
        group.id,
        group.notes.map((n) => n.id),
      ])
    ).toEqual([
      ["a", ["loose"]],
      ["x", ["b2", "b1"]],
    ]);
  });

  it("shows Custom Order inside each date group under Custom", () => {
    const now = new Date("2026-06-12T12:00:00Z");
    const at = (iso: string) => Date.parse(iso) / 1000;
    const morning = note({
      id: "morning",
      title: "M",
      order: 0,
      updatedAt: at("2026-06-12T07:00:00Z"),
    });
    const noon = note({ id: "noon", title: "N", order: 1, updatedAt: at("2026-06-12T11:00:00Z") });

    expect(buildDateNoteGroups([morning, noon], now, "custom")[0].notes.map((n) => n.id)).toEqual([
      "morning",
      "noon",
    ]);
    expect(
      buildDateNoteGroups([morning, noon], now, "date-desc")[0].notes.map((n) => n.id)
    ).toEqual(["noon", "morning"]);
  });

  it("builds the Sort options with an icon each, Custom only when asked for", () => {
    const t = (key: string) => key;

    expect(notesSortOptions(t, { custom: true }).map((option) => option.value)).toEqual([
      "custom",
      "title-asc",
      "title-desc",
      "date-desc",
      "date-asc",
    ]);
    expect(notesSortOptions(t, { custom: false }).map((option) => option.value)).toEqual([
      "title-asc",
      "title-desc",
      "date-desc",
      "date-asc",
    ]);
    for (const option of notesSortOptions(t, { custom: true })) {
      expect(option.label).toMatch(/^notes\.sort/);
      expect(option.icon).toBeTruthy();
    }
  });

  it("normalizes an unknown persisted sidebar Sort to Custom", () => {
    expect(normalizeNotesSidebarSort("title-asc")).toBe("title-asc");
    expect(normalizeNotesSidebarSort("custom")).toBe("custom");
    expect(normalizeNotesSidebarSort("by-size")).toBe("custom");
    expect(normalizeNotesSidebarSort(undefined)).toBe("custom");
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

  it("lists each date group's Notes most recently edited first under newest first, whatever their Custom Order", () => {
    const now = new Date("2026-06-12T12:00:00Z");
    const at = (iso: string) => Date.parse(iso) / 1000;
    // The store hands Notes over pinned first, then in manual order.
    const pinnedMorning = note({
      id: "pinned",
      title: "Alpha",
      pinned: true,
      contentUpdatedAt: at("2026-06-12T07:00:00Z"),
    });
    const todayNine = note({
      id: "nine",
      title: "Bravo",
      contentUpdatedAt: at("2026-06-12T09:00:00Z"),
    });
    const todayNoon = note({
      id: "noon",
      title: "Charlie",
      contentUpdatedAt: at("2026-06-12T11:00:00Z"),
    });
    const march = note({
      id: "march",
      title: "Delta",
      contentUpdatedAt: at("2025-03-01T08:00:00Z"),
    });
    const october = note({
      id: "october",
      title: "Echo",
      contentUpdatedAt: at("2025-10-01T08:00:00Z"),
    });

    const groups = buildDateNoteGroups(
      [pinnedMorning, todayNine, todayNoon, march, october],
      now,
      "date-desc"
    );

    expect(groups.map((group) => [group.id, group.notes.map((n) => n.id)])).toEqual([
      ["today", ["noon", "nine", "pinned"]],
      ["2025", ["october", "march"]],
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

describe("countFilterCriteria()", () => {
  it("counts nothing when the Note Filter is empty", () => {
    expect(countFilterCriteria({ tags: [], excludeTags: [], dateFrom: "", dateTo: "" })).toBe(0);
  });

  it("counts each Tag, included or excluded, as one", () => {
    expect(
      countFilterCriteria({ tags: ["craft"], excludeTags: [], dateFrom: "", dateTo: "" })
    ).toBe(1);
    expect(
      countFilterCriteria({
        tags: ["craft", "draft"],
        excludeTags: ["archive"],
        dateFrom: "",
        dateTo: "",
      })
    ).toBe(3);
  });

  it("counts each date as one", () => {
    expect(
      countFilterCriteria({ tags: [], excludeTags: [], dateFrom: "2026-06-01", dateTo: "" })
    ).toBe(1);
    expect(
      countFilterCriteria({
        tags: [],
        excludeTags: [],
        dateFrom: "2026-06-01",
        dateTo: "2026-06-30",
      })
    ).toBe(2);
  });
});

describe("placeNote()", () => {
  const a = note({ id: "a", title: "A", pinned: true });
  const b = note({ id: "b", title: "B", pinned: true });
  const c = note({ id: "c", title: "C" });
  const d = note({ id: "d", title: "D" });
  const sections = () => buildListNoteSections([a, b, c, d], "");
  const ids = (result: ReturnType<typeof placeNote>) =>
    result?.map((section) => [section.id, section.notes.map((n) => n.id)]);

  it("moves a Note beside another in its own section", () => {
    expect(ids(placeNote(sections(), d, { noteId: "c", placement: "before" }))).toEqual([
      ["pinned", ["a", "b"]],
      ["all", ["d", "c"]],
    ]);
  });

  it("moves a Note across sections, which is what pins or unpins it", () => {
    expect(ids(placeNote(sections(), c, { noteId: "a", placement: "after" }))).toEqual([
      ["pinned", ["a", "c", "b"]],
      ["all", ["d"]],
    ]);
    expect(ids(placeNote(sections(), a, { noteId: "d", placement: "after" }))).toEqual([
      ["pinned", ["b"]],
      ["all", ["c", "d", "a"]],
    ]);
  });

  it("places a Note at a section's start or end, including an empty section", () => {
    expect(ids(placeNote(sections(), b, { sectionId: "all", at: "start" }))).toEqual([
      ["pinned", ["a"]],
      ["all", ["b", "c", "d"]],
    ]);
    const unpinned = buildListNoteSections([c, d], "");
    expect(ids(placeNote(unpinned, d, { sectionId: "pinned", at: "end" }))).toEqual([
      ["pinned", ["d"]],
      ["all", ["c"]],
    ]);
  });

  it("returns null when the target is missing or is the Note itself", () => {
    expect(placeNote(sections(), c, { noteId: "c", placement: "before" })).toBeNull();
    expect(placeNote(sections(), c, { noteId: "zz", placement: "after" })).toBeNull();
  });

  it("leaves the input sections untouched", () => {
    const input = sections();
    placeNote(input, d, { noteId: "a", placement: "before" });
    expect(ids(input)).toEqual([
      ["pinned", ["a", "b"]],
      ["all", ["c", "d"]],
    ]);
  });
});
