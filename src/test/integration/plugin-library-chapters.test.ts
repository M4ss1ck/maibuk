import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Change } from "@/features/sync/change-feed";
import type { PluginApiInput } from "@/features/plugins/types";
import type { DatabaseAdapter } from "@/lib/platform/types";
import { createTestDatabase } from "@/test/support/db-test-context";
import { connectLibraryWritePlugin } from "@/test/support/plugin-broker";

// Data-safety integration tests for the Plugin Chapter writes (#588, part 3),
// driven through the real handler entry a Plugin calls, over the in-memory
// Library. Each write is a local write from outside the open view's store
// (ADR 0026): it Flushes the open editors first, refuses when a save fails,
// emits on the Change Feed, and the open view refreshes on the local Change
// (#430). Setup mirrors `plugin-library-write.test.ts`, the prior art for the
// Book writes of the same issue.
//
// The last block holds the Deletion Review path to its promise: a Chapter a
// Plugin deletes leaves the Library in exactly the state an author delete
// leaves it, as sync reads it (the Book's snapshot, the Change, the timestamps
// a Chapter delete moves), not merely a missing row.

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
const { useChapterStore } = await import("@/features/chapters/store");
const { installViewRefresh, resetViewRefreshForTests } = await import(
  "@/features/sync/view-refresh"
);
const { registerPendingEditsFlush, resetPendingEditsForTests } = await import(
  "@/features/sync/pending-edits"
);
const { isEntityChange, onChange, resetChangeFeedForTests } = await import(
  "@/features/sync/change-feed"
);
const { bookAdapter } = await import("@/features/sync/sync-engine");
const { normalizeBookSnapshotJson } = await import("@/features/sync/sync-codec-handlers");
const librarySwitch = await import("@/features/tutorial/library-switch");

const handlers = createPluginHandlers(PLUGIN_MANIFEST);
const context = { pluginId: "tracer" };

function createChapter(input: PluginApiInput<"library.chapters.create">) {
  const write = handlers["library.chapters.create"];
  if (!write) throw new Error("library.chapters.create is not wired");
  return write(input, context);
}

function deleteChapter(chapterId: string) {
  const write = handlers["library.chapters.delete"];
  if (!write) throw new Error("library.chapters.delete is not wired");
  return write({ chapterId }, context);
}

function reorderChapters(input: PluginApiInput<"library.chapters.reorder">) {
  const write = handlers["library.chapters.reorder"];
  if (!write) throw new Error("library.chapters.reorder is not wired");
  return write(input, context);
}

function updateChapter(input: PluginApiInput<"library.chapters.update">) {
  const write = handlers["library.chapters.update"];
  if (!write) throw new Error("library.chapters.update is not wired");
  return write(input, context);
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

async function seedBook(id: string): Promise<void> {
  await testDb.execute(
    `INSERT INTO books (id, title, author_name, language, created_at, updated_at, content_updated_at)
     VALUES (?, ?, 'Author', 'en', 1000, 1000, 1000)`,
    [id, `Book ${id}`]
  );
}

async function seedChapter(
  id: string,
  bookId: string,
  order: number,
  content = "<p>Stored</p>"
): Promise<void> {
  await testDb.execute(
    `INSERT INTO chapters (id, book_id, title, content, "order", chapter_type, word_count, status, is_included_in_export, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'chapter', 1, 'draft', 1, 1000, 1000)`,
    [id, bookId, `Title ${id}`, content, order]
  );
}

interface ChapterRow {
  book_id: string;
  title: string;
  content: string | null;
  order: number;
  chapter_type: string;
  word_count: number;
  status: string;
}

async function chapterRow(id: string): Promise<ChapterRow | null> {
  const rows = await testDb.select<ChapterRow[]>(
    'SELECT book_id, title, content, "order", chapter_type, word_count, status FROM chapters WHERE id = ?',
    [id]
  );
  return rows.length > 0 ? rows[0] : null;
}

async function chapterIds(bookId: string): Promise<string[]> {
  const rows = await testDb.select<{ id: string }[]>(
    'SELECT id FROM chapters WHERE book_id = ? ORDER BY "order" ASC',
    [bookId]
  );
  return rows.map((row) => row.id);
}

beforeEach(async () => {
  testDb = await createTestDatabase();
  // Read through the variable on every call, so the Deletion Review test can
  // put each delete path in front of its own identically seeded Library.
  mockGetDatabase.mockReset().mockImplementation(() => Promise.resolve(testDb));
  mockReindex.mockReset().mockResolvedValue(undefined);
  resetChangeFeedForTests();
  resetViewRefreshForTests();
  resetPendingEditsForTests();
  installViewRefresh();
  useChapterStore.setState({
    chapters: [],
    currentChapter: null,
    currentBookId: null,
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

describe("library.chapters.create (#588)", () => {
  it("appends a Chapter with its content and reads it back through the Library", async () => {
    await seedBook("book-1");
    await seedChapter("ch-1", "book-1", 0);

    const { chapterId } = await createChapter({
      bookId: "book-1",
      title: "Second",
      content: { text: "First line\n\nSecond line" },
    });

    expect(chapterId).toEqual(expect.any(String));
    const row = await chapterRow(chapterId);
    expect(row).toMatchObject({
      book_id: "book-1",
      title: "Second",
      order: 1,
      chapter_type: "chapter",
      status: "draft",
      word_count: 4,
    });
    expect(row?.content).toContain("<p>First line</p>");

    // The reads the API serves see the new Chapter last, with its content.
    expect(await chapterIds("book-1")).toEqual(["ch-1", chapterId]);
    expect(await readChapters("book-1")).toEqual([
      expect.objectContaining({ id: "ch-1", order: 0 }),
      expect.objectContaining({ id: chapterId, title: "Second", order: 1, wordCount: 4 }),
    ]);
    expect(await readChapter(chapterId)).toMatchObject({
      id: chapterId,
      title: "Second",
      bookId: "book-1",
      content: { text: "First line\n\nSecond line" },
    });
  });

  it("creates a Chapter without content or a position", async () => {
    await seedBook("book-1");

    const { chapterId } = await createChapter({ bookId: "book-1", title: "Only" });

    expect(await chapterIds("book-1")).toEqual([chapterId]);
    expect(await readChapter(chapterId)).toMatchObject({
      title: "Only",
      order: 0,
      wordCount: 0,
      chapterType: "chapter",
      status: "draft",
    });
  });

  it("inserts at a 0-based position among the Book's Chapters, ahead of the ones after it", async () => {
    await seedBook("book-1");
    await seedChapter("ch-1", "book-1", 0);
    await seedChapter("ch-2", "book-1", 1);
    await seedChapter("ch-3", "book-1", 2);

    const { chapterId } = await createChapter({
      bookId: "book-1",
      title: "Inserted",
      position: 1,
    });

    expect(await chapterIds("book-1")).toEqual(["ch-1", chapterId, "ch-2", "ch-3"]);
    // The stored order matches the index, so the UI list and sync agree.
    expect(await readChapters("book-1")).toEqual([
      expect.objectContaining({ id: "ch-1", order: 0 }),
      expect.objectContaining({ id: chapterId, order: 1 }),
      expect.objectContaining({ id: "ch-2", order: 2 }),
      expect.objectContaining({ id: "ch-3", order: 3 }),
    ]);
  });

  it("takes position 0 as the new first Chapter and the Chapter count as the last", async () => {
    await seedBook("book-1");
    await seedChapter("ch-1", "book-1", 0);
    await seedChapter("ch-2", "book-1", 1);

    const first = await createChapter({ bookId: "book-1", title: "First", position: 0 });
    expect(await chapterIds("book-1")).toEqual([first.chapterId, "ch-1", "ch-2"]);

    const last = await createChapter({ bookId: "book-1", title: "Last", position: 3 });
    expect(await chapterIds("book-1")).toEqual([first.chapterId, "ch-1", "ch-2", last.chapterId]);
  });

  it("deletes the new Chapter and rethrows when a later step fails", async () => {
    await seedBook("book-1");
    await seedChapter("ch-1", "book-1", 0);
    const chapterWrite = await import("@/features/chapters/write");
    const reorder = vi
      .spyOn(chapterWrite, "reorderChapterRows")
      .mockRejectedValueOnce(new Error("disk full"));

    try {
      await expect(
        createChapter({ bookId: "book-1", title: "Half-written", position: 0 })
      ).rejects.toThrow("disk full");
    } finally {
      reorder.mockRestore();
    }

    // No partial Chapter: the row the create made is gone again.
    expect(await chapterIds("book-1")).toEqual(["ch-1"]);
  });

  it("refuses a position past the end and writes nothing", async () => {
    await seedBook("book-1");
    await seedChapter("ch-1", "book-1", 0);
    await seedChapter("ch-2", "book-1", 1);

    await expect(
      createChapter({ bookId: "book-1", title: "Nowhere", position: 3 })
    ).rejects.toMatchObject({ name: "PluginApiError", code: "invalid-params" });
    expect(await chapterIds("book-1")).toEqual(["ch-1", "ch-2"]);
  });

  it("refuses an unknown Book", async () => {
    await expect(createChapter({ bookId: "absent", title: "Nowhere" })).rejects.toMatchObject({
      name: "PluginApiError",
      code: "invalid-params",
      message: "Book absent does not exist",
    });
  });
});

describe("library.chapters.update (#588)", () => {
  it("updates a Chapter's title, Chapter Type, and Chapter Status", async () => {
    await seedBook("book-1");
    await seedChapter("ch-1", "book-1", 0);

    await expect(
      updateChapter({
        chapterId: "ch-1",
        title: "Prologue",
        chapterType: "prologue",
        status: "revised",
      })
    ).resolves.toBeNull();

    expect(await chapterRow("ch-1")).toMatchObject({
      title: "Prologue",
      chapter_type: "prologue",
      status: "revised",
      content: "<p>Stored</p>",
    });
    expect(await readChapters("book-1")).toEqual([
      expect.objectContaining({
        id: "ch-1",
        title: "Prologue",
        chapterType: "prologue",
        status: "revised",
      }),
    ]);

    // An omitted field keeps what the row holds.
    await updateChapter({ chapterId: "ch-1", status: "final" });
    expect(await chapterRow("ch-1")).toMatchObject({
      title: "Prologue",
      chapter_type: "prologue",
      status: "final",
    });
  });

  it("refuses an update that names no field", async () => {
    await seedBook("book-1");
    await seedChapter("ch-1", "book-1", 0);

    await expect(updateChapter({ chapterId: "ch-1" })).rejects.toMatchObject({
      name: "PluginApiError",
      code: "invalid-params",
    });
    expect(await chapterRow("ch-1")).toMatchObject({ title: "Title ch-1", status: "draft" });
  });

  it("refuses an unknown Chapter", async () => {
    await expect(updateChapter({ chapterId: "absent", title: "Nowhere" })).rejects.toMatchObject({
      name: "PluginApiError",
      code: "invalid-params",
      message: "Chapter absent does not exist",
    });
  });
});

describe("library.chapters.reorder (#588)", () => {
  it("reorders a Book's Chapters to the given ids", async () => {
    await seedBook("book-1");
    await seedChapter("ch-1", "book-1", 0);
    await seedChapter("ch-2", "book-1", 1);
    await seedChapter("ch-3", "book-1", 2);

    await expect(
      reorderChapters({ bookId: "book-1", chapterIds: ["ch-3", "ch-1", "ch-2"] })
    ).resolves.toBeNull();

    expect(await chapterIds("book-1")).toEqual(["ch-3", "ch-1", "ch-2"]);
    expect(await readChapters("book-1")).toEqual([
      expect.objectContaining({ id: "ch-3", order: 0 }),
      expect.objectContaining({ id: "ch-1", order: 1 }),
      expect.objectContaining({ id: "ch-2", order: 2 }),
    ]);
  });

  it("refuses a list that is not exactly the Book's Chapters", async () => {
    await seedBook("book-1");
    await seedChapter("ch-1", "book-1", 0);
    await seedChapter("ch-2", "book-1", 1);

    // A missing id, an extra one, and a duplicate are each refused.
    for (const chapterIds of [["ch-1"], ["ch-1", "ch-2", "ch-3"], ["ch-1", "ch-1"], []]) {
      await expect(reorderChapters({ bookId: "book-1", chapterIds })).rejects.toMatchObject({
        name: "PluginApiError",
        code: "invalid-params",
      });
    }
    // Nothing moved.
    expect(await chapterIds("book-1")).toEqual(["ch-1", "ch-2"]);
  });

  it("refuses an unknown Book", async () => {
    await expect(reorderChapters({ bookId: "absent", chapterIds: [] })).rejects.toMatchObject({
      name: "PluginApiError",
      code: "invalid-params",
      message: "Book absent does not exist",
    });
  });
});

describe("library.chapters.delete (#588)", () => {
  it("deletes a Chapter through the normal Delete path", async () => {
    await seedBook("book-1");
    await seedChapter("ch-1", "book-1", 0);
    await seedChapter("ch-2", "book-1", 1);

    await expect(deleteChapter("ch-1")).resolves.toBeNull();

    expect(await chapterRow("ch-1")).toBeNull();
    expect(await readChapters("book-1")).toEqual([expect.objectContaining({ id: "ch-2" })]);
    expect(await readChapter("ch-1")).toBeNull();
  });

  it("refuses an unknown Chapter", async () => {
    await expect(deleteChapter("absent")).rejects.toMatchObject({
      name: "PluginApiError",
      code: "invalid-params",
      message: "Chapter absent does not exist",
    });
  });
});

// A local write from outside the open view flushes the editors first. When an
// open editor cannot save, the write is refused before anything lands.
describe("Chapter writes refuse when an open editor cannot save (#588)", () => {
  type LibraryClient = ReturnType<typeof connectLibraryWritePlugin>["client"];
  const cases: [string, (client: LibraryClient) => Promise<unknown>][] = [
    [
      "library.chapters.create",
      (client) => client.library.chapters.create({ bookId: "book-1", title: "New" }),
    ],
    ["library.chapters.delete", (client) => client.library.chapters.delete({ chapterId: "ch-1" })],
    [
      "library.chapters.reorder",
      (client) =>
        client.library.chapters.reorder({ bookId: "book-1", chapterIds: ["ch-2", "ch-1"] }),
    ],
    [
      "library.chapters.update",
      (client) => client.library.chapters.update({ chapterId: "ch-1", title: "Changed" }),
    ],
  ];

  it.each(cases)("%s refuses and writes nothing", async (_method, call) => {
    await seedBook("book-1");
    await seedChapter("ch-1", "book-1", 0);
    await seedChapter("ch-2", "book-1", 1);
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
    expect(await chapterIds("book-1")).toEqual(["ch-1", "ch-2"]);
    expect(await chapterRow("ch-1")).toMatchObject({ title: "Title ch-1", status: "draft" });
  });
});

// Every new write is refused by the broker before its handler runs: without
// `library:write`, and while the Tutorial makes the Library unavailable. The
// prior art for the same issue proves the Book writes this way.
describe("Chapter writes refuse without the Permission or the Library (#588)", () => {
  const calls = (client: ReturnType<typeof connectLibraryWritePlugin>["client"]) => [
    () => client.library.chapters.create({ bookId: "book-1", title: "Mine" }),
    () => client.library.chapters.delete({ chapterId: "ch-1" }),
    () => client.library.chapters.reorder({ bookId: "book-1", chapterIds: ["ch-1"] }),
    () => client.library.chapters.update({ chapterId: "ch-1", title: "Mine" }),
  ];

  it("refuses every Chapter write without library:write", async () => {
    await seedBook("book-1");
    await seedChapter("ch-1", "book-1", 0);

    const { client, close } = connectLibraryWritePlugin({ granted: ["library:read"] });
    try {
      for (const call of calls(client)) {
        await expect(call()).rejects.toMatchObject({
          code: "permission-denied",
          permission: "library:write",
        });
      }
    } finally {
      close();
    }
    expect(await chapterIds("book-1")).toEqual(["ch-1"]);
  });

  it("refuses every Chapter write with the real Tutorial Library switch", async () => {
    await seedBook("book-1");
    await seedChapter("ch-1", "book-1", 0);
    librarySwitch.activateTutorialDatabase(testDb);

    const { client, close } = connectLibraryWritePlugin({
      granted: ["library:write"],
      isLibraryAvailable: () => !librarySwitch.isTutorialLibraryActive(),
    });
    try {
      for (const call of calls(client)) {
        await expect(call()).rejects.toMatchObject({ code: "library-unavailable" });
      }
    } finally {
      close();
    }
    // Nothing was created, updated, reordered, or deleted.
    expect(await chapterIds("book-1")).toEqual(["ch-1"]);
    expect(await chapterRow("ch-1")).toMatchObject({ title: "Title ch-1", status: "draft" });
  });
});

// Deletion Review: a Chapter is not a Synced Item; its deletion travels inside
// its Book's snapshot (and the Book's local Change), which is what Entity Sync
// reads. These tests pin the Plugin delete to the author delete on exactly
// that state: the normalized snapshot sync checksums, the Change, the Book
// timestamps a Chapter delete moves, and the tombstone table (empty for a
// Chapter either way).
describe("a Plugin Chapter delete is the author's Delete path (#588)", () => {
  interface DeleteObservation {
    /** The Book's Chapter ids as sync serializes them. */
    chapterIds: string[];
    /** The Book snapshot sync checksums, with per-device fields dropped. */
    snapshot: string;
    checksum: string;
    /** The Change the delete emitted. */
    changes: Change[];
    /** Rows Deletion Review reads. */
    tombstones: { entity_type: string; entity_id: string }[];
    /** Whether the Book moved as a Chapter content change moves it. */
    bookStampsAdvanced: boolean;
  }

  /** Seeds one Book with two Chapters, runs the delete, and reads what sync sees. */
  async function observeDelete(remove: () => unknown): Promise<DeleteObservation> {
    testDb = await createTestDatabase();
    await seedBook("book-1");
    await seedChapter("ch-1", "book-1", 0, "<p>One</p>");
    await seedChapter("ch-2", "book-1", 1, "<p>Two</p>");

    resetChangeFeedForTests();
    const changes: Change[] = [];
    const offFeed = onChange((signal) => {
      if (isEntityChange(signal)) changes.push(signal);
    });
    try {
      await remove();
    } finally {
      offFeed();
    }

    const { json, checksum } = await bookAdapter.snapshotChecksums("book-1");
    const snapshot = JSON.parse(json) as { chapters: { id: string; content: string | null }[] };
    const stamps = await testDb.select<{ updated_at: number; content_updated_at: number | null }[]>(
      "SELECT updated_at, content_updated_at FROM books WHERE id = ?",
      ["book-1"]
    );
    return {
      chapterIds: snapshot.chapters.map((chapter) => chapter.id),
      snapshot: normalizeBookSnapshotJson(json),
      checksum,
      changes,
      tombstones: await testDb.select<{ entity_type: string; entity_id: string }[]>(
        "SELECT entity_type, entity_id FROM sync_tombstones ORDER BY id ASC"
      ),
      bookStampsAdvanced:
        stamps[0].updated_at > 1000 &&
        stamps[0].content_updated_at !== null &&
        stamps[0].content_updated_at === stamps[0].updated_at,
    };
  }

  it("leaves exactly the state the author delete leaves, as sync reads it", async () => {
    const viaPlugin = await observeDelete(() => deleteChapter("ch-1"));
    const viaAuthor = await observeDelete(() => useChapterStore.getState().deleteChapter("ch-1"));

    // The deletion the other devices will pull: the Chapter is gone from the
    // Book's snapshot, so its checksum moved.
    expect(viaPlugin.chapterIds).toEqual(["ch-2"]);
    expect(viaPlugin.snapshot).toBe(viaAuthor.snapshot);
    expect(viaPlugin.checksum).toBe(viaAuthor.checksum);

    // Sync and Auto Sync react to the same local Change either way.
    expect(viaPlugin.changes).toEqual([
      { entity: "book", id: "book-1", origin: "local", kind: "content" },
    ]);
    expect(viaPlugin.changes).toEqual(viaAuthor.changes);

    // A Chapter is not a Synced Item, so neither path records a tombstone:
    // Deletion Review carries the Book, not the Chapter.
    expect(viaPlugin.tombstones).toEqual([]);
    expect(viaAuthor.tombstones).toEqual([]);

    // Removing the Chapter removes content: the Book's Last Edited moves.
    expect(viaPlugin.bookStampsAdvanced).toBe(true);
    expect(viaAuthor.bookStampsAdvanced).toBe(true);
  });

  it("emits on the Change Feed before the call returns and refreshes the open view", async () => {
    await seedBook("book-1");
    await seedChapter("ch-1", "book-1", 0);
    await seedChapter("ch-2", "book-1", 1);
    await useChapterStore.getState().loadChapters("book-1");
    useChapterStore.getState().setCurrentChapter(useChapterStore.getState().chapters[0] ?? null);

    await deleteChapter("ch-1");

    // The open view already dropped the Chapter the Plugin deleted.
    expect(useChapterStore.getState().chapters.map((chapter) => chapter.id)).toEqual(["ch-2"]);
    expect(useChapterStore.getState().currentChapter).toBeNull();
  });
});
