import { describe, it, expect, beforeEach, vi } from "vitest";
import type { DatabaseAdapter } from "@/lib/platform/types";
import type { BookSnapshot } from "@/features/sync/types";
import { createTestDatabase } from "@/test/support/db-test-context";
import {
  SWEEP_VERSION_CONTENT,
  convertInlineVersions,
  deleteVersionRows,
  historyBytes,
  insertSplitVersionStatements,
  readVersionSnapshot,
} from "@/features/versions/content-store";

type ChapterInput = { id: string; content: string | null; order: number };

function makeSnapshot(opts: {
  chapters: ChapterInput[];
  coverImagePath?: string | null;
  coverData?: string | null;
}): BookSnapshot {
  return {
    book: {
      id: "book-1",
      title: "T",
      subtitle: null,
      authorName: "A",
      description: null,
      genre: null,
      language: "en",
      coverImagePath: opts.coverImagePath ?? null,
      coverData: opts.coverData ?? null,
      wordCount: 1,
      targetWordCount: null,
      status: "draft",
      createdAt: 1,
      updatedAt: 1,
      contentUpdatedAt: 1,
      lastOpenedAt: null,
      lastChapterId: null,
    },
    chapters: opts.chapters.map((c) => ({
      id: c.id,
      bookId: "book-1",
      title: `Title ${c.id}`,
      content: c.content,
      synopsis: null,
      order: c.order,
      parentId: null,
      chapterType: "chapter",
      wordCount: 1,
      status: "draft",
      isIncludedInExport: true,
      createdAt: 1,
      updatedAt: 1,
    })),
  };
}

async function writeVersion(db: DatabaseAdapter, id: string, snapshot: BookSnapshot) {
  const row = {
    id,
    bookId: "book-1",
    name: null,
    wordCount: 1,
    checksum: id,
    triggerType: "auto-idle",
    createdAt: 100,
    syncedAt: null,
  };
  await db.executeAtomic(await insertSplitVersionStatements(db, row, snapshot));
}

async function count(db: DatabaseAdapter, table: string): Promise<number> {
  const rows = await db.select<{ n: number }[]>(`SELECT COUNT(*) AS n FROM ${table}`);
  return Number(rows[0].n);
}

const BIG = "b".repeat(200 * 1024);
const COVER_IMAGE = `data:image/png;base64,${"Q".repeat(300 * 1024)}`;
const COVER_DATA = JSON.stringify({ format: "png", width: 600, height: 900 });
const TRICKY = `She said "hi" 😀 and left\n<p>it's</p>`;

describe("content-store", () => {
  let db: DatabaseAdapter;

  beforeEach(async () => {
    db = await createTestDatabase();
    await db.execute(
      "INSERT INTO books (id, title, author_name, created_at, updated_at) VALUES ('book-1','T','A',1,1)"
    );
  });

  it("round-trips a split Version with null, tricky, and large chapters, cover fields, and unsorted order", async () => {
    const snapshot = makeSnapshot({
      chapters: [
        { id: "ch-a", content: null, order: 5 },
        { id: "ch-b", content: `${TRICKY}${BIG}`, order: 1 },
        { id: "ch-c", content: "<p>plain</p>", order: 3 },
      ],
      coverImagePath: COVER_IMAGE,
      coverData: COVER_DATA,
    });

    await writeVersion(db, "v1", snapshot);
    const restored = await readVersionSnapshot(db, "v1");

    expect(restored).toEqual({ bookId: "book-1", snapshot });
    expect(restored?.snapshot.chapters.map((c) => c.id)).toEqual(["ch-a", "ch-b", "ch-c"]);
  });

  it("reads a legacy inline row whose format column defaults to inline", async () => {
    const snapshot = makeSnapshot({
      chapters: [
        { id: "ch-a", content: "<p>one</p>", order: 2 },
        { id: "ch-b", content: TRICKY, order: 1 },
      ],
      coverImagePath: COVER_IMAGE,
    });
    await db.execute(
      `INSERT INTO book_versions (id, book_id, name, snapshot, word_count, checksum, trigger_type, created_at, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["legacy-1", "book-1", null, JSON.stringify(snapshot), 1, "legacy-1", "manual", 100, null]
    );

    const fmt = await db.select<{ format: string }[]>(
      "SELECT format FROM book_versions WHERE id = 'legacy-1'"
    );
    expect(fmt[0].format).toBe("inline");
    expect(await readVersionSnapshot(db, "legacy-1")).toEqual({ bookId: "book-1", snapshot });
  });

  it("stores only the changed Chapter text and shares the unchanged blobs and cover", async () => {
    const base = [
      { id: "ch-a", content: "<p>A</p>", order: 1 },
      { id: "ch-b", content: "<p>B</p>", order: 2 },
      { id: "ch-c", content: "<p>C</p>", order: 3 },
    ];
    await writeVersion(db, "v1", makeSnapshot({ chapters: base, coverImagePath: COVER_IMAGE }));
    const blobsBefore = await count(db, "version_blobs");

    const edited = base.map((c) => (c.id === "ch-b" ? { ...c, content: "<p>B edited</p>" } : c));
    await writeVersion(db, "v2", makeSnapshot({ chapters: edited, coverImagePath: COVER_IMAGE }));

    expect((await count(db, "version_blobs")) - blobsBefore).toBe(1);
    const newBlob = await db.select<{ content: string }[]>(
      `SELECT b.content FROM version_blobs b
       JOIN book_version_chapters c ON c.content_hash = b.hash
       WHERE c.version_id = 'v2' AND c.chapter_id = 'ch-b'`
    );
    expect(newBlob).toEqual([{ content: "<p>B edited</p>" }]);
    expect(await count(db, "book_version_chapters")).toBe(6);
    expect(await count(db, "book_version_assets")).toBe(2);
    const coverHashes = await db.select<{ hash: string }[]>(
      "SELECT DISTINCT hash FROM book_version_assets"
    );
    expect(coverHashes).toHaveLength(1);
  });

  it("stores the split row with no chapters, null cover fields, and format split", async () => {
    const snapshot = makeSnapshot({
      chapters: [{ id: "ch-a", content: "<p>A</p>", order: 1 }],
      coverImagePath: COVER_IMAGE,
      coverData: COVER_DATA,
    });
    await writeVersion(db, "v1", snapshot);

    const rows = await db.select<{ snapshot: string; format: string }[]>(
      "SELECT snapshot, format FROM book_versions WHERE id = 'v1'"
    );
    expect(rows[0].format).toBe("split");
    const stored = JSON.parse(rows[0].snapshot) as BookSnapshot;
    expect(stored.chapters).toEqual([]);
    expect(stored.book.coverImagePath).toBeNull();
    expect(stored.book.coverData).toBeNull();
  });

  it("deleteVersionRows removes only the deleted Version's content, and the last delete empties every content table", async () => {
    const v1 = makeSnapshot({
      chapters: [
        { id: "ch-a", content: "<p>A</p>", order: 1 },
        { id: "ch-b", content: "<p>B old</p>", order: 2 },
        { id: "ch-c", content: "<p>C</p>", order: 3 },
      ],
      coverImagePath: COVER_IMAGE,
    });
    const v2 = makeSnapshot({
      chapters: [
        { id: "ch-a", content: "<p>A</p>", order: 1 },
        { id: "ch-b", content: "<p>B new</p>", order: 2 },
        { id: "ch-c", content: "<p>C</p>", order: 3 },
      ],
      coverImagePath: COVER_IMAGE,
    });
    await writeVersion(db, "v1", v1);
    await writeVersion(db, "v2", v2);

    await deleteVersionRows(db, ["v1"]);

    expect(await count(db, "book_version_chapters WHERE version_id = 'v1'")).toBe(0);
    expect(await count(db, "book_version_assets WHERE version_id = 'v1'")).toBe(0);
    expect(await count(db, "book_version_chapters WHERE version_id = 'v2'")).toBe(3);
    expect(await count(db, "book_version_assets WHERE version_id = 'v2'")).toBe(1);
    const remaining = await db.select<{ content: string }[]>(
      "SELECT content FROM version_blobs ORDER BY content"
    );
    expect(remaining.map((r) => r.content)).toEqual(
      ["<p>A</p>", "<p>B new</p>", "<p>C</p>", COVER_IMAGE].sort()
    );
    expect(remaining.map((r) => r.content)).not.toContain("<p>B old</p>");
    expect(await readVersionSnapshot(db, "v2")).toEqual({ bookId: "book-1", snapshot: v2 });

    await deleteVersionRows(db, ["v2"]);

    expect(await count(db, "book_versions")).toBe(0);
    expect(await count(db, "book_version_chapters")).toBe(0);
    expect(await count(db, "book_version_assets")).toBe(0);
    expect(await count(db, "version_blobs")).toBe(0);
  });

  it("SWEEP_VERSION_CONTENT removes manifest rows whose Version row was deleted directly", async () => {
    const v1 = makeSnapshot({
      chapters: [
        { id: "ch-a", content: "<p>shared</p>", order: 1 },
        { id: "ch-b", content: "<p>only v1</p>", order: 2 },
      ],
      coverImagePath: COVER_IMAGE,
    });
    const v2 = makeSnapshot({
      chapters: [{ id: "ch-a", content: "<p>shared</p>", order: 1 }],
      coverImagePath: COVER_IMAGE,
    });
    await writeVersion(db, "v1", v1);
    await writeVersion(db, "v2", v2);

    await db.execute("DELETE FROM book_versions WHERE id = 'v1'");
    expect(await count(db, "book_version_chapters WHERE version_id = 'v1'")).toBe(2);

    await db.executeAtomic([...SWEEP_VERSION_CONTENT]);

    expect(await count(db, "book_version_chapters WHERE version_id = 'v1'")).toBe(0);
    expect(await count(db, "book_version_assets WHERE version_id = 'v1'")).toBe(0);
    expect(await count(db, "book_version_chapters WHERE version_id = 'v2'")).toBe(1);
    expect(await count(db, "book_version_assets WHERE version_id = 'v2'")).toBe(1);
    expect(await count(db, "version_blobs")).toBe(2);
    expect(await readVersionSnapshot(db, "v2")).toEqual({ bookId: "book-1", snapshot: v2 });
  });

  it("throws when a referenced Chapter blob or cover blob is missing, and returns null for an unknown id", async () => {
    const snapshot = makeSnapshot({
      chapters: [{ id: "ch-a", content: "<p>A</p>", order: 1 }],
      coverImagePath: COVER_IMAGE,
    });
    await writeVersion(db, "v1", snapshot);

    const chapterHash = (
      await db.select<{ content_hash: string }[]>(
        "SELECT content_hash FROM book_version_chapters WHERE version_id = 'v1'"
      )
    )[0].content_hash;
    const coverHash = (
      await db.select<{ hash: string }[]>(
        "SELECT hash FROM book_version_assets WHERE version_id = 'v1'"
      )
    )[0].hash;

    await db.execute("DELETE FROM version_blobs WHERE hash = ?", [chapterHash]);
    await expect(readVersionSnapshot(db, "v1")).rejects.toThrow(/missing Chapter text/);

    await writeVersion(db, "v2", makeSnapshot({ chapters: [], coverImagePath: COVER_IMAGE }));
    await db.execute("DELETE FROM version_blobs WHERE hash = ?", [coverHash]);
    await expect(readVersionSnapshot(db, "v2")).rejects.toThrow(/missing its coverImage/);

    expect(await readVersionSnapshot(db, "no-such-version")).toBeNull();
  });

  it("convertInlineVersions converts in batches, reports counts, and keeps every snapshot readable", async () => {
    const snapshots: Record<string, BookSnapshot> = {
      "inline-1": makeSnapshot({
        chapters: [{ id: "ch-a", content: "<p>shared</p>", order: 1 }],
        coverImagePath: COVER_IMAGE,
      }),
      "inline-2": makeSnapshot({
        chapters: [
          { id: "ch-a", content: "<p>shared</p>", order: 1 },
          { id: "ch-b", content: TRICKY, order: 2 },
        ],
      }),
      "inline-3": makeSnapshot({
        chapters: [{ id: "ch-c", content: null, order: 1 }],
        coverData: COVER_DATA,
      }),
    };
    for (const [i, [id, snapshot]] of Object.entries(snapshots).entries()) {
      await db.execute(
        `INSERT INTO book_versions (id, book_id, name, snapshot, word_count, checksum, trigger_type, created_at, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, "book-1", null, JSON.stringify(snapshot), 1, id, "manual", 100 + i, null]
      );
    }

    expect(await convertInlineVersions(db, 2)).toBe(2);
    expect(await convertInlineVersions(db, 2)).toBe(1);
    expect(await convertInlineVersions(db, 2)).toBe(0);

    const formats = await db.select<{ format: string }[]>("SELECT format FROM book_versions");
    expect(formats.every((r) => r.format === "split")).toBe(true);
    for (const [id, snapshot] of Object.entries(snapshots)) {
      expect(await readVersionSnapshot(db, id)).toEqual({ bookId: "book-1", snapshot });
    }
    const sharedBlobs = await db.select<{ n: number }[]>(
      "SELECT COUNT(*) AS n FROM version_blobs WHERE content = '<p>shared</p>'"
    );
    expect(Number(sharedBlobs[0].n)).toBe(1);
  });

  it("convertInlineVersions resumes past a crash leftover without duplicate or stray manifest rows", async () => {
    const snapshot = makeSnapshot({
      chapters: [
        { id: "ch-a", content: "<p>A</p>", order: 1 },
        { id: "ch-b", content: "<p>B</p>", order: 2 },
      ],
      coverImagePath: COVER_IMAGE,
    });
    await db.execute(
      `INSERT INTO book_versions (id, book_id, name, snapshot, word_count, checksum, trigger_type, created_at, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["crash-1", "book-1", null, JSON.stringify(snapshot), 1, "crash-1", "manual", 100, null]
    );
    // Leftovers from an earlier attempt that died mid-way.
    await db.execute(
      "INSERT INTO book_version_chapters (version_id, chapter_id, position, content_hash, meta) VALUES ('crash-1', 'stray', 9, 'no-such-hash', '{}')"
    );
    await db.execute(
      "INSERT INTO book_version_assets (version_id, role, hash) VALUES ('crash-1', 'coverImage', 'stale-hash')"
    );

    expect(await convertInlineVersions(db, 10)).toBe(1);

    const chapters = await db.select<{ chapter_id: string; position: number }[]>(
      "SELECT chapter_id, position FROM book_version_chapters WHERE version_id = 'crash-1' ORDER BY position"
    );
    expect(chapters).toEqual([
      { chapter_id: "ch-a", position: 0 },
      { chapter_id: "ch-b", position: 1 },
    ]);
    const assets = await db.select<{ role: string }[]>(
      "SELECT role FROM book_version_assets WHERE version_id = 'crash-1'"
    );
    expect(assets).toHaveLength(1);
    expect(await readVersionSnapshot(db, "crash-1")).toEqual({ bookId: "book-1", snapshot });
  });

  it("historyBytes counts each referenced blob once in UTF-8 bytes, plus Version rows, for this Book only", async () => {
    const enc = new TextEncoder();
    const shared = "<p>shared 😀</p>";
    const bOld = "<p>old é</p>";
    const bNew = "<p>new 😀😀</p>";

    const v1 = makeSnapshot({
      chapters: [
        { id: "ch-a", content: shared, order: 1 },
        { id: "ch-b", content: bOld, order: 2 },
      ],
      coverImagePath: COVER_IMAGE,
    });
    const v2 = makeSnapshot({
      chapters: [
        { id: "ch-a", content: shared, order: 1 },
        { id: "ch-b", content: bNew, order: 2 },
      ],
      coverImagePath: COVER_IMAGE,
    });
    await writeVersion(db, "v1", v1);
    await writeVersion(db, "v2", v2);

    // A second Book with its own Version must not be counted.
    await db.execute(
      "INSERT INTO books (id, title, author_name, created_at, updated_at) VALUES ('book-2','U','B',1,1)"
    );
    await writeVersion(
      db,
      "other-1",
      makeSnapshot({ chapters: [{ id: "ch-x", content: "<p>other book text</p>", order: 1 }] })
    );
    await db.execute("UPDATE book_versions SET book_id = 'book-2' WHERE id = 'other-1'");

    const snapshotColumnBytes = async (ids: string[]) => {
      let total = 0;
      for (const id of ids) {
        const rows = await db.select<{ snapshot: string }[]>(
          "SELECT snapshot FROM book_versions WHERE id = ?",
          [id]
        );
        total += enc.encode(rows[0].snapshot).length;
      }
      return total;
    };

    const expectedBlobBytes =
      enc.encode(shared).length +
      enc.encode(bOld).length +
      enc.encode(bNew).length +
      enc.encode(COVER_IMAGE).length;
    const expected = expectedBlobBytes + (await snapshotColumnBytes(["v1", "v2"]));

    expect(await historyBytes(db, "book-1")).toBe(expected);
    expect(await historyBytes(db, "book-2")).toBeGreaterThan(0);
    expect(await historyBytes(db, "book-2")).toBe(
      enc.encode("<p>other book text</p>").length + (await snapshotColumnBytes(["other-1"]))
    );
  });

  it("refuses a split Version whose manifest lost a Chapter row, instead of restoring fewer Chapters", async () => {
    await writeVersion(
      db,
      "v1",
      makeSnapshot({
        chapters: [
          { id: "ch-a", content: "<p>A</p>", order: 1 },
          { id: "ch-b", content: "<p>B</p>", order: 2 },
        ],
      })
    );
    await db.execute(
      "DELETE FROM book_version_chapters WHERE version_id = 'v1' AND chapter_id = 'ch-b'"
    );

    await expect(readVersionSnapshot(db, "v1")).rejects.toThrow(/missing Chapters/);
  });

  it("marks an inline row it cannot split as legacy, converts the rest, and never retries it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const good = makeSnapshot({ chapters: [{ id: "ch-a", content: "<p>ok</p>", order: 1 }] });
    // Inline rows: the format column defaults to 'inline'. The broken one is the older.
    await db.execute(
      `INSERT INTO book_versions (id, book_id, name, snapshot, word_count, checksum, trigger_type, created_at, synced_at)
       VALUES ('bad-1', 'book-1', NULL, '{oops', 1, 'bad-1', 'manual', 100, NULL)`
    );
    await db.execute(
      `INSERT INTO book_versions (id, book_id, name, snapshot, word_count, checksum, trigger_type, created_at, synced_at)
       VALUES (?, 'book-1', NULL, ?, 1, 'good-1', 'manual', 101, NULL)`,
      ["good-1", JSON.stringify(good)]
    );

    await convertInlineVersions(db, 10);

    const formats = await db.select<{ id: string; format: string }[]>(
      "SELECT id, format FROM book_versions ORDER BY id"
    );
    expect(formats).toEqual([
      { id: "bad-1", format: "legacy" },
      { id: "good-1", format: "split" },
    ]);
    expect(await readVersionSnapshot(db, "good-1")).toEqual({ bookId: "book-1", snapshot: good });
    expect(warn).toHaveBeenCalled();
    // Legacy rows are not picked up again, so the upgrade reaches its end.
    expect(await convertInlineVersions(db, 10)).toBe(0);
    warn.mockRestore();
  });

  it("keeps an inline row with a duplicate Chapter id whole as legacy, still readable, with no manifest rows left", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const duplicate = makeSnapshot({
      chapters: [
        { id: "ch-a", content: "<p>first</p>", order: 1 },
        { id: "ch-a", content: "<p>second</p>", order: 2 },
      ],
    });
    await db.execute(
      `INSERT INTO book_versions (id, book_id, name, snapshot, word_count, checksum, trigger_type, created_at, synced_at)
       VALUES (?, 'book-1', NULL, ?, 1, 'dup-1', 'manual', 100, NULL)`,
      ["dup-1", JSON.stringify(duplicate)]
    );

    expect(await convertInlineVersions(db, 10)).toBe(1);

    const rows = await db.select<{ format: string }[]>(
      "SELECT format FROM book_versions WHERE id = 'dup-1'"
    );
    expect(rows[0].format).toBe("legacy");
    expect(await readVersionSnapshot(db, "dup-1")).toEqual({ bookId: "book-1", snapshot: duplicate });
    // The failed split rolled back whole: no half-written manifest or text.
    expect(await count(db, "book_version_chapters")).toBe(0);
    expect(await count(db, "version_blobs")).toBe(0);
    expect(await convertInlineVersions(db, 10)).toBe(0);
    warn.mockRestore();
  });
});
