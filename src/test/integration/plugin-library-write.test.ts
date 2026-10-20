import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Change } from "@/features/sync/change-feed";
import type { PluginApiInput, PluginManifest, PluginPermissionId } from "@/features/plugins/types";
import type { DatabaseAdapter } from "@/lib/platform/types";
import { createTestDatabase } from "@/test/support/db-test-context";

// Data-safety integration tests for the Plugin Library writes (#452, part 3),
// driven through the real handler entry a Plugin calls. Each write is a local
// write from outside the open view's store (ADR 0026): it Flushes the open
// editors first, refuses when a save fails, emits on the Change Feed, and the
// open view refreshes on the local Change (#430).
//
// The open editor is modelled the way `useEditSession` registers it: an Edit
// Session whose Flush is a pending-edits flush, saving through the entity's own
// store. That is the seam #430 fixed, so the "typing done while the write runs"
// outcome is asserted against the real Edit Session, not a stub.

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

const { createPluginHandlers } = await import("@/features/plugins/handlers");
const { PLUGIN_MANIFEST } = await import("@/test/support/plugin-fixtures");
const { createEditSession } = await import("@/features/edit-session");
const { useBookStore } = await import("@/features/books/store");
const { useChapterStore } = await import("@/features/chapters/store");
const { useNoteStore } = await import("@/features/notes/store");
const { flushPendingEdits, registerPendingEditsFlush, resetPendingEditsForTests } = await import(
  "@/features/sync/pending-edits"
);
const { installViewRefresh, resetViewRefreshForTests } = await import(
  "@/features/sync/view-refresh"
);
const { isEntityChange, onChange, resetChangeFeedForTests } = await import(
  "@/features/sync/change-feed"
);
const { createPluginBroker } = await import("@/features/plugins/broker");
const { createPluginClient } = await import("@/plugin-sdk");

const handlers = createPluginHandlers(PLUGIN_MANIFEST);
const context = { pluginId: "tracer" };

/** The manifest a Plugin writing to the Library declares, so the broker can refuse it. */
const WRITE_MANIFEST: PluginManifest = {
  ...PLUGIN_MANIFEST,
  permissions: { required: ["library:read", "library:write"], optional: [] },
};

/**
 * The real broker over the real handlers and the in-memory Library, driven by
 * the SDK client the way a Plugin calls: the only way to prove the refusals
 * the row declares (its Plugin Permission, Library availability) happen before
 * the handler runs.
 */
function connectWritePlugin(options: {
  granted: readonly PluginPermissionId[];
  libraryAvailable?: boolean;
}) {
  const channel = new MessageChannel();
  createPluginBroker({
    pluginId: WRITE_MANIFEST.id,
    port: channel.port1,
    declared: ["library:read", "library:write"],
    granted: () => options.granted,
    isLibraryAvailable: () => options.libraryAvailable ?? true,
    handlers: createPluginHandlers(WRITE_MANIFEST),
  });
  const client = createPluginClient(channel.port2);
  return {
    client,
    close() {
      channel.port1.close();
      channel.port2.close();
    },
  };
}

function writeChapterContent(chapterId: string, content: { text: string } | { html: string }) {
  const write = handlers["library.chapters.updateContent"];
  if (!write) throw new Error("library.chapters.updateContent is not wired");
  return write({ chapterId, content }, context);
}

function writeNote(input: {
  noteId: string;
  title?: string;
  content?: { text: string } | { html: string };
}) {
  const write = handlers["library.notes.update"];
  if (!write) throw new Error("library.notes.update is not wired");
  return write(input, context);
}

/** The #588 Book write and the reads that carry its fields, all through the handlers. */
function writeBook(input: PluginApiInput<"library.books.update">) {
  const write = handlers["library.books.update"];
  if (!write) throw new Error("library.books.update is not wired");
  return write(input, context);
}

function readBook(bookId: string) {
  const read = handlers["library.books.get"];
  if (!read) throw new Error("library.books.get is not wired");
  return read({ bookId }, context);
}

function readBooks() {
  const read = handlers["library.books.list"];
  if (!read) throw new Error("library.books.list is not wired");
  return read({}, context);
}

function readChapter(chapterId: string) {
  const read = handlers["library.chapters.get"];
  if (!read) throw new Error("library.chapters.get is not wired");
  return read({ chapterId }, context);
}

function readChapters(bookId: string) {
  const read = handlers["library.chapters.list"];
  if (!read) throw new Error("library.chapters.list is not wired");
  return read({ bookId }, context);
}

async function seedBook(
  id: string,
  fields: { genre?: string; status?: string; targetWordCount?: number } = {}
): Promise<void> {
  await testDb.execute(
    `INSERT INTO books (id, title, author_name, genre, status, target_word_count, language, created_at, updated_at, content_updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'en', 1000, 1000, 1000)`,
    [
      id,
      `Book ${id}`,
      "Author",
      fields.genre ?? null,
      fields.status ?? "draft",
      fields.targetWordCount ?? null,
    ]
  );
}

async function seedChapter(
  id: string,
  bookId: string,
  content = "<p>Stored</p>",
  fields: { chapterType?: string; status?: string } = {}
): Promise<void> {
  await testDb.execute(
    `INSERT INTO chapters (id, book_id, title, content, "order", chapter_type, word_count, status, is_included_in_export, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, 1, ?, 1, 1000, 1000)`,
    [id, bookId, `Title ${id}`, content, fields.chapterType ?? "chapter", fields.status ?? "draft"]
  );
}

interface BookRow {
  title: string;
  author_name: string;
  genre: string | null;
  status: string;
  target_word_count: number | null;
}

async function bookRow(id: string): Promise<BookRow | null> {
  const rows = await testDb.select<BookRow[]>(
    "SELECT title, author_name, genre, status, target_word_count FROM books WHERE id = ?",
    [id]
  );
  return rows.length > 0 ? rows[0] : null;
}

async function seedNote(id: string, content = "<p>Stored</p>"): Promise<void> {
  await testDb.execute(
    `INSERT INTO notes (id, title, content, language, tags, pinned, "order", word_count, collapsed_headings, created_at, updated_at)
     VALUES (?, ?, ?, 'en', '[]', 0, 0, 1, '[]', 1000, 1000)`,
    [id, `Note ${id}`, content]
  );
}

async function chapterContent(id: string): Promise<string | null> {
  const rows = await testDb.select<{ content: string | null }[]>(
    "SELECT content FROM chapters WHERE id = ?",
    [id]
  );
  return rows.length > 0 ? rows[0].content : null;
}

async function noteContent(id: string): Promise<string | null> {
  const rows = await testDb.select<{ content: string | null }[]>(
    "SELECT content FROM notes WHERE id = ?",
    [id]
  );
  return rows.length > 0 ? rows[0].content : null;
}

beforeEach(async () => {
  testDb = await createTestDatabase();
  mockGetDatabase.mockReset().mockResolvedValue(testDb);
  mockReindex.mockReset().mockResolvedValue(undefined);
  resetChangeFeedForTests();
  resetViewRefreshForTests();
  resetPendingEditsForTests();
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
});

afterEach(() => {
  resetViewRefreshForTests();
  resetChangeFeedForTests();
  resetPendingEditsForTests();
});

describe("Plugin Library writes reach the open view", () => {
  it("refreshes an open Chapter when a Plugin updates its content through the handler", async () => {
    await seedBook("book-1");
    await seedChapter("ch-1", "book-1", "<p>Stored</p>");
    await useChapterStore.getState().loadChapters("book-1");
    useChapterStore.getState().setCurrentChapter(useChapterStore.getState().chapters[0] ?? null);

    await writeChapterContent("ch-1", { html: "<p>Plugin wrote this</p>" });

    // The Change Feed reached the open view: no reload is needed.
    expect(useChapterStore.getState().currentChapter?.content).toBe("<p>Plugin wrote this</p>");
    expect(useChapterStore.getState().chapters[0]?.content).toBe("<p>Plugin wrote this</p>");
    expect(await chapterContent("ch-1")).toBe("<p>Plugin wrote this</p>");
  });

  it("refreshes an open Note when a Plugin updates it through the handler", async () => {
    await seedNote("note-1");
    await useNoteStore.getState().loadNotes();
    await useNoteStore.getState().loadNote("note-1");

    await writeNote({ noteId: "note-1", content: { html: "<p>Plugin note</p>" } });

    expect(useNoteStore.getState().currentNote?.content).toBe("<p>Plugin note</p>");
    expect(await noteContent("note-1")).toBe("<p>Plugin note</p>");
  });

  it("flushes the open editor before the write and keeps typing done while it runs", async () => {
    await seedBook("book-1");
    await seedChapter("ch-1", "book-1", "<p>Original</p>");
    await useChapterStore.getState().loadChapters("book-1");
    useChapterStore.getState().setCurrentChapter(useChapterStore.getState().chapters[0] ?? null);

    // Hold the write at its first database access, so the author can type while
    // it is in flight, after the Flush saved what they had already typed.
    let hold = false;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockGetDatabase.mockImplementation(() =>
      hold ? gate.then(() => testDb) : Promise.resolve(testDb)
    );

    const saves: string[] = [];
    let contentWhenFlushed: string | null = null;
    const session = createEditSession<string>({
      initial: "<p>Original</p>",
      saveDelayMs: 60_000,
      save: async (content) => {
        saves.push(content);
        const stored = await useChapterStore.getState().updateChapter("ch-1", { content });
        return stored?.content ?? content;
      },
    });
    const off = registerPendingEditsFlush(async () => {
      await session.flush();
      // The Flush ran before the write: the row holds the author's typing now.
      if (saves.length === 1) {
        contentWhenFlushed = await chapterContent("ch-1");
        hold = true;
      }
    });

    try {
      session.update("<p>Unsaved mine</p>");
      const write = writeChapterContent("ch-1", { html: "<p>Plugin content</p>" });
      for (let tick = 0; tick < 50 && !hold; tick++) await Promise.resolve();
      expect(hold).toBe(true);
      // The typing was in the row before the Plugin content replaced it.
      expect(contentWhenFlushed).toBe("<p>Unsaved mine</p>");

      // The author keeps typing while the write is still in flight.
      session.update("<p>Typed during the write</p>");
      release();
      await write;

      // The write replaced the row; the open view refreshed on the local Change.
      expect(await chapterContent("ch-1")).toBe("<p>Plugin content</p>");
      expect(useChapterStore.getState().currentChapter?.content).toBe("<p>Plugin content</p>");

      // The outside content reaches the open editor as a content change (what
      // useEditSession forwards). The newer typing wins and saves on top (#430).
      session.externalContent(useChapterStore.getState().currentChapter?.content ?? "");
      expect(session.getContent()).toBe("<p>Typed during the write</p>");
      expect(session.hasUnsavedChanges()).toBe(true);

      await flushPendingEdits();
      expect(await chapterContent("ch-1")).toBe("<p>Typed during the write</p>");
      expect(useChapterStore.getState().currentChapter?.content).toBe(
        "<p>Typed during the write</p>"
      );
      expect(saves).toEqual(["<p>Unsaved mine</p>", "<p>Typed during the write</p>"]);
    } finally {
      release();
      off();
    }
  });

  it("refuses the Plugin write end to end when the open editor's save fails", async () => {
    await seedBook("book-1");
    await seedChapter("ch-1", "book-1", "<p>Original</p>");
    await useChapterStore.getState().loadChapters("book-1");
    useChapterStore.getState().setCurrentChapter(useChapterStore.getState().chapters[0] ?? null);

    const changes: Change[] = [];
    const offFeed = onChange((signal) => {
      if (isEntityChange(signal)) changes.push(signal);
    });
    const realUpdateChapter = useChapterStore.getState().updateChapter;
    useChapterStore.setState({
      updateChapter: async () => {
        throw new Error("disk full");
      },
    });
    const session = createEditSession<string>({
      initial: "<p>Original</p>",
      saveDelayMs: 60_000,
      save: async (content) => {
        const stored = await useChapterStore.getState().updateChapter("ch-1", { content });
        return stored?.content ?? content;
      },
    });
    const off = registerPendingEditsFlush(() => session.flush());

    try {
      session.update("<p>Precious</p>");
      await expect(
        writeChapterContent("ch-1", { html: "<p>Plugin content</p>" })
      ).rejects.toMatchObject({ name: "PluginApiError", code: "library-unavailable" });
    } finally {
      off();
      offFeed();
      useChapterStore.setState({ updateChapter: realUpdateChapter });
    }

    // Nothing persisted, nothing emitted, and the editor still holds the text.
    expect(await chapterContent("ch-1")).toBe("<p>Original</p>");
    expect(session.getContent()).toBe("<p>Precious</p>");
    expect(session.hasUnsavedChanges()).toBe(true);
    expect(changes).toEqual([]);
  });

  it("refuses a Note write end to end when the open editor's save fails", async () => {
    await seedNote("note-1", "<p>Original</p>");
    await useNoteStore.getState().loadNotes();
    await useNoteStore.getState().loadNote("note-1");

    const changes: Change[] = [];
    const offFeed = onChange((signal) => {
      if (isEntityChange(signal)) changes.push(signal);
    });
    const realUpdateNote = useNoteStore.getState().updateNote;
    useNoteStore.setState({
      updateNote: async () => {
        throw new Error("disk full");
      },
    });
    const session = createEditSession<string>({
      initial: "<p>Original</p>",
      saveDelayMs: 60_000,
      save: async (content) => {
        const stored = await useNoteStore.getState().updateNote({ id: "note-1", content });
        return stored?.content ?? content;
      },
    });
    const off = registerPendingEditsFlush(() => session.flush());

    try {
      session.update("<p>Precious</p>");
      await expect(
        writeNote({ noteId: "note-1", content: { html: "<p>Plugin note</p>" } })
      ).rejects.toMatchObject({ name: "PluginApiError", code: "library-unavailable" });
    } finally {
      off();
      offFeed();
      useNoteStore.setState({ updateNote: realUpdateNote });
    }

    // Nothing persisted, nothing emitted, and the editor still holds the text.
    expect(await noteContent("note-1")).toBe("<p>Original</p>");
    expect(session.getContent()).toBe("<p>Precious</p>");
    expect(session.hasUnsavedChanges()).toBe(true);
    expect(changes).toEqual([]);
  });
});

// #588: the Book fields the author edits in Maibuk's own Book settings, read and
// written through the Plugin API. Target Word Count is a Book field; Chapters
// have no such column, so their reads add Chapter Type and Chapter Status only.
describe("Plugin Book fields through the handlers (#588)", () => {
  it("reads a Book's Genre, Book Status, and Target Word Count", async () => {
    await seedBook("book-1", {
      genre: "Science Fiction",
      status: "in-progress",
      targetWordCount: 90_000,
    });

    expect(await readBook("book-1")).toMatchObject({
      id: "book-1",
      genre: "Science Fiction",
      status: "in-progress",
      targetWordCount: 90_000,
    });
    expect(await readBooks()).toEqual([
      expect.objectContaining({
        id: "book-1",
        genre: "Science Fiction",
        status: "in-progress",
        targetWordCount: 90_000,
      }),
    ]);
  });

  it("reads an unset Genre and Target Word Count as null", async () => {
    await seedBook("book-1");
    expect(await readBook("book-1")).toMatchObject({
      genre: null,
      status: "draft",
      targetWordCount: null,
    });
  });

  it("reads a Chapter's Chapter Type and Chapter Status", async () => {
    await seedBook("book-1");
    await seedChapter("ch-1", "book-1", "<p>Text</p>", {
      chapterType: "prologue",
      status: "revised",
    });

    expect(await readChapters("book-1")).toEqual([
      expect.objectContaining({ id: "ch-1", chapterType: "prologue", status: "revised" }),
    ]);
    expect(await readChapter("ch-1")).toMatchObject({ chapterType: "prologue", status: "revised" });
  });

  it("updates a Book through the handler and refreshes the open view", async () => {
    await seedBook("book-1");
    await useBookStore.getState().loadBooks();

    await expect(
      writeBook({
        bookId: "book-1",
        title: "A New Title",
        authorName: "Ada",
        genre: "Fantasy",
        status: "in-progress",
        targetWordCount: 60_000,
      })
    ).resolves.toBeNull();

    expect(await bookRow("book-1")).toMatchObject({
      title: "A New Title",
      author_name: "Ada",
      genre: "Fantasy",
      status: "in-progress",
      target_word_count: 60_000,
    });
    // The open view refreshed on the local Change, like any outside write.
    expect(useBookStore.getState().books[0]).toMatchObject({
      title: "A New Title",
      authorName: "Ada",
      genre: "Fantasy",
      status: "in-progress",
      targetWordCount: 60_000,
    });

    // An omitted field keeps what the row holds.
    await writeBook({ bookId: "book-1", status: "completed" });
    expect(await bookRow("book-1")).toMatchObject({
      title: "A New Title",
      genre: "Fantasy",
      status: "completed",
    });
  });

  it("clears a Genre and a Target Word Count with null", async () => {
    await seedBook("book-1", { genre: "Fantasy", targetWordCount: 60_000 });
    await writeBook({ bookId: "book-1", genre: null, targetWordCount: null });
    expect(await bookRow("book-1")).toMatchObject({ genre: null, target_word_count: null });
  });

  it("refuses a Book update that names no field", async () => {
    await seedBook("book-1");
    await expect(writeBook({ bookId: "book-1" })).rejects.toMatchObject({
      name: "PluginApiError",
      code: "invalid-params",
    });
    expect(await bookRow("book-1")).toMatchObject({ title: "Book book-1" });
  });

  it("refuses an unknown Book", async () => {
    await expect(writeBook({ bookId: "absent", title: "Nowhere" })).rejects.toMatchObject({
      name: "PluginApiError",
      code: "invalid-params",
      message: "Book absent does not exist",
    });
  });

  it("refuses library.books.update without library:write", async () => {
    const { client, close } = connectWritePlugin({ granted: ["library:read"] });
    try {
      await expect(
        client.library.books.update({ bookId: "book-1", title: "Mine" })
      ).rejects.toMatchObject({ code: "permission-denied", permission: "library:write" });
    } finally {
      close();
    }
  });

  it("refuses library.books.update while the Tutorial Library is active", async () => {
    await seedBook("book-1");
    const { client, close } = connectWritePlugin({
      granted: ["library:write"],
      libraryAvailable: false,
    });
    try {
      await expect(
        client.library.books.update({ bookId: "book-1", title: "Mine" })
      ).rejects.toMatchObject({ code: "library-unavailable" });
    } finally {
      close();
    }
    // Nothing was written.
    expect(await bookRow("book-1")).toMatchObject({ title: "Book book-1" });
  });
});
