import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Change } from "@/features/sync/change-feed";
import type { PluginApiInput } from "@/features/plugins/types";
import type { DatabaseAdapter } from "@/lib/platform/types";
import { createTestDatabase } from "@/test/support/db-test-context";
import { connectLibraryWritePlugin } from "@/test/support/plugin-broker";

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
const { useVersionStore } = await import("@/features/versions/store");
const librarySwitch = await import("@/features/tutorial/library-switch");

const handlers = createPluginHandlers(PLUGIN_MANIFEST);
const context = { pluginId: "tracer" };

function writeChapterContent(
  chapterId: string,
  content: { text: string } | { html: string },
  expectedUpdatedAt?: number
) {
  const write = handlers["library.chapters.updateContent"];
  if (!write) throw new Error("library.chapters.updateContent is not wired");
  return write(
    {
      chapterId,
      content,
      ...(expectedUpdatedAt === undefined ? {} : { expectedUpdatedAt }),
    },
    context
  );
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

/** The #588 Book writes and the reads that carry its fields, all through the handlers. */
function writeBook(input: PluginApiInput<"library.books.update">) {
  const write = handlers["library.books.update"];
  if (!write) throw new Error("library.books.update is not wired");
  return write(input, context);
}

function writeCheckpoint(input: PluginApiInput<"library.books.checkpoint">) {
  const write = handlers["library.books.checkpoint"];
  if (!write) throw new Error("library.books.checkpoint is not wired");
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
  fields: { chapterType?: string; status?: string; updatedAt?: number } = {}
): Promise<void> {
  await testDb.execute(
    `INSERT INTO chapters (id, book_id, title, content, "order", chapter_type, word_count, status, is_included_in_export, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, 1, ?, 1, 1000, ?)`,
    [
      id,
      bookId,
      `Title ${id}`,
      content,
      fields.chapterType ?? "chapter",
      fields.status ?? "draft",
      fields.updatedAt ?? 1000,
    ]
  );
}

/** The current Unix second, the unit the Library stores `updated_at` in. */
function currentSecond(): number {
  return Math.floor(Date.now() / 1000);
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

interface VersionRow {
  id: string;
  name: string | null;
  trigger_type: string;
}

async function versionRows(bookId: string): Promise<VersionRow[]> {
  return testDb.select<VersionRow[]>(
    "SELECT id, name, trigger_type FROM book_versions WHERE book_id = ? ORDER BY created_at ASC, id ASC",
    [bookId]
  );
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
  useVersionStore.setState({
    versions: [],
    totalCount: 0,
    currentBookId: null,
    currentPage: 1,
    pageSize: 10,
    isLoading: false,
    error: null,
  });
});

afterEach(() => {
  resetViewRefreshForTests();
  resetChangeFeedForTests();
  resetPendingEditsForTests();
  librarySwitch.resetLibrarySwitchForTests();
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

  it("an Agent write computed from a stale read does not overwrite the author's typing", async () => {
    // Freeze Date so the seed, the Plugin's read, and the Flush share one Unix
    // second: the same second `updated_at` does not move, so only the stored
    // content can reveal that the author typed.
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-01-15T12:00:00.000Z") });
    try {
      await seedBook("book-1");
      await seedChapter("ch-1", "book-1", "<p>Original</p>", { updatedAt: currentSecond() });
      await useChapterStore.getState().loadChapters("book-1");
      useChapterStore.getState().setCurrentChapter(useChapterStore.getState().chapters[0] ?? null);

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
        session.update("<p>Original</p><p>Mine</p>");
        // The Plugin read before the author typed: the row still holds the old content.
        const stale = await readChapter("ch-1");
        expect(stale?.updatedAt).toBe(currentSecond() * 1000);
        expect(await chapterContent("ch-1")).toBe("<p>Original</p>");

        await expect(
          writeChapterContent(
            "ch-1",
            { html: "<p>Original</p><p>Agent</p>" },
            stale?.updatedAt
          )
        ).rejects.toMatchObject({ name: "PluginApiError", code: "conflict" });

        // The flush ran before the refusal, so the row holds the author's typing,
        // and the session still holds it too.
        expect(await chapterContent("ch-1")).toBe("<p>Original</p><p>Mine</p>");
        expect(session.getContent()).toBe("<p>Original</p><p>Mine</p>");
        expect(useChapterStore.getState().currentChapter?.content).toBe(
          "<p>Original</p><p>Mine</p>"
        );
      } finally {
        off();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses on unsaved typing alone, checked after the flush", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-01-15T12:00:00.000Z") });
    try {
      await seedBook("book-1");
      await seedChapter("ch-1", "book-1", "<p>Original</p>", { updatedAt: currentSecond() });

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
        const read = await readChapter("ch-1");
        // Nothing but unsaved typing: the row is untouched when the write starts.
        session.update("<p>Original</p><p>Mine</p>");
        expect(await chapterContent("ch-1")).toBe("<p>Original</p>");

        await expect(
          writeChapterContent("ch-1", { html: "<p>Agent</p>" }, read?.updatedAt)
        ).rejects.toMatchObject({ name: "PluginApiError", code: "conflict" });

        // The Flush landed the typing without moving `updated_at`, so the
        // refusal came from what the Flush did, not from a timestamp mismatch.
        expect(await chapterContent("ch-1")).toBe("<p>Original</p><p>Mine</p>");
        expect((await readChapter("ch-1"))?.updatedAt).toBe(currentSecond() * 1000);
        expect(session.hasUnsavedChanges()).toBe(false);
      } finally {
        off();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("writes when expectedUpdatedAt matches and nothing is pending", async () => {
    await seedBook("book-1");
    await seedChapter("ch-1", "book-1", "<p>Original</p>");

    const read = await readChapter("ch-1");
    await expect(
      writeChapterContent("ch-1", { html: "<p>Agent</p>" }, read?.updatedAt)
    ).resolves.toBeNull();
    expect(await chapterContent("ch-1")).toBe("<p>Agent</p>");
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
    const { client, close } = connectLibraryWritePlugin({ granted: ["library:read"] });
    try {
      await expect(
        client.library.books.update({ bookId: "book-1", title: "Mine" })
      ).rejects.toMatchObject({ code: "permission-denied", permission: "library:write" });
    } finally {
      close();
    }
  });

  it("refuses library.books.update with the real Tutorial Library switch", async () => {
    await seedBook("book-1");
    librarySwitch.activateTutorialDatabase(testDb);
    const { client, close } = connectLibraryWritePlugin({
      granted: ["library:write"],
      isLibraryAvailable: () => !librarySwitch.isTutorialLibraryActive(),
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

// #588: a Checkpoint is the Version a Plugin takes before it changes a Book,
// through the normal Version path with the "plugin" Version Trigger and the
// label as the Version name.
describe("Plugin Checkpoints through the handlers (#588)", () => {
  it("creates a Version with trigger plugin and the given label", async () => {
    await seedBook("book-1");

    const { versionId } = await writeCheckpoint({
      bookId: "book-1",
      label: "Before a Plugin change",
    });

    expect(versionId).toEqual(expect.any(String));
    const rows = await versionRows("book-1");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: versionId,
      name: "Before a Plugin change",
      trigger_type: "plugin",
    });
  });

  it("returns null and creates no row when the Book is unchanged since its last Version", async () => {
    await seedBook("book-1");

    const first = await writeCheckpoint({ bookId: "book-1", label: "First" });
    expect(first.versionId).not.toBeNull();

    const second = await writeCheckpoint({ bookId: "book-1", label: "Second" });
    expect(second.versionId).toBeNull();
    expect(await versionRows("book-1")).toHaveLength(1);
  });

  it("creates a new Version after the Book changes", async () => {
    await seedBook("book-1");

    const first = await writeCheckpoint({ bookId: "book-1", label: "First" });
    await testDb.execute("UPDATE books SET title = ?, updated_at = ? WHERE id = ?", [
      "Changed",
      2000,
      "book-1",
    ]);

    const second = await writeCheckpoint({ bookId: "book-1", label: "Second" });

    expect(second.versionId).not.toBeNull();
    expect(second.versionId).not.toBe(first.versionId);
    const rows = await versionRows("book-1");
    expect(rows.map((row) => row.name).sort()).toEqual(["First", "Second"]);
    expect(rows.every((row) => row.trigger_type === "plugin")).toBe(true);
  });

  it("trims the label and refuses a blank one", async () => {
    await seedBook("book-1");

    // The one place the label bound lives is the method schema, so this goes
    // through the broker a Plugin calls rather than the bare handler.
    const { client, close } = connectLibraryWritePlugin({ granted: ["library:write"] });
    try {
      await client.library.books.checkpoint({ bookId: "book-1", label: "  Padded  " });
      expect((await versionRows("book-1"))[0].name).toBe("Padded");

      await expect(
        client.library.books.checkpoint({ bookId: "book-1", label: "   " })
      ).rejects.toMatchObject({ code: "invalid-params" });
    } finally {
      close();
    }
    expect(await versionRows("book-1")).toHaveLength(1);
  });

  it("flushes open editors before taking the Checkpoint", async () => {
    await seedBook("book-1");
    const off = registerPendingEditsFlush(async () => {
      await testDb.execute("UPDATE books SET title = ? WHERE id = ?", ["Flushed", "book-1"]);
    });

    try {
      const { versionId } = await writeCheckpoint({ bookId: "book-1", label: "After flush" });
      const rows = await testDb.select<{ snapshot: string }[]>(
        "SELECT snapshot FROM book_versions WHERE id = ?",
        [versionId]
      );
      const snapshot = JSON.parse(rows[0].snapshot) as { book: { title: string } };
      // The Flush ran first, so the Checkpoint holds what it saved.
      expect(snapshot.book.title).toBe("Flushed");
    } finally {
      off();
    }
  });

  it("refuses an unknown Book", async () => {
    await expect(
      writeCheckpoint({ bookId: "absent", label: "Nowhere" })
    ).rejects.toMatchObject({
      name: "PluginApiError",
      code: "invalid-params",
      message: "Book absent does not exist",
    });
  });

  it("refuses a Tutorial sample Book id at the write path", async () => {
    // The broker already refuses while the Tutorial Library is active; this is
    // the second defence, for a sample id that reaches the handler directly.
    await expect(
      writeCheckpoint({ bookId: "tutorial-book-1", label: "Mine" })
    ).rejects.toMatchObject({
      name: "PluginApiError",
      code: "library-unavailable",
      message: "The Tutorial Library is read-only; nothing was written.",
    });
    expect(await versionRows("tutorial-book-1")).toHaveLength(0);
  });

  it("refuses library.books.checkpoint without library:write", async () => {
    const { client, close } = connectLibraryWritePlugin({ granted: ["library:read"] });
    try {
      await expect(
        client.library.books.checkpoint({ bookId: "book-1", label: "Mine" })
      ).rejects.toMatchObject({ code: "permission-denied", permission: "library:write" });
    } finally {
      close();
    }
  });

  it("refuses library.books.checkpoint with the real Tutorial Library switch", async () => {
    await seedBook("book-1");
    librarySwitch.activateTutorialDatabase(testDb);
    const { client, close } = connectLibraryWritePlugin({
      granted: ["library:write"],
      isLibraryAvailable: () => !librarySwitch.isTutorialLibraryActive(),
    });
    try {
      await expect(
        client.library.books.checkpoint({ bookId: "book-1", label: "Mine" })
      ).rejects.toMatchObject({ code: "library-unavailable" });
    } finally {
      close();
    }
    expect(await versionRows("book-1")).toHaveLength(0);
  });
});

// A local write from outside the open view flushes the editors first. When an
// open editor cannot save, the write is refused before anything lands.
describe("Book writes refuse when an open editor cannot save (#588)", () => {
  type LibraryClient = ReturnType<typeof connectLibraryWritePlugin>["client"];
  const cases: [string, (client: LibraryClient) => Promise<unknown>][] = [
    [
      "library.books.update",
      (client) => client.library.books.update({ bookId: "book-1", title: "Changed", genre: "Fantasy" }),
    ],
    [
      "library.books.checkpoint",
      (client) => client.library.books.checkpoint({ bookId: "book-1", label: "Before" }),
    ],
  ];

  it.each(cases)("%s refuses and writes nothing", async (_method, call) => {
    await seedBook("book-1");
    // `flushPendingEdits` wraps this rejection in `PendingEditsFlushError`.
    const off = registerPendingEditsFlush(() => {
      throw new Error("disk full");
    });
    const { client, close } = connectLibraryWritePlugin({ granted: ["library:write"] });
    try {
      await expect(call(client)).rejects.toMatchObject({ code: "library-unavailable" });
    } finally {
      close();
      off();
    }
    expect(await bookRow("book-1")).toMatchObject({ title: "Book book-1", genre: null });
    expect(await versionRows("book-1")).toHaveLength(0);
  });
});
