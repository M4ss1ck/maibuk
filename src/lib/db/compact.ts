import type { DatabaseAdapter } from "@/lib/platform/types";

// SQLite never shrinks its file on its own: deleted rows become free pages it
// keeps. One desktop Library reached 2.8 GB while holding 77 MB of data.
export const COMPACT_MIN_FREE_BYTES = 32 * 1024 * 1024;
export const COMPACT_MIN_FREE_RATIO = 0.25;

export interface LibrarySize {
  pageSize: number;
  pageCount: number;
  freePages: number;
}

export interface CompactThresholds {
  minFreeBytes: number;
  minFreeRatio: number;
}

const DEFAULT_COMPACT_THRESHOLDS: CompactThresholds = {
  minFreeBytes: COMPACT_MIN_FREE_BYTES,
  minFreeRatio: COMPACT_MIN_FREE_RATIO,
};

export interface CompactResult {
  before: LibrarySize;
  after: LibrarySize;
}

async function pragmaNumber(db: DatabaseAdapter, name: string): Promise<number> {
  const rows = await db.select<Record<string, unknown>[]>(`PRAGMA ${name}`);
  return Number(rows[0]?.[name] ?? 0);
}

export async function readLibrarySize(db: DatabaseAdapter): Promise<LibrarySize> {
  return {
    pageSize: await pragmaNumber(db, "page_size"),
    pageCount: await pragmaNumber(db, "page_count"),
    freePages: await pragmaNumber(db, "freelist_count"),
  };
}

export function shouldCompact(
  { pageSize, pageCount, freePages }: LibrarySize,
  thresholds: Readonly<CompactThresholds> = DEFAULT_COMPACT_THRESHOLDS
): boolean {
  if (pageCount === 0) return false;
  return (
    freePages * pageSize >= thresholds.minFreeBytes &&
    freePages / pageCount >= thresholds.minFreeRatio
  );
}

/**
 * Rewrites the Library without its free pages when they are worth the time.
 * Runs while the Library opens, before anything else reads or writes it.
 * VACUUM is atomic, so a failure leaves the file as it was; it never stops
 * the Library from opening.
 */
export async function compactLibrary(
  db: DatabaseAdapter,
  thresholds: Readonly<CompactThresholds> = DEFAULT_COMPACT_THRESHOLDS
): Promise<CompactResult | null> {
  try {
    const before = await readLibrarySize(db);
    if (!shouldCompact(before, thresholds)) return null;
    await db.execute("VACUUM");
    // In WAL mode the file shrinks only once the rewrite is checkpointed.
    await db.select("PRAGMA wal_checkpoint(TRUNCATE)");
    const after = await readLibrarySize(db);
    console.info(
      `[db] compacted the Library from ${before.pageCount * before.pageSize} to ${after.pageCount * after.pageSize} bytes`
    );
    return { before, after };
  } catch (error) {
    console.warn("[db] compacting the Library failed; it stays as it was", error);
    return null;
  }
}
