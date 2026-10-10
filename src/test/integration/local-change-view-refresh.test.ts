import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseAdapter } from "@/lib/platform/types";
import { createTestDatabase } from "@/test/support/db-test-context";

// A local Change written outside the open view's store refreshes that view
// (ADR 0023): a Plugin, an import, or a Restore bypasses the stores, so the
// Change Feed is what reaches the mounted views. A store's own save already
// updated its view and carries no refresh.

let testDb: DatabaseAdapter;

const { mockGetDatabase, mockReindex } = vi.hoisted(() => ({
  mockGetDatabase: vi.fn(),
  mockReindex: vi.fn(),
}));

vi.mock("../../lib/db", () => ({
  getDatabase: mockGetDatabase,
}));

vi.mock("../../features/links/link-index", () => ({
  reindexSource: mockReindex,
}));

const { useBookStore } = await import("@/features/books/store");
const { useChapterStore } = await import("@/features/chapters/store");
const { useNoteStore } = await import("@/features/notes/store");
const { useCanvasStore } = await import("@/features/canvas/store");
const { updateChapterRow } = await import("@/features/chapters/write");
const { updateNoteRow } = await import("@/features/notes/write");
const { updateCanvasRow } = await import("@/features/canvas/write");
const { installViewRefresh, resetViewRefreshForTests } = await import(
  "@/features/sync/view-refresh"
);
const { resetChangeFeedForTests } = await import("@/features/sync/change-feed");

async function seedBook(id: string): Promise<void> {
  await testDb.execute(
    `INSERT INTO books (id, title, author_name, language, created_at, updated_at, content_updated_at)
     VALUES (?, ?, ?, 'en', 1000, 1000, 1000)`,
    [id, `Book ${id}`, "Author"]
  );
}

async function seedChapter(id: string, bookId: string, content = "<p>Stored</p>"): Promise<void> {
  await testDb.execute(
    `INSERT INTO chapters (id, book_id, title, content, "order", chapter_type, word_count, status, is_included_in_export, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, 'chapter', 1, 'draft', 1, 1000, 1000)`,
    [id, bookId, `Title ${id}`, content]
  );
}

async function seedNote(id: string, content = "<p>Stored</p>"): Promise<void> {
  await testDb.execute(
    `INSERT INTO notes (id, title, content, language, tags, pinned, "order", word_count, collapsed_headings, created_at, updated_at, content_updated_at)
     VALUES (?, ?, ?, 'en', '[]', 0, 0, 1, '[]', 1000, 1000, 1000)`,
    [id, `Note ${id}`, content]
  );
}

async function seedCanvas(id: string, title = "Map"): Promise<void> {
  await testDb.execute(
    `INSERT INTO canvases (id, title, doc, pinned, "order", created_at, updated_at, content_updated_at)
     VALUES (?, ?, '{"schemaVersion":3,"nodes":[],"edges":[],"strokes":[]}', 0, 0, 1000, 1000, 1000)`,
    [id, title]
  );
}

describe("view refresh on local Changes", () => {
  beforeEach(async () => {
    testDb = await createTestDatabase();
    mockGetDatabase.mockReset().mockResolvedValue(testDb);
    mockReindex.mockReset().mockResolvedValue(undefined);
    resetChangeFeedForTests();
    resetViewRefreshForTests();
    installViewRefresh();
    useBookStore.setState({ books: [], currentBook: null, isLoading: false, error: null });
    useChapterStore.setState({
      chapters: [],
      currentChapter: null,
      currentBookId: null,
      isLoading: false,
      error: null,
    });
    useNoteStore.setState({ notes: [], currentNote: null, isLoading: false, error: null });
    useCanvasStore.setState({ canvases: [], galleryLoaded: false });
  });

  afterEach(() => {
    resetViewRefreshForTests();
    resetChangeFeedForTests();
  });

  it("a local write outside the chapter store reaches the open chapter", async () => {
    await seedBook("book-1");
    await seedChapter("ch-1", "book-1");
    await useChapterStore.getState().loadChapters("book-1");
    useChapterStore
      .getState()
      .setCurrentChapter(useChapterStore.getState().chapters[0] ?? null);

    await updateChapterRow("ch-1", { content: "<p>Written outside</p>" }, "local");

    expect(useChapterStore.getState().currentChapter?.content).toBe("<p>Written outside</p>");
    expect(useChapterStore.getState().chapters[0]?.content).toBe("<p>Written outside</p>");
  });

  it("a local write outside the note store reaches the open note", async () => {
    await seedNote("note-1");
    await useNoteStore.getState().loadNotes();
    await useNoteStore.getState().loadNote("note-1");

    await updateNoteRow({ id: "note-1", content: "<p>Written outside</p>" }, "local");

    expect(useNoteStore.getState().currentNote?.content).toBe("<p>Written outside</p>");
  });

  it("a local write outside the canvas store reaches the gallery", async () => {
    await seedCanvas("canvas-1");
    await useCanvasStore.getState().loadCanvases();

    await updateCanvasRow("canvas-1", { title: "Renamed outside" }, "local");

    expect(useCanvasStore.getState().canvases[0]?.title).toBe("Renamed outside");
  });

  it("a local book write outside the book store reaches the gallery", async () => {
    await seedBook("book-1");
    await useBookStore.getState().loadBooks();

    const { updateBookRow } = await import("@/features/books/write");
    await updateBookRow("book-1", { title: "Renamed outside" }, "local");

    expect(useBookStore.getState().books[0]?.title).toBe("Renamed outside");
  });

  it("a local content write outside the canvas store reaches the open canvas", async () => {
    await seedCanvas("canvas-1");
    await useCanvasStore.getState().loadCanvas("canvas-1");
    const { createDefaultCanvasDoc } = await import("@/features/canvas/types");
    const { updateCanvasDocRow } = await import("@/features/canvas/write");
    const doc = createDefaultCanvasDoc();
    doc.nodes.push({
      id: "outside",
      kind: "text",
      html: "<p>Outside</p>",
      position: { x: 0, y: 0 },
    });

    await updateCanvasDocRow("canvas-1", doc, "local");

    expect(useCanvasStore.getState().doc.nodes.map((node) => node.id)).toContain("outside");
  });

  it("a store's own canvas save does not restart its open Edit Session", async () => {
    await seedCanvas("canvas-1");
    await useCanvasStore.getState().loadCanvas("canvas-1");
    const refreshOpen = vi.spyOn(useCanvasStore.getState(), "refreshOpenCanvas");
    const refreshCanvases = vi.spyOn(useCanvasStore.getState(), "refreshCanvases");

    await useCanvasStore.getState().saveDoc(useCanvasStore.getState().doc);

    expect(refreshOpen).not.toHaveBeenCalled();
    expect(refreshCanvases).not.toHaveBeenCalled();
  });

  it("a store's own save does not re-read the views it already updated", async () => {
    await seedBook("book-1");
    await seedChapter("ch-1", "book-1");
    await useChapterStore.getState().loadChapters("book-1");
    const refreshChapters = vi.spyOn(useChapterStore.getState(), "refreshChapters");
    const refreshBooks = vi.spyOn(useBookStore.getState(), "refreshBooks");

    await useChapterStore.getState().updateChapter("ch-1", { content: "<p>Typed</p>" });

    expect(refreshChapters).not.toHaveBeenCalled();
    expect(refreshBooks).not.toHaveBeenCalled();
    expect(useChapterStore.getState().chapters[0]?.content).toBe("<p>Typed</p>");
  });

  it("ignores sample Changes while the Tutorial Library is active", async () => {
    await seedBook("book-1");
    await useBookStore.getState().loadBooks();
    const refreshBooks = vi.spyOn(useBookStore.getState(), "refreshBooks");
    const librarySwitch = await import("@/features/tutorial/library-switch");
    const { emitChange } = await import("@/features/sync/change-feed");
    librarySwitch.activateTutorialDatabase({} as never);

    try {
      await emitChange({
        entity: "book",
        id: "tutorial-book-1",
        origin: "local",
        kind: "content",
      });
    } finally {
      librarySwitch.resetLibrarySwitchForTests();
    }

    expect(refreshBooks).not.toHaveBeenCalled();
  });

  it("keeps the open chapter selected when a local write removes another one", async () => {
    await seedBook("book-1");
    await seedChapter("ch-1", "book-1");
    await seedChapter("ch-2", "book-1");
    await useChapterStore.getState().loadChapters("book-1");
    useChapterStore
      .getState()
      .setCurrentChapter(useChapterStore.getState().chapters.find((c) => c.id === "ch-1") ?? null);

    const { deleteChapterRow } = await import("@/features/chapters/write");
    await deleteChapterRow("ch-2", "local");

    expect(useChapterStore.getState().currentChapter?.id).toBe("ch-1");
    expect(useChapterStore.getState().chapters.map((c) => c.id)).toEqual(["ch-1"]);
  });
});
