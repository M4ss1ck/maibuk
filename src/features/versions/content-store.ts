import { computeChecksum } from "@/lib/checksum";
import type { AtomicStatement, DatabaseAdapter } from "@/lib/platform/types";
import type { BookSnapshot } from "@/features/sync/types";

// A Version is a manifest over content-addressed text (ADR 0032): one row per
// Chapter pointing at the sha256 of its HTML, and one row per Cover field.
// Saving a Version stores only content no other Version holds yet; deleting
// one sweeps only content nothing references any more. Rows written before
// this format ("inline") keep the whole Book in `snapshot` and stay readable
// forever, for old Backups and Database Files.

export const VERSION_FORMAT_INLINE = "inline";
export const VERSION_FORMAT_SPLIT = "split";
/** An inline row the upgrade could not split: still read whole, never converted again. */
export const VERSION_FORMAT_LEGACY = "legacy";

// Every write to Version storage runs one at a time, and so does every reader
// that must see it whole (a dump): a sweep must never remove content between a
// new Version's lookup and its insert, two Checkpoints must never pass the
// dedup check together, and a Backup must never hold a Version without its
// content. Never call it from inside another withVersionWrites: it would wait
// on itself.
let versionWrites: Promise<unknown> = Promise.resolve();

export function withVersionWrites<T>(work: () => Promise<T>): Promise<T> {
  const run = versionWrites.then(work, work);
  versionWrites = run.catch(() => {});
  return run;
}

/**
 * Whether inline Versions are still waiting for the upgrade. Until it has
 * taken its safety Backup and converted them, nothing drops a Version.
 */
export async function isVersionUpgradePending(db: DatabaseAdapter): Promise<boolean> {
  const rows = await db.select<{ id: string }[]>(
    "SELECT id FROM book_versions WHERE format = ? LIMIT 1",
    [VERSION_FORMAT_INLINE]
  );
  return rows.length > 0;
}

type BookFields = BookSnapshot["book"];
type ChapterFields = BookSnapshot["chapters"][number];

const COVER_ROLES = {
  coverImage: "coverImagePath",
  coverData: "coverData",
} as const satisfies Record<string, keyof BookFields>;
type CoverRole = keyof typeof COVER_ROLES;

// Keeps every IN (...) list well under SQLite's bind-parameter limit.
const HASH_LOOKUP_CHUNK = 500;

export interface VersionRowInput {
  id: string;
  bookId: string;
  name: string | null;
  wordCount: number;
  checksum: string;
  triggerType: string;
  createdAt: number;
  syncedAt: number | null;
}

interface SplitSnapshot {
  /** The `snapshot` column: the Book without its Cover payload, and no Chapters. */
  bookJson: string;
  chapters: Array<{ chapterId: string; position: number; hash: string | null; meta: string }>;
  covers: Array<{ role: CoverRole; hash: string }>;
  blobs: Map<string, string>;
}

async function splitSnapshot(snapshot: BookSnapshot): Promise<SplitSnapshot> {
  const blobs = new Map<string, string>();
  const store = async (content: string): Promise<string> => {
    const hash = await computeChecksum(content);
    blobs.set(hash, content);
    return hash;
  };

  const book: BookFields = { ...snapshot.book };
  const covers: SplitSnapshot["covers"] = [];
  for (const [role, field] of Object.entries(COVER_ROLES) as [CoverRole, keyof BookFields][]) {
    const value = book[field];
    if (typeof value === "string") {
      covers.push({ role, hash: await store(value) });
      (book as Record<string, unknown>)[field] = null;
    }
  }

  const chapters: SplitSnapshot["chapters"] = [];
  for (const [position, chapter] of snapshot.chapters.entries()) {
    const { content, ...meta } = chapter;
    chapters.push({
      chapterId: chapter.id,
      position,
      // A null content stays null: hashing it as "" would restore an empty string.
      hash: content === null || content === undefined ? null : await store(content),
      meta: JSON.stringify(meta),
    });
  }

  // chapterCount lets a reader refuse a Version whose manifest lost rows
  // instead of restoring a Book with no Chapters.
  return {
    bookJson: JSON.stringify({ book, chapters: [], chapterCount: chapters.length }),
    chapters,
    covers,
    blobs,
  };
}

async function existingHashes(db: DatabaseAdapter, hashes: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (let start = 0; start < hashes.length; start += HASH_LOOKUP_CHUNK) {
    const chunk = hashes.slice(start, start + HASH_LOOKUP_CHUNK);
    const rows = await db.select<{ hash: string }[]>(
      `SELECT hash FROM version_blobs WHERE hash IN (${chunk.map(() => "?").join(", ")})`,
      chunk
    );
    for (const row of rows) found.add(row.hash);
  }
  return found;
}

/** Content and manifest rows for one split Version; the Version row itself is the caller's. */
async function manifestStatements(
  db: DatabaseAdapter,
  versionId: string,
  split: SplitSnapshot
): Promise<AtomicStatement[]> {
  const present = await existingHashes(db, [...split.blobs.keys()]);
  const statements: AtomicStatement[] = [];
  for (const [hash, content] of split.blobs) {
    // OR IGNORE: the same text may already be stored under its hash.
    if (!present.has(hash)) {
      statements.push({
        sql: "INSERT OR IGNORE INTO version_blobs (hash, content) VALUES (?, ?)",
        params: [hash, content],
      });
    }
  }
  for (const chapter of split.chapters) {
    statements.push({
      sql: `INSERT INTO book_version_chapters (version_id, chapter_id, position, content_hash, meta)
            VALUES (?, ?, ?, ?, ?)`,
      params: [versionId, chapter.chapterId, chapter.position, chapter.hash, chapter.meta],
    });
  }
  for (const cover of split.covers) {
    statements.push({
      sql: "INSERT INTO book_version_assets (version_id, role, hash) VALUES (?, ?, ?)",
      params: [versionId, cover.role, cover.hash],
    });
  }
  return statements;
}

/**
 * The statements that store a new Version in the split format. The caller runs
 * them in one executeAtomic, inside the version write lock, so a sweep cannot
 * remove content between the lookup here and the insert.
 */
export async function insertSplitVersionStatements(
  db: DatabaseAdapter,
  row: VersionRowInput,
  snapshot: BookSnapshot,
  insertVerb: "INSERT" | "INSERT OR IGNORE" = "INSERT"
): Promise<AtomicStatement[]> {
  const split = await splitSnapshot(snapshot);
  return [
    {
      sql: `${insertVerb} INTO book_versions
              (id, book_id, name, snapshot, word_count, checksum, trigger_type, created_at, synced_at, format)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        row.id,
        row.bookId,
        row.name,
        split.bookJson,
        row.wordCount,
        row.checksum,
        row.triggerType,
        row.createdAt,
        row.syncedAt,
        VERSION_FORMAT_SPLIT,
      ],
    },
    ...(await manifestStatements(db, row.id, split)),
  ];
}

interface StoredVersionRow {
  book_id: string;
  snapshot: string;
  format: string | null;
}

/** Rebuilds the whole Book a Version saved, whatever format it is stored in. */
export async function readVersionSnapshot(
  db: DatabaseAdapter,
  versionId: string
): Promise<{ bookId: string; snapshot: BookSnapshot } | null> {
  const rows = await db.select<StoredVersionRow[]>(
    "SELECT book_id, snapshot, format FROM book_versions WHERE id = ?",
    [versionId]
  );
  const row = rows[0];
  if (!row) return null;

  const stored = JSON.parse(row.snapshot) as BookSnapshot;
  if (row.format !== VERSION_FORMAT_SPLIT) return { bookId: row.book_id, snapshot: stored };

  const chapterRows = await db.select<
    { meta: string; content_hash: string | null; content: string | null }[]
  >(
    `SELECT c.meta, c.content_hash, b.content
     FROM book_version_chapters c
     LEFT JOIN version_blobs b ON b.hash = c.content_hash
     WHERE c.version_id = ?
     ORDER BY c.position ASC`,
    [versionId]
  );
  const coverRows = await db.select<{ role: string; content: string | null }[]>(
    `SELECT a.role, b.content
     FROM book_version_assets a
     LEFT JOIN version_blobs b ON b.hash = a.hash
     WHERE a.version_id = ?`,
    [versionId]
  );

  const expected = (stored as { chapterCount?: number }).chapterCount;
  if (typeof expected === "number" && expected !== chapterRows.length) {
    throw new Error(`Version ${versionId} is missing Chapters`);
  }

  const book = { ...stored.book } as Record<string, unknown>;
  for (const cover of coverRows) {
    const field = COVER_ROLES[cover.role as CoverRole];
    if (!field) continue;
    // A missing blob would restore a Book without its Cover; refuse instead.
    if (cover.content === null)
      throw new Error(`Version ${versionId} is missing its ${cover.role}`);
    book[field] = cover.content;
  }

  const chapters = chapterRows.map((chapter) => {
    if (chapter.content_hash !== null && chapter.content === null) {
      throw new Error(`Version ${versionId} is missing Chapter text ${chapter.content_hash}`);
    }
    return {
      ...(JSON.parse(chapter.meta) as Omit<ChapterFields, "content">),
      content: chapter.content,
    };
  });

  return { bookId: row.book_id, snapshot: { book: book as BookFields, chapters } };
}

/**
 * Removes manifest rows whose Version is gone, then content no manifest
 * references. Every deletion runs it: web has no foreign keys, and desktop's
 * cascade only covers book_versions.
 */
export const SWEEP_VERSION_CONTENT: readonly AtomicStatement[] = [
  `DELETE FROM book_version_chapters
   WHERE NOT EXISTS (SELECT 1 FROM book_versions v WHERE v.id = book_version_chapters.version_id)`,
  `DELETE FROM book_version_assets
   WHERE NOT EXISTS (SELECT 1 FROM book_versions v WHERE v.id = book_version_assets.version_id)`,
  `DELETE FROM version_blobs
   WHERE NOT EXISTS (SELECT 1 FROM book_version_chapters c WHERE c.content_hash = version_blobs.hash)
     AND NOT EXISTS (SELECT 1 FROM book_version_assets a WHERE a.hash = version_blobs.hash)`,
];

/** Deletes the given Versions and everything only they referenced, in one transaction. */
export async function deleteVersionRows(
  db: DatabaseAdapter,
  ids: readonly string[]
): Promise<void> {
  if (ids.length === 0) return;
  const statements: AtomicStatement[] = [];
  for (let start = 0; start < ids.length; start += HASH_LOOKUP_CHUNK) {
    const chunk = ids.slice(start, start + HASH_LOOKUP_CHUNK);
    statements.push({
      sql: `DELETE FROM book_versions WHERE id IN (${chunk.map(() => "?").join(", ")})`,
      params: chunk,
    });
  }
  await db.executeAtomic([...statements, ...SWEEP_VERSION_CONTENT]);
}

/**
 * Rewrites up to `limit` inline Versions as split ones, each in its own
 * transaction, and returns how many rows it handled (converted, or kept
 * whole as legacy when they cannot be split). Resumable: a crash leaves
 * every row either inline or fully split, and the next call picks up the rest.
 */
export async function convertInlineVersions(db: DatabaseAdapter, limit: number): Promise<number> {
  const rows = await db.select<{ id: string; snapshot: string }[]>(
    `SELECT id, snapshot FROM book_versions WHERE format = ? ORDER BY created_at ASC, id ASC LIMIT ?`,
    [VERSION_FORMAT_INLINE, limit]
  );
  for (const row of rows) {
    try {
      const split = await splitSnapshot(JSON.parse(row.snapshot) as BookSnapshot);
      await db.executeAtomic([
        // Leftovers from a crash mid-way through an earlier attempt.
        { sql: "DELETE FROM book_version_chapters WHERE version_id = ?", params: [row.id] },
        { sql: "DELETE FROM book_version_assets WHERE version_id = ?", params: [row.id] },
        {
          sql: "UPDATE book_versions SET snapshot = ?, format = ? WHERE id = ?",
          params: [split.bookJson, VERSION_FORMAT_SPLIT, row.id],
        },
        ...(await manifestStatements(db, row.id, split)),
      ]);
    } catch (error) {
      // A row that cannot be split (unreadable JSON, duplicate or missing
      // Chapter ids) stays whole and readable as before, and never blocks the
      // rest of the upgrade on every launch. The failed transaction left it as it was.
      console.warn(`[versions] Version ${row.id} stays unconverted`, error);
      await db.execute("UPDATE book_versions SET format = ? WHERE id = ?", [
        VERSION_FORMAT_LEGACY,
        row.id,
      ]);
    }
  }
  return rows.length;
}

/** Bytes a Book's history takes: each stored text it references counted once, plus its Version rows. */
export async function historyBytes(db: DatabaseAdapter, bookId: string): Promise<number> {
  const content = await db.select<{ bytes: number | null }[]>(
    `SELECT SUM(LENGTH(CAST(content AS BLOB))) AS bytes FROM version_blobs
     WHERE hash IN (
       SELECT c.content_hash FROM book_version_chapters c
       JOIN book_versions v ON v.id = c.version_id WHERE v.book_id = ?
       UNION
       SELECT a.hash FROM book_version_assets a
       JOIN book_versions v ON v.id = a.version_id WHERE v.book_id = ?
     )`,
    [bookId, bookId]
  );
  const rows = await db.select<{ bytes: number | null }[]>(
    "SELECT SUM(LENGTH(CAST(snapshot AS BLOB))) AS bytes FROM book_versions WHERE book_id = ?",
    [bookId]
  );
  return Number(content[0]?.bytes ?? 0) + Number(rows[0]?.bytes ?? 0);
}
