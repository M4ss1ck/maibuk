import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseAdapter } from "@/lib/platform/types";
import { createTestDatabase } from "@/test/support/db-test-context";

// Second defence behind the Tutorial Library switch (ADR 0008): the
// per-entity write paths refuse sample ids while the author's Library is
// active, and write them normally inside the Tutorial Library.

let testDb: DatabaseAdapter;
const { mockGetDatabase } = vi.hoisted(() => ({ mockGetDatabase: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDatabase: mockGetDatabase }));

const books = await import("@/features/books/write");
const chapters = await import("@/features/chapters/write");
const notes = await import("@/features/notes/write");
const canvas = await import("@/features/canvas/write");
const { CURRENT_CANVAS_SCHEMA_VERSION } = await import("@/lib/canvas/defaultDoc");
const {
  activateTutorialDatabase,
  resetLibrarySwitchForTests,
  TutorialIdLeakError,
} = await import("@/features/tutorial/library-switch");

const SAMPLE_BOOK = "tutorial-book-novel";
const SAMPLE_NOTE = "tutorial-note-research";
const SAMPLE_CANVAS = "tutorial-canvas-plot";

function bookSnapshot(id: string) {
  return {
    book: {
      id,
      title: "Sample",
      subtitle: null,
      authorName: "A",
      description: null,
      genre: null,
      language: "en",
      coverImagePath: null,
      coverData: null,
      wordCount: 0,
      targetWordCount: null,
      status: "draft",
      createdAt: 1,
      updatedAt: 1,
      lastOpenedAt: null,
      lastChapterId: null,
    },
    chapters: [],
  };
}

function noteSnapshot(id: string, bookId: string | null = null) {
  return {
    note: {
      id,
      bookId,
      title: "Sample",
      content: "<p>x</p>",
      tags: "[]",
      pinned: false,
      order: 0,
      wordCount: 1,
      collapsedHeadings: "[]",
      createdAt: 1,
      updatedAt: 1,
    },
  };
}

function canvasSnapshot(id: string) {
  return {
    canvas: {
      id,
      title: "Sample",
      pinned: false,
      order: 0,
      doc: { schemaVersion: CURRENT_CANVAS_SCHEMA_VERSION, nodes: [], edges: [], strokes: [] },
      createdAt: 1,
      updatedAt: 1,
    },
  };
}

// Every mutating write path that takes an id it did not generate.
const writes: [string, () => Promise<unknown>][] = [
  ["applyBookSnapshotData", () => books.applyBookSnapshotData(bookSnapshot(SAMPLE_BOOK), "local")],
  ["updateBookRow", () => books.updateBookRow(SAMPLE_BOOK, { title: "x" }, "local")],
  ["updateBookWordCountRow", () => books.updateBookWordCountRow(SAMPLE_BOOK, 3)],
  ["deleteBookRow", () => books.deleteBookRow(SAMPLE_BOOK, "local")],
  ["removeBookRow", () => books.removeBookRow(SAMPLE_BOOK, "remote")],
  [
    "createChapterRow",
    () => chapters.createChapterRow({ bookId: SAMPLE_BOOK, title: "x" }, "local"),
  ],
  ["updateChapterRow", () => chapters.updateChapterRow("tutorial-chapter-one", { title: "x" }, "local")],
  ["deleteChapterRow", () => chapters.deleteChapterRow("tutorial-chapter-one", "local")],
  ["reorderChapterRows", () => chapters.reorderChapterRows(SAMPLE_BOOK, [], "local")],
  ["createNoteRow", () => notes.createNoteRow({ title: "x", bookId: SAMPLE_BOOK }, "local")],
  ["updateNoteRow", () => notes.updateNoteRow({ id: SAMPLE_NOTE, title: "x" }, "local")],
  ["deleteNoteRow", () => notes.deleteNoteRow(SAMPLE_NOTE, "local")],
  ["removeNoteRow", () => notes.removeNoteRow(SAMPLE_NOTE, "remote")],
  ["reorderNoteRows", () => notes.reorderNoteRows([SAMPLE_NOTE], "local")],
  ["saveCollapsedHeadingsRow", () => notes.saveCollapsedHeadingsRow(SAMPLE_NOTE, [])],
  ["applyNoteSnapshotData", () => notes.applyNoteSnapshotData(noteSnapshot(SAMPLE_NOTE), "local")],
  [
    "applyNoteSnapshotData (filed under a sample Book)",
    () => notes.applyNoteSnapshotData(noteSnapshot("real-note", SAMPLE_BOOK), "local"),
  ],
  ["updateCanvasRow", () => canvas.updateCanvasRow(SAMPLE_CANVAS, { title: "x" }, "local")],
  ["deleteCanvasRow", () => canvas.deleteCanvasRow(SAMPLE_CANVAS, "local")],
  ["removeCanvasRow", () => canvas.removeCanvasRow(SAMPLE_CANVAS, "remote")],
  ["reorderCanvasRows", () => canvas.reorderCanvasRows([{ id: SAMPLE_CANVAS, order: 0 }], "local")],
  [
    "applyCanvasSnapshotData",
    () => canvas.applyCanvasSnapshotData(canvasSnapshot(SAMPLE_CANVAS), "local"),
  ],
];

async function rowCount(): Promise<number> {
  const [row] = await testDb.select<{ n: number }[]>(
    `SELECT (SELECT COUNT(*) FROM books) + (SELECT COUNT(*) FROM chapters) +
            (SELECT COUNT(*) FROM notes) + (SELECT COUNT(*) FROM canvases) +
            (SELECT COUNT(*) FROM sync_tombstones) AS n`
  );
  return row.n;
}

beforeEach(async () => {
  testDb = await createTestDatabase();
  mockGetDatabase.mockResolvedValue(testDb);
});

afterEach(() => {
  resetLibrarySwitchForTests();
});

describe("write paths against the author's Library", () => {
  it.each(writes)("%s refuses a tutorial- id and writes nothing", async (_name, write) => {
    await expect(write()).rejects.toBeInstanceOf(TutorialIdLeakError);
    expect(await rowCount()).toBe(0);
  });

  it("still writes the author's own ids", async () => {
    await books.applyBookSnapshotData(bookSnapshot("my-book"), "local");
    await notes.applyNoteSnapshotData(noteSnapshot("my-note", "my-book"), "local");
    expect(await rowCount()).toBe(2);
  });
});

describe("write paths inside the Tutorial Library", () => {
  it("accepts sample ids", async () => {
    activateTutorialDatabase(testDb);
    await books.applyBookSnapshotData(bookSnapshot(SAMPLE_BOOK), "local");
    await notes.applyNoteSnapshotData(noteSnapshot(SAMPLE_NOTE, SAMPLE_BOOK), "local");
    await canvas.applyCanvasSnapshotData(canvasSnapshot(SAMPLE_CANVAS), "local");
    expect(await rowCount()).toBe(3);
  });
});
