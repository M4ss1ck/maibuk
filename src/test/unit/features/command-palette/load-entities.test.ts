import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Canvas } from "@/features/canvas/types";
import type { Note } from "@/features/notes/types";
import type { Book } from "@/features/books/types";
import type { DatabaseAdapter } from "@/lib/platform/types";
import { createTestDatabase } from "@/test/support/db-test-context";
import { buildBook } from "@/test/support/fixtures";

let testDb: DatabaseAdapter;
/** The palette's own SELECTs since the last read, in the order it issued them. */
let selects: string[] = [];
let rawSelect: <T>(sql: string, params?: unknown[]) => Promise<T>;
/** What each list view holds before the palette is ever opened. */
let viewBooks: Book[];
let viewNotes: Note[];
let viewCanvases: Canvas[];

const { mockGetDatabase } = vi.hoisted(() => ({ mockGetDatabase: vi.fn() }));

vi.mock("@/lib/db", () => ({ getDatabase: mockGetDatabase }));

const { loadPaletteEntities } = await import("@/features/command-palette/load-entities");
const { useBookStore } = await import("@/features/books/store");
const { useNoteStore } = await import("@/features/notes/store");
const { useCanvasStore } = await import("@/features/canvas/store");

interface BookRow {
  id: string;
  title: string;
  lastOpenedAt?: number | null;
  updatedAt?: number;
  coverData?: string;
}

interface ChapterRow {
  id: string;
  bookId: string;
  title: string;
  order: number;
}

interface NoteRow {
  id: string;
  title: string;
  bookId?: string | null;
  pinned?: boolean;
  order: number;
}

interface CanvasRow {
  id: string;
  title: string;
  pinned?: boolean;
  order?: number;
  updatedAt?: number;
}

const EMPTY_DOC = JSON.stringify({
  nodes: [],
  edges: [],
  strokes: [],
  viewport: { x: 0, y: 0, zoom: 1 },
});

async function insertBook(row: BookRow): Promise<void> {
  await testDb.execute(
    `INSERT INTO books
       (id, title, author_name, cover_data, created_at, updated_at, last_opened_at)
     VALUES (?, ?, 'Author', ?, 1, ?, ?)`,
    [row.id, row.title, row.coverData ?? null, row.updatedAt ?? 1, row.lastOpenedAt ?? null]
  );
}

async function insertChapter(row: ChapterRow): Promise<void> {
  await testDb.execute(
    `INSERT INTO chapters (id, book_id, title, content, "order", created_at, updated_at)
     VALUES (?, ?, ?, '<p>Chapter body</p>', ?, 1, 1)`,
    [row.id, row.bookId, row.title, row.order]
  );
}

async function insertNote(row: NoteRow): Promise<void> {
  await testDb.execute(
    `INSERT INTO notes
       (id, book_id, title, content, pinned, "order", created_at, updated_at)
     VALUES (?, ?, ?, '<p>Note body</p>', ?, ?, 1, 1)`,
    [row.id, row.bookId ?? null, row.title, row.pinned ? 1 : 0, row.order]
  );
}

async function insertCanvas(row: CanvasRow): Promise<void> {
  const updatedAt = row.updatedAt ?? 1;
  await testDb.execute(
    `INSERT INTO canvases
       (id, title, doc, pinned, "order", created_at, updated_at, content_updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    [row.id, row.title, EMPTY_DOC, row.pinned ? 1 : 0, row.order ?? 0, updatedAt, updatedAt]
  );
}

/** One palette read, with the SELECTs it issued on their own. */
async function readPalette() {
  selects = [];
  const entities = await loadPaletteEntities();
  return { ...entities, issued: normalizedSelects() };
}

function normalizedSelects(): string[] {
  return selects.map((sql) => sql.replace(/\s+/g, " ").trim());
}

/** A Book, a Chapter, a Book Note, an Unfiled Note, and a Canvas. */
async function seedOneOfEach(): Promise<void> {
  await insertBook({ id: "b-alpha", title: "The Sea" });
  await insertChapter({ id: "c-arrival", bookId: "b-alpha", title: "Arrival", order: 1 });
  await insertNote({ id: "n-in-book", title: "A thought", bookId: "b-alpha", order: 1 });
  await insertNote({ id: "n-unfiled", title: "Loose", bookId: null, order: 2 });
  await insertCanvas({ id: "v-map", title: "Map" });
}

describe("loadPaletteEntities()", () => {
  beforeEach(async () => {
    const base = await createTestDatabase();
    rawSelect = base.select.bind(base);
    const run = rawSelect;
    base.select = async <T>(sql: string, params?: unknown[]): Promise<T> => {
      selects.push(sql);
      return run<T>(sql, params);
    };
    testDb = base;

    selects = [];
    mockGetDatabase.mockReset();
    mockGetDatabase.mockResolvedValue(testDb);

    viewBooks = [buildBook({ id: "b-view", title: "In the view" })];
    viewNotes = [{ id: "n-view", title: "In the view" } as unknown as Note];
    viewCanvases = [{ id: "v-view", title: "In the view" } as unknown as Canvas];

    useBookStore.setState({ books: viewBooks });
    useNoteStore.setState({ notes: viewNotes });
    useCanvasStore.setState({ canvases: viewCanvases });
  });

  it("returns every name with its Book association, and nothing else", async () => {
    await seedOneOfEach();

    const { books, chapters, notes, canvases } = await readPalette();

    expect(books).toEqual([{ id: "b-alpha", title: "The Sea" }]);
    expect(chapters).toEqual([{ id: "c-arrival", bookId: "b-alpha", title: "Arrival" }]);
    expect(canvases).toEqual([{ id: "v-map", title: "Map" }]);
    expect(notes).toContainEqual({ id: "n-in-book", title: "A thought", bookId: "b-alpha" });
    expect(notes).toContainEqual({ id: "n-unfiled", title: "Loose", bookId: null });
  });

  it("orders Books by last opened, then by last updated", async () => {
    await insertBook({ id: "b-old", title: "Old", lastOpenedAt: 100, updatedAt: 1 });
    await insertBook({ id: "b-recent", title: "Recent", lastOpenedAt: 200, updatedAt: 1 });
    await insertBook({ id: "b-never", title: "Never opened", lastOpenedAt: null, updatedAt: 900 });

    const { books } = await readPalette();

    expect(books.map((book) => book.id)).toEqual(["b-recent", "b-old", "b-never"]);
  });

  it("lists pinned Notes first, then keeps each Note's order", async () => {
    await insertNote({ id: "n-later", title: "Later", order: 2 });
    await insertNote({ id: "n-earlier", title: "Earlier", order: 1 });
    await insertNote({ id: "n-pinned", title: "Pinned", pinned: true, order: 9 });

    const { notes } = await readPalette();

    expect(notes.map((note) => note.id)).toEqual(["n-pinned", "n-earlier", "n-later"]);
  });

  it("lists pinned Canvases first, then each Canvas's order, then the newest", async () => {
    await insertCanvas({ id: "v-older", title: "Older", order: 1, updatedAt: 10 });
    await insertCanvas({ id: "v-newer", title: "Newer", order: 1, updatedAt: 20 });
    await insertCanvas({ id: "v-pinned", title: "Pinned", pinned: true, order: 9 });

    const { canvases } = await readPalette();

    expect(canvases.map((canvas) => canvas.id)).toEqual(["v-pinned", "v-newer", "v-older"]);
  });

  it("lists Chapters grouped by Book and in each Book's order", async () => {
    await insertBook({ id: "b-alpha", title: "The Sea" });
    await insertBook({ id: "b-beta", title: "The Mountain" });
    await insertChapter({ id: "c-a2", bookId: "b-alpha", title: "Second", order: 2 });
    await insertChapter({ id: "c-a1", bookId: "b-alpha", title: "First", order: 1 });
    await insertChapter({ id: "c-b1", bookId: "b-beta", title: "Climb", order: 1 });

    const { chapters } = await readPalette();

    expect(chapters).toEqual([
      { id: "c-a1", bookId: "b-alpha", title: "First" },
      { id: "c-a2", bookId: "b-alpha", title: "Second" },
      { id: "c-b1", bookId: "b-beta", title: "Climb" },
    ]);
  });

  it("reads title columns only, leaving content, doc, and cover_data behind", async () => {
    await seedOneOfEach();
    await insertBook({
      id: "b-covered",
      title: "Covered",
      coverData: "data:image/png;base64,AAAA",
    });

    const { issued } = await readPalette();

    expect(issued).toContain(
      "SELECT id, title FROM books ORDER BY last_opened_at DESC, updated_at DESC"
    );
    expect(issued).toContain(
      'SELECT id, title, book_id FROM notes ORDER BY pinned DESC, "order" ASC'
    );
    expect(issued).toContain(
      'SELECT id, title FROM canvases ORDER BY pinned DESC, "order" ASC, updated_at DESC'
    );
    for (const sql of issued) {
      expect(sql.startsWith("SELECT ")).toBe(true);
      expect(sql).not.toMatch(/\bcontent\b/i);
      expect(sql).not.toMatch(/\bdoc\b/i);
      expect(sql).not.toContain("cover_data");
    }
  });

  it("publishes nothing: the Book, Note, and Canvas views keep their own rows", async () => {
    await seedOneOfEach();

    const published: string[] = [];
    const stop = [
      useBookStore.subscribe(() => published.push("books")),
      useNoteStore.subscribe(() => published.push("notes")),
      useCanvasStore.subscribe(() => published.push("canvases")),
    ];

    try {
      await loadPaletteEntities();
    } finally {
      for (const off of stop) off();
    }

    expect(published).toEqual([]);
    expect(useBookStore.getState().books).toBe(viewBooks);
    expect(useNoteStore.getState().notes).toBe(viewNotes);
    expect(useCanvasStore.getState().canvases).toBe(viewCanvases);
  });

  it("reads the Library again on every open, so changed and deleted names show", async () => {
    await insertBook({ id: "b-alpha", title: "The Sea" });
    await insertNote({ id: "n-idea", title: "An idea", order: 1 });
    await insertCanvas({ id: "v-map", title: "Map" });
    await insertChapter({ id: "c-arrival", bookId: "b-alpha", title: "Arrival", order: 1 });

    const first = await readPalette();
    expect(first.books).toEqual([{ id: "b-alpha", title: "The Sea" }]);
    expect(first.notes).toHaveLength(1);
    expect(first.canvases).toHaveLength(1);
    expect(first.chapters).toHaveLength(1);

    await testDb.execute(`UPDATE books SET title = 'The Renamed Sea' WHERE id = ?`, ["b-alpha"]);
    await testDb.execute(`UPDATE notes SET title = 'A sharper idea' WHERE id = ?`, ["n-idea"]);
    await testDb.execute(`UPDATE canvases SET title = 'The map' WHERE id = ?`, ["v-map"]);
    await testDb.execute(`UPDATE chapters SET title = 'The arrival' WHERE id = ?`, ["c-arrival"]);
    await testDb.execute(`DELETE FROM notes WHERE id = ?`, ["n-idea"]);
    await testDb.execute(`DELETE FROM canvases WHERE id = ?`, ["v-map"]);
    await testDb.execute(`DELETE FROM chapters WHERE id = ?`, ["c-arrival"]);

    const second = await readPalette();

    expect(second.books).toEqual([{ id: "b-alpha", title: "The Renamed Sea" }]);
    expect(second.notes).toEqual([]);
    expect(second.canvases).toEqual([]);
    expect(second.chapters).toEqual([]);
    expect(second.notes).not.toBe(first.notes);
  });

  it("rejects when the Library cannot be opened", async () => {
    mockGetDatabase.mockRejectedValueOnce(new Error("Library is closed"));

    await expect(loadPaletteEntities()).rejects.toThrow("Library is closed");
  });

  it("rejects when one of the title queries fails", async () => {
    const run = rawSelect;
    testDb.select = async <T>(sql: string, params?: unknown[]): Promise<T> => {
      if (sql.includes("FROM notes")) throw new Error("notes table is locked");
      return run<T>(sql, params);
    };

    await expect(loadPaletteEntities()).rejects.toThrow("notes table is locked");
  });
});
