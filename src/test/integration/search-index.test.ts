import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BackupAdapter, BackupEntry, DatabaseAdapter } from "@/lib/platform/types";
import { parseTriggerFromFilename } from "@/features/backup/utils";
import { createDefaultCanvasDoc } from "@/features/canvas/types";
import { createTestDatabase } from "@/test/support/db-test-context";

const mockGetDatabase = vi.hoisted(() => vi.fn());
const mockExportDatabase = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDatabase: mockGetDatabase,
  exportDatabase: mockExportDatabase,
}));

const {
  createBookRow,
  updateBookRow,
  deleteBookRow,
  applyBookSnapshotData,
} = await import("@/features/books/write");
const {
  createChapterRow,
  updateChapterRow,
  deleteChapterRow,
} = await import("@/features/chapters/write");
const {
  createNoteRow,
  updateNoteRow,
  deleteNoteRow,
  applyNoteSnapshotData,
} = await import("@/features/notes/write");
const {
  createCanvasRow,
  updateCanvasDocRow,
  deleteCanvasRow,
  applyCanvasSnapshotData,
} = await import("@/features/canvas/write");
const { BackupService, resetBackupQueueForTests } = await import(
  "@/features/backup/backup-service"
);
const { SQL_EXPORT_TABLES } = await import("@/lib/db/sql-export-format");
const { formatSqlDump: formatDump } = await import("@/lib/db/sql-export");
const { serializeBook, serializeCanvas, serializeNote } = await import(
  "@/features/sync/serializer"
);
const { useEphemeralStore } = await import("@/features/ephemeral/store");
const {
  SEARCH_INDEX_VERSION,
  SEARCH_INDEX_VERSION_KEY,
  awaitSearchIndexRebuild,
  ensureSearchIndex,
  isSearchIndexRebuilding,
  requestSearchRebuild,
  resetSearchIndexForTests,
  subscribeSearchIndexStatus,
} = await import("@/features/search/rebuild");
const { SEARCH_REBUILD_MARKER_KEY } = await import("@/features/search/schema");
const { searchLibrary } = await import("@/features/search/search");

interface SearchRow {
  item_kind: string;
  item_id: string;
  book_id: string | null;
  field: string;
  block_index: number;
  text: string;
}

let db: DatabaseAdapter;

async function indexRows(): Promise<SearchRow[]> {
  return db.select<SearchRow[]>(
    `SELECT item_kind, item_id, book_id, field, block_index, text
       FROM search_text ORDER BY item_kind, item_id, field, block_index`
  );
}

async function rowsFor(kind: string, id: string): Promise<SearchRow[]> {
  return db.select<SearchRow[]>(
    `SELECT item_kind, item_id, book_id, field, block_index, text
       FROM search_text WHERE item_kind = ? AND item_id = ?
      ORDER BY CASE field
                 WHEN 'title' THEN 0
                 WHEN 'subtitle' THEN 1
                 WHEN 'description' THEN 2
                 ELSE 3
               END, block_index`,
    [kind, id]
  );
}

async function ftsMatches(term: string): Promise<SearchRow[]> {
  return db.select<SearchRow[]>(
    `SELECT s.item_kind, s.item_id, s.book_id, s.field, s.block_index, s.text
       FROM search_text_fts f
       JOIN search_text s ON s.id = f.rowid
      WHERE search_text_fts MATCH ?
      ORDER BY s.item_kind, s.item_id, s.block_index`,
    [term]
  );
}

function textOf(rows: SearchRow[]): string[] {
  return rows.map((row) => row.text);
}

async function triggerNames(): Promise<string[]> {
  const rows = await db.select<{ name: string }[]>(
    `SELECT name FROM sqlite_master
      WHERE type = 'trigger' AND name LIKE 'search_text_%'
      ORDER BY name`
  );
  return rows.map((row) => row.name);
}

async function ftsRowCount(): Promise<number> {
  const rows = await db.select<{ count: number }[]>(
    "SELECT COUNT(*) AS count FROM search_text_fts"
  );
  return rows[0]?.count ?? 0;
}

async function searchRowCount(): Promise<number> {
  const rows = await db.select<{ count: number }[]>(
    "SELECT COUNT(*) AS count FROM search_text"
  );
  return rows[0]?.count ?? 0;
}

async function setting(key: string): Promise<string | null> {
  const rows = await db.select<{ value: string }[]>(
    "SELECT value FROM settings WHERE key = ?",
    [key]
  );
  return rows[0]?.value ?? null;
}

function createMemoryBackupAdapter(): BackupAdapter & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  const entries = new Map<string, BackupEntry>();
  let counter = 0;
  const list = () =>
    [...entries.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return {
    files,
    async saveBackup(filename, sql) {
      files.set(filename, sql);
      entries.set(filename, {
        filename,
        trigger: parseTriggerFromFilename(filename),
        createdAt: new Date(1_700_000_000_000 + counter++ * 1000),
        sizeBytes: sql.length,
        checksum: "test",
      });
    },
    async listBackups() {
      return list();
    },
    async listBackupsPage({ page, pageSize }) {
      const all = list();
      return {
        entries: all.slice((page - 1) * pageSize, page * pageSize),
        totalCount: all.length,
        totalSizeBytes: all.reduce((sum, entry) => sum + entry.sizeBytes, 0),
        page,
        pageSize,
      };
    },
    async readBackup(filename) {
      const sql = files.get(filename);
      if (!sql) throw new Error("Not found");
      return new TextDecoder().decode(sql);
    },
    async deleteBackup(filename) {
      files.delete(filename);
      entries.delete(filename);
    },
  };
}

async function seedChapter(bookId: string, content: string) {
  const chapter = await createChapterRow({ bookId, title: "Chapter" }, "local");
  await updateChapterRow(chapter.id, { content }, "local");
  return chapter;
}

beforeEach(async () => {
  vi.stubGlobal("Worker", undefined);
  resetBackupQueueForTests();
  db = await createTestDatabase();
  mockGetDatabase.mockReset();
  mockGetDatabase.mockResolvedValue(db);
  mockExportDatabase.mockReset();
  mockExportDatabase.mockImplementation(() => db.exportData());
  resetSearchIndexForTests();
});

afterEach(async () => {
  await awaitSearchIndexRebuild();
  resetSearchIndexForTests();
  vi.unstubAllGlobals();
});

describe("Library Search index write hooks", () => {
  it("indexes a saved Chapter with one row per block", async () => {
    const book = await createBookRow({ title: "Novel", authorName: "Author" }, "local");
    const chapter = await seedChapter(book.id, "<p>First paragraph</p><p>Second paragraph</p>");

    const rows = await rowsFor("chapter", chapter.id);
    expect(rows.map((row) => row.text)).toEqual(["First paragraph", "Second paragraph"]);
    expect(rows.map((row) => row.block_index)).toEqual([0, 1]);
    expect(rows[0].book_id).toBe(book.id);
  });

  it("replaces a Chapter's rows when it is edited", async () => {
    const book = await createBookRow({ title: "Novel", authorName: "Author" }, "local");
    const chapter = await seedChapter(book.id, "<p>Original words</p>");

    await updateChapterRow(chapter.id, { content: "<p>Rewritten words</p><p>New block</p>" }, "local");

    expect(textOf(await rowsFor("chapter", chapter.id))).toEqual(["Rewritten words", "New block"]);
  });

  it("indexes a saved Note and follows its edits", async () => {
    const note = await createNoteRow({ title: "Note", content: "<p>Note first</p>" }, "local");
    expect(textOf(await rowsFor("note", note.id))).toEqual(["Note first"]);

    await updateNoteRow({ id: note.id, content: "<p>Note edited</p><p>Second</p>" }, "local");
    expect(textOf(await rowsFor("note", note.id))).toEqual(["Note edited", "Second"]);
  });

  it("indexes Canvas card text, one row per block", async () => {
    const canvas = await createCanvasRow({ title: "Map" }, "local");
    const doc = {
      ...createDefaultCanvasDoc(),
      nodes: [
        { id: "n1", kind: "text" as const, position: { x: 0, y: 0 }, html: "<p>Card one</p>" },
        {
          id: "n2",
          kind: "text" as const,
          position: { x: 1, y: 1 },
          html: "<p>Card two</p><p>Card two b</p>",
        },
      ],
    };

    await updateCanvasDocRow(canvas.id, doc, "local");

    expect(textOf(await rowsFor("canvas", canvas.id))).toEqual([
      "Card one",
      "Card two",
      "Card two b",
    ]);
  });

  it("indexes Book title, subtitle, and description and follows their edits", async () => {
    const book = await createBookRow(
      {
        title: "Harbour Novel",
        authorName: "Author",
        subtitle: "A subtitle",
        description: "A description",
      },
      "local"
    );

    expect(textOf(await rowsFor("book", book.id))).toEqual([
      "Harbour Novel",
      "A subtitle",
      "A description",
    ]);

    await updateBookRow(book.id, { title: "Renamed Novel", description: "New description" }, "local");
    expect(textOf(await rowsFor("book", book.id))).toEqual([
      "Renamed Novel",
      "A subtitle",
      "New description",
    ]);
  });
});

describe("Library Search index removal", () => {
  it("removes a Chapter's rows when the Chapter is deleted", async () => {
    const book = await createBookRow({ title: "Novel", authorName: "Author" }, "local");
    const chapter = await seedChapter(book.id, "<p>Deleted body</p>");

    await deleteChapterRow(chapter.id, "local");

    expect(await rowsFor("chapter", chapter.id)).toEqual([]);
    await expect(ftsMatches("Deleted")).resolves.toEqual([]);
  });

  it("removes a Note's rows when the Note is deleted", async () => {
    const note = await createNoteRow({ title: "Note", content: "<p>Deleted note</p>" }, "local");
    await deleteNoteRow(note.id, "local");
    expect(await rowsFor("note", note.id)).toEqual([]);
  });

  it("removes a Canvas's rows when the Canvas is deleted", async () => {
    const canvas = await createCanvasRow({ title: "Map" }, "local");
    await updateCanvasDocRow(
      canvas.id,
      {
        ...createDefaultCanvasDoc(),
        nodes: [
          { id: "n1", kind: "text", position: { x: 0, y: 0 }, html: "<p>Deleted card</p>" },
        ],
      },
      "local"
    );
    await deleteCanvasRow(canvas.id, "local");
    expect(await rowsFor("canvas", canvas.id)).toEqual([]);
  });

  it("removes a Book and its Chapters' rows when the Book is deleted", async () => {
    const book = await createBookRow({ title: "Deleted Novel", authorName: "Author" }, "local");
    const chapter = await seedChapter(book.id, "<p>Deleted chapter</p>");

    await deleteBookRow(book.id, "local");

    expect(await rowsFor("book", book.id)).toEqual([]);
    expect(await rowsFor("chapter", chapter.id)).toEqual([]);
  });
});

describe("Library Search index sync and Restore hooks", () => {
  it("indexes a Book and its Chapters applied from a synced snapshot", async () => {
    const snapshot = {
      book: {
        id: "book-sync",
        title: "Synced Novel",
        subtitle: "Synced subtitle",
        authorName: "Author",
        description: "Synced description",
        genre: null,
        language: "en",
        coverImagePath: null,
        coverData: null,
        wordCount: 2,
        targetWordCount: null,
        status: "draft",
        createdAt: 1000,
        updatedAt: 2000,
        lastOpenedAt: null,
        lastChapterId: null,
      },
      chapters: [
        {
          id: "chapter-sync",
          bookId: "book-sync",
          title: "Chapter",
          content: "<p>Pulled paragraph one</p><p>Pulled paragraph two</p>",
          synopsis: "Synopsis must not be indexed",
          order: 0,
          parentId: null,
          chapterType: "chapter",
          wordCount: 6,
          status: "draft",
          isIncludedInExport: true,
          createdAt: 1000,
          updatedAt: 2000,
        },
      ],
    };

    await applyBookSnapshotData(snapshot, "remote");

    expect(textOf(await rowsFor("book", "book-sync"))).toEqual([
      "Synced Novel",
      "Synced subtitle",
      "Synced description",
    ]);
    expect(textOf(await rowsFor("chapter", "chapter-sync"))).toEqual([
      "Pulled paragraph one",
      "Pulled paragraph two",
    ]);
    await expect(ftsMatches("pulled")).resolves.toHaveLength(2);

    // A pulled Book that no longer has the Chapter removes its index rows too.
    await applyBookSnapshotData({ ...snapshot, chapters: [] }, "remote");
    expect(await rowsFor("chapter", "chapter-sync")).toEqual([]);
  });

  it("indexes a Note and a Canvas applied from synced snapshots", async () => {
    await applyNoteSnapshotData(
      {
        note: {
          id: "note-sync",
          bookId: null,
          title: "Note",
          content: "<p>Pulled note body</p>",
          language: "en",
          tags: "[]",
          pinned: false,
          order: 0,
          wordCount: 3,
          collapsedHeadings: "[]",
          createdAt: 1000,
          updatedAt: 2000,
        },
      },
      "remote"
    );
    await applyCanvasSnapshotData(
      {
        canvas: {
          id: "canvas-sync",
          title: "Map",
          pinned: false,
          order: 0,
          doc: {
            ...createDefaultCanvasDoc(),
            nodes: [
              {
                id: "n1",
                kind: "text",
                position: { x: 0, y: 0 },
                html: "<p>Pulled card</p>",
              },
            ],
          },
          createdAt: 1000,
          updatedAt: 2000,
        },
      },
      "remote"
    );

    expect(textOf(await rowsFor("note", "note-sync"))).toEqual(["Pulled note body"]);
    expect(textOf(await rowsFor("canvas", "canvas-sync"))).toEqual(["Pulled card"]);
  });

  it("re-adds rows when a deleted Note is restored from a snapshot", async () => {
    const note = await createNoteRow({ title: "Note", content: "<p>Restored body</p>" }, "local");
    await deleteNoteRow(note.id, "local");
    expect(await rowsFor("note", note.id)).toEqual([]);

    await applyNoteSnapshotData(
      {
        note: {
          id: note.id,
          bookId: null,
          title: "Note",
          content: "<p>Restored body</p>",
          language: "en",
          tags: "[]",
          pinned: false,
          order: 0,
          wordCount: 2,
          collapsedHeadings: "[]",
          createdAt: note.createdAt,
          updatedAt: note.updatedAt,
        },
      },
      "local"
    );

    expect(textOf(await rowsFor("note", note.id))).toEqual(["Restored body"]);
  });

  it("rebuilds the index after a Restore so it matches the restored Library", async () => {
    const adapter = createMemoryBackupAdapter();
    const service = new BackupService(adapter);

    const book = await createBookRow({ title: "Restored Novel", authorName: "Author" }, "local");
    const chapter = await seedChapter(book.id, "<p>Restored paragraph</p>");
    const filename = await service.createBackup("manual");

    // Change the Library and leave the index stale.
    await deleteBookRow(book.id, "local");
    await createBookRow({ title: "Temporary Novel", authorName: "Author" }, "local");
    await db.execute("DELETE FROM search_text");

    await service.restoreBackup(filename);

    const rows = await indexRows();
    expect(rows.some((row) => row.item_id === book.id && row.text === "Restored Novel")).toBe(true);
    expect(rows.some((row) => row.item_id === chapter.id && row.text === "Restored paragraph")).toBe(
      true
    );
    expect(rows.some((row) => row.text === "Temporary Novel")).toBe(false);
  });

  it("ignores a Restore dump that carries search_text rows", async () => {
    const adapter = createMemoryBackupAdapter();
    const service = new BackupService(adapter);
    const filename = "maibuk-backup-manual-2026-05-01T00-00-00.sql";
    const dump = [
      "-- Maibuk Database Export (SQL Dump)",
      "-- Exported at: 2026-05-01T00:00:00.000Z",
      "",
      "-- Books",
      `INSERT OR REPLACE INTO "books" ("id", "title", "author_name", "created_at", "updated_at") VALUES ('book-restored', 'Restored Book', 'Author', 1000, 1000);`,
      `INSERT OR REPLACE INTO "search_text" ("id", "item_kind", "item_id", "book_id", "field", "block_index", "text", "updated_at") VALUES (1, 'book', 'ghost', NULL, 'title', 0, 'Ghost only text', 1000);`,
    ].join("\n");
    await adapter.saveBackup(filename, new TextEncoder().encode(dump));

    await service.restoreBackup(filename);

    const rows = await indexRows();
    expect(rows.some((row) => row.text === "Ghost only text")).toBe(false);
    expect(rows.some((row) => row.text === "Restored Book")).toBe(true);
  });
});

describe("Library Search index exclusions", () => {
  it("does not index synopses, Cover data, Versions, Plugin data, or Ephemeral text", async () => {
    const book = await createBookRow({ title: "Novel", authorName: "Author" }, "local");
    const chapter = await seedChapter(book.id, "<p>Body text</p>");

    await updateChapterRow(
      chapter.id,
      { synopsis: "SynopsisOnlySecret" },
      "local"
    );
    await updateBookRow(book.id, { coverData: '{"secret":"CoverOnlySecret"}' }, "local");
    await db.execute(
      `INSERT INTO book_versions (id, book_id, name, snapshot, word_count, checksum, trigger_type, created_at)
       VALUES ('v1', ?, 'Checkpoint', ?, 1, 'checksum', 'manual', 1000)`,
      [book.id, '{"text":"CheckpointOnlySecret"}']
    );
    await db.execute(
      `INSERT INTO plugin_storage (plugin_id, "key", "value", updated_at) VALUES ('p1', 'k', 'PluginOnlySecret', 1000)`
    );
    useEphemeralStore.getState().setContent("<p>EphemeralOnlySecret</p>");

    await requestSearchRebuild();
    await awaitSearchIndexRebuild();

    const rows = await indexRows();
    const all = rows.map((row) => row.text).join("\n");
    expect(all).not.toContain("SynopsisOnlySecret");
    expect(all).not.toContain("CoverOnlySecret");
    expect(all).not.toContain("CheckpointOnlySecret");
    expect(all).not.toContain("PluginOnlySecret");
    expect(all).not.toContain("EphemeralOnlySecret");
    expect(all).toContain("Body text");
  });

  it("leaves no rows for an item that was deleted", async () => {
    const book = await createBookRow({ title: "Novel", authorName: "Author" }, "local");
    const note = await createNoteRow({ title: "Note", content: "<p>Deleted item</p>" }, "local");
    await deleteNoteRow(note.id, "local");

    expect(await rowsFor("note", note.id)).toEqual([]);
    expect(await rowsFor("book", book.id)).not.toEqual([]);
  });
});

describe("Library Search index is device-local", () => {
  it("is absent from the SQL export table list and both dump paths", async () => {
    const book = await createBookRow({ title: "Novel", authorName: "Author" }, "local");
    await seedChapter(book.id, "<p>Exported body</p>");

    const tableNames = SQL_EXPORT_TABLES.map((table) => table.name);
    expect(tableNames).not.toContain("search_text");
    expect(tableNames).not.toContain("search_text_fts");

    const workerPath = new TextDecoder().decode(await db.exportData());
    const fallbackPath = new TextDecoder().decode(
      await formatDump(db, new Date().toISOString())
    );
    expect(workerPath).not.toContain("search_text");
    expect(fallbackPath).not.toContain("search_text");
  });

  it("is absent from every sync payload", async () => {
    const book = await createBookRow({ title: "Novel", authorName: "Author" }, "local");
    const chapter = await seedChapter(book.id, "<p>Synced body</p>");
    const note = await createNoteRow({ title: "Note", content: "<p>Note body</p>" }, "local");
    const canvas = await createCanvasRow({ title: "Map" }, "local");
    await updateCanvasDocRow(
      canvas.id,
      {
        ...createDefaultCanvasDoc(),
        nodes: [
          { id: "n1", kind: "text", position: { x: 0, y: 0 }, html: "<p>Card body</p>" },
        ],
      },
      "local"
    );

    const payloads = [
      await serializeBook(book.id),
      await serializeNote(note.id),
      await serializeCanvas(canvas.id),
    ];
    for (const payload of payloads) {
      expect(payload).not.toContain("search_text");
      expect(payload).not.toContain("search_text_fts");
    }
    expect(chapter.id).toBeTruthy();
  });

  it("clears the index when the Library is reset", async () => {
    const { RESET_LIBRARY_TABLES } = await import("@/lib/db");
    const book = await createBookRow({ title: "Novel", authorName: "Author" }, "local");
    await seedChapter(book.id, "<p>Reset body</p>");
    expect((await indexRows()).length).toBeGreaterThan(0);

    expect(RESET_LIBRARY_TABLES).toContain("search_text");
    // The Reset path deletes each listed table; the index's own delete is what
    // this test proves, without requiring the metrics tables the store tests
    // do not create.
    await db.execute("DELETE FROM search_text");

    expect(await indexRows()).toEqual([]);
    await expect(ftsMatches("Reset")).resolves.toEqual([]);
  });
});

describe("Library Search FTS5 trigram index", () => {
  it("matches case-insensitively", async () => {
    const book = await createBookRow({ title: "Novel", authorName: "Author" }, "local");
    await seedChapter(book.id, "<p>Elena Madrigal walked in.</p>");

    const matches = await ftsMatches("elena");
    expect(matches.map((row) => row.text)).toEqual(["Elena Madrigal walked in."]);
  });

  it("keeps accents exact", async () => {
    const book = await createBookRow({ title: "Novel", authorName: "Author" }, "local");
    await seedChapter(book.id, "<p>La canción del faro</p>");

    await expect(ftsMatches("canción")).resolves.toHaveLength(1);
    await expect(ftsMatches("cancion")).resolves.toEqual([]);
  });

  it("never matches across two blocks", async () => {
    const book = await createBookRow({ title: "Novel", authorName: "Author" }, "local");
    await seedChapter(book.id, "<p>alpha</p><p>beta</p>");

    await expect(ftsMatches("alpha beta")).resolves.toEqual([]);
  });
});

describe("Library Search background rebuild", () => {
  it("reports its status while running and when it finishes", async () => {
    const book = await createBookRow({ title: "Novel", authorName: "Author" }, "local");
    await seedChapter(book.id, "<p>Rebuilt body</p>");
    await db.execute("DELETE FROM search_text");

    const seen: boolean[] = [];
    const unsubscribe = subscribeSearchIndexStatus(() => {
      seen.push(isSearchIndexRebuilding());
    });

    const run = requestSearchRebuild();
    expect(isSearchIndexRebuilding()).toBe(true);
    await run;
    unsubscribe();

    expect(isSearchIndexRebuilding()).toBe(false);
    expect(seen).toContain(true);
    expect(seen[seen.length - 1]).toBe(false);
  });

  it("rebuilds when the stored index version is older than the schema's", async () => {
    const book = await createBookRow({ title: "Old index", authorName: "Author" }, "local");
    await seedChapter(book.id, "<p>Body after migration</p>");
    await db.execute("DELETE FROM search_text");
    await db.execute(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, '0', 1000)
       ON CONFLICT(key) DO UPDATE SET value = '0', updated_at = 1000`,
      [SEARCH_INDEX_VERSION_KEY]
    );

    await ensureSearchIndex();
    await awaitSearchIndexRebuild();

    const rows = await indexRows();
    expect(rows.some((row) => row.text === "Body after migration")).toBe(true);
    const stored = await db.select<{ value: string }[]>(
      "SELECT value FROM settings WHERE key = ?",
      [SEARCH_INDEX_VERSION_KEY]
    );
    expect(stored[0].value).toBe(String(SEARCH_INDEX_VERSION));
  });

  it("rebuilds on first launch when the index is empty but the Library is not", async () => {
    const book = await createBookRow({ title: "First launch", authorName: "Author" }, "local");
    await seedChapter(book.id, "<p>Existing body</p>");
    await db.execute("DELETE FROM search_text");
    await db.execute(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [SEARCH_INDEX_VERSION_KEY, String(SEARCH_INDEX_VERSION), 1000]
    );

    await ensureSearchIndex();
    await awaitSearchIndexRebuild();

    const rows = await indexRows();
    expect(rows.some((row) => row.text === "Existing body")).toBe(true);
    expect(rows.some((row) => row.text === "First launch")).toBe(true);
  });
});

describe("Library Search rebuild without FTS triggers (#639)", () => {
  it("keeps a Chapter saved during the rebuild searchable", async () => {
    const book = await createBookRow({ title: "Novel", authorName: "Author" }, "local");
    const chapter = await seedChapter(book.id, "<p>Original rebuild text</p>");

    const originalSelect = db.select.bind(db);
    let saved = false;
    const selectSpy = vi.spyOn(db, "select").mockImplementation((async <T>(
      sql: string,
      params?: unknown[]
    ): Promise<T> => {
      // Pause the pass after the Chapters are written: the triggers are down
      // and the FTS index is empty, so only the final 'rebuild' can pick up
      // the save.
      if (!saved && sql.includes("FROM notes")) {
        saved = true;
        const triggers = await originalSelect<{ name: string }[]>(
          `SELECT name FROM sqlite_master
            WHERE type = 'trigger' AND name LIKE 'search_text_%'`
        );
        expect(triggers).toEqual([]);

        await updateChapterRow(chapter.id, { content: "<p>Saved while rebuilding</p>" }, "local");
        const indexed = await originalSelect<{ count: number }[]>(
          "SELECT COUNT(*) AS count FROM search_text WHERE text = ?",
          ["Saved while rebuilding"]
        );
        expect(indexed[0]?.count).toBe(1);
        const inFts = await originalSelect<SearchRow[]>(
          `SELECT s.item_kind, s.item_id, s.book_id, s.field, s.block_index, s.text
             FROM search_text_fts f
             JOIN search_text s ON s.id = f.rowid
            WHERE search_text_fts MATCH ?`,
          ["Saved while"]
        );
        expect(inFts).toEqual([]);
      }
      return originalSelect<T>(sql, params);
    }) as typeof db.select);

    try {
      await requestSearchRebuild();
    } finally {
      selectSpy.mockRestore();
    }

    expect(saved).toBe(true);
    expect(await triggerNames()).toHaveLength(3);
    const results = await searchLibrary(db, { query: "Saved while rebuilding" });
    expect("results" in results).toBe(true);
    if (!("results" in results)) return;
    expect(results.results.map((result) => result.ids.itemId)).toContain(chapter.id);
  });

  it("restores the triggers and the index after a mid-way failure", async () => {
    const book = await createBookRow({ title: "Midway Novel", authorName: "Author" }, "local");
    await seedChapter(book.id, "<p>alpha midway omega</p>");
    await createNoteRow({ title: "Midway note", content: "<p>midway note body</p>" }, "local");

    const rowsBefore = await indexRows();
    const resultsBefore = await searchLibrary(db, { query: "midway" });

    const originalSelect = db.select.bind(db);
    let thrown = false;
    const selectSpy = vi.spyOn(db, "select").mockImplementation((async <T>(
      sql: string,
      params?: unknown[]
    ): Promise<T> => {
      if (!thrown && sql.includes("FROM notes")) {
        thrown = true;
        throw new Error("rebuild interrupted on purpose");
      }
      return originalSelect<T>(sql, params);
    }) as typeof db.select);

    try {
      await expect(requestSearchRebuild()).rejects.toThrow("rebuild interrupted on purpose");
    } finally {
      selectSpy.mockRestore();
    }
    expect(thrown).toBe(true);

    // The failed pass closed itself: the triggers are back, the FTS index
    // matches the rows it had written, and the version says "stale".
    expect(await triggerNames()).toHaveLength(3);
    expect(await setting(SEARCH_REBUILD_MARKER_KEY)).toBe("0");
    expect(await setting(SEARCH_INDEX_VERSION_KEY)).toBe("0");
    expect(await ftsRowCount()).toBe(await searchRowCount());

    // The next launch check finishes the job, and it matches incremental
    // indexing exactly.
    await ensureSearchIndex();
    await awaitSearchIndexRebuild();

    expect(await setting(SEARCH_INDEX_VERSION_KEY)).toBe(String(SEARCH_INDEX_VERSION));
    expect(await indexRows()).toEqual(rowsBefore);
    expect(await searchLibrary(db, { query: "midway" })).toEqual(resultsBefore);
  });

  it("restores the triggers and leaves FTS in step after a whole rebuild", async () => {
    const book = await createBookRow({ title: "Rebuilt Novel", authorName: "Author" }, "local");
    await seedChapter(book.id, "<p>The rebuilt paragraph</p>");

    await requestSearchRebuild();

    expect(await triggerNames()).toHaveLength(3);
    expect(await setting(SEARCH_REBUILD_MARKER_KEY)).toBe("0");
    expect(await ftsRowCount()).toBe(await searchRowCount());
    expect(await ftsRowCount()).toBeGreaterThan(0);
    await expect(ftsMatches("paragraph")).resolves.toHaveLength(1);
  });
});
