/**
 * The whole-index rebuild, as a background job.
 *
 * It reads the Library in pages, yields between pages so typing never waits,
 * and reports whether it is running. It runs after a schema change that
 * requires it, after a Restore, and on first launch when the index is empty
 * but the Library is not.
 *
 * The Tutorial Library has its own in-memory database and no rebuild: the job
 * skips while the Tutorial is active, like every other Library background job.
 *
 * The load is one bulk pass (#639). The FTS triggers stand down for its
 * duration: they would re-index the whole Library one row at a time, and the
 * final `rebuild` command recreates the index from `search_text` once instead.
 * Saving during a rebuild still works: every save writes `search_text`, the
 * sweep after the page loads re-reads every item saved since the pass began,
 * and the final `rebuild` indexes whatever the table holds. The in-progress
 * marker and the dropped triggers are what a later launch looks at to finish
 * an interrupted pass.
 */

import type { AtomicStatement } from "@/lib/platform/types";
import { getDatabase } from "@/lib/db";
import { isTutorialLibraryActive } from "@/features/tutorial/library-switch";
import {
  SEARCH_FTS_DELETE_ALL,
  SEARCH_FTS_REBUILD,
  SEARCH_REBUILD_MARKER_KEY,
  SEARCH_TEXT_TABLE,
  createSearchTriggerStatements,
  dropSearchTriggerStatements,
} from "@/features/search/schema";
import {
  bookFieldBlocks,
  canvasBlocks,
  chapterContentBlocks,
  noteContentBlocks,
} from "@/features/search/extract";
import {
  bookSearchStatements,
  canvasSearchStatements,
  chapterSearchStatements,
  noteSearchStatements,
  rebuildSearchRowsStatements,
} from "@/features/search/statements";

/** Bumped whenever a stored index no longer matches what extraction produces. */
export const SEARCH_INDEX_VERSION = 2;

export const SEARCH_INDEX_VERSION_KEY = "search_index_version";

const PAGE_SIZE = 20;

type StatusListener = () => void;

let rebuilding = false;
let currentRun: Promise<void> | null = null;
let restartRequested = false;
let listeners = new Set<StatusListener>();

function notify(): void {
  for (const listener of [...listeners]) listener();
}

function setRebuilding(value: boolean): void {
  if (rebuilding === value) return;
  rebuilding = value;
  notify();
}

export function isSearchIndexRebuilding(): boolean {
  return rebuilding;
}

/** Calls the listener whenever a rebuild starts or finishes. */
export function subscribeSearchIndexStatus(listener: StatusListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function settingStatement(key: string, value: string): AtomicStatement {
  return {
    sql: `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    params: [key, value, nowSeconds()],
  };
}

interface BookPageRow {
  rowid: number;
  id: string;
  title: string;
  subtitle: string | null;
  description: string | null;
}

interface ChapterPageRow {
  rowid: number;
  id: string;
  book_id: string;
  content: string | null;
}

interface NotePageRow {
  rowid: number;
  id: string;
  book_id: string | null;
  content: string | null;
}

interface CanvasPageRow {
  rowid: number;
  id: string;
  doc: string;
}

async function rebuildBooks(): Promise<void> {
  const db = await getDatabase();
  let after = 0;
  for (;;) {
    const page = await db.select<BookPageRow[]>(
      `SELECT rowid, id, title, subtitle, description FROM books
       WHERE rowid > ? ORDER BY rowid LIMIT ?`,
      [after, PAGE_SIZE]
    );
    if (page.length === 0) break;
    const now = nowSeconds();
    await db.executeAtomic(
      rebuildSearchRowsStatements(
        page.map((row) => ({
          itemKind: "book",
          itemId: row.id,
          bookId: row.id,
          blocks: bookFieldBlocks(row),
          updatedAt: now,
        }))
      )
    );
    after = page[page.length - 1].rowid;
    if (page.length < PAGE_SIZE) break;
    await yieldToEventLoop();
  }
}

async function rebuildChapters(): Promise<void> {
  const db = await getDatabase();
  let after = 0;
  for (;;) {
    const page = await db.select<ChapterPageRow[]>(
      `SELECT rowid, id, book_id, content FROM chapters
       WHERE rowid > ? ORDER BY rowid LIMIT ?`,
      [after, PAGE_SIZE]
    );
    if (page.length === 0) break;
    const now = nowSeconds();
    await db.executeAtomic(
      rebuildSearchRowsStatements(
        page.map((row) => ({
          itemKind: "chapter",
          itemId: row.id,
          bookId: row.book_id,
          blocks: chapterContentBlocks(row.content),
          updatedAt: now,
        }))
      )
    );
    after = page[page.length - 1].rowid;
    if (page.length < PAGE_SIZE) break;
    await yieldToEventLoop();
  }
}

async function rebuildNotes(): Promise<void> {
  const db = await getDatabase();
  let after = 0;
  for (;;) {
    const page = await db.select<NotePageRow[]>(
      `SELECT rowid, id, book_id, content FROM notes
       WHERE rowid > ? ORDER BY rowid LIMIT ?`,
      [after, PAGE_SIZE]
    );
    if (page.length === 0) break;
    const now = nowSeconds();
    await db.executeAtomic(
      rebuildSearchRowsStatements(
        page.map((row) => ({
          itemKind: "note",
          itemId: row.id,
          bookId: row.book_id,
          blocks: noteContentBlocks(row.content),
          updatedAt: now,
        }))
      )
    );
    after = page[page.length - 1].rowid;
    if (page.length < PAGE_SIZE) break;
    await yieldToEventLoop();
  }
}

function parseCanvasDoc(raw: unknown): unknown {
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

async function rebuildCanvases(): Promise<void> {
  const db = await getDatabase();
  let after = 0;
  for (;;) {
    const page = await db.select<CanvasPageRow[]>(
      `SELECT rowid, id, doc FROM canvases
       WHERE rowid > ? ORDER BY rowid LIMIT ?`,
      [after, PAGE_SIZE]
    );
    if (page.length === 0) break;
    const now = nowSeconds();
    await db.executeAtomic(
      rebuildSearchRowsStatements(
        page.map((row) => ({
          itemKind: "canvas",
          itemId: row.id,
          bookId: null,
          blocks: canvasBlocks(parseCanvasDoc(row.doc)),
          updatedAt: now,
        }))
      )
    );
    after = page[page.length - 1].rowid;
    if (page.length < PAGE_SIZE) break;
    await yieldToEventLoop();
  }
}

/**
 * Re-reads every item saved since the pass began. A page read before a save
 * carries older text, and its write can land after the save's own; rewriting
 * the saved items from the Library as it is now removes that ordering hazard.
 * Every save in between also wrote `search_text`, so the final FTS rebuild
 * indexes it even when this sweep did not need to.
 */
async function sweepSavedItems(since: number): Promise<void> {
  const db = await getDatabase();
  const [books, chapters, notes, canvases] = await Promise.all([
    db.select<BookPageRow[]>(
      `SELECT rowid, id, title, subtitle, description FROM books
       WHERE updated_at >= ? ORDER BY rowid`,
      [since]
    ),
    db.select<ChapterPageRow[]>(
      `SELECT rowid, id, book_id, content FROM chapters
       WHERE updated_at >= ? ORDER BY rowid`,
      [since]
    ),
    db.select<NotePageRow[]>(
      `SELECT rowid, id, book_id, content FROM notes
       WHERE updated_at >= ? ORDER BY rowid`,
      [since]
    ),
    db.select<CanvasPageRow[]>(
      `SELECT rowid, id, doc FROM canvases
       WHERE updated_at >= ? ORDER BY rowid`,
      [since]
    ),
  ]);
  if (books.length + chapters.length + notes.length + canvases.length === 0) return;

  const now = nowSeconds();
  await db.executeAtomic([
    ...books.flatMap((row) =>
      bookSearchStatements(
        { id: row.id, title: row.title, subtitle: row.subtitle, description: row.description },
        now
      )
    ),
    ...chapters.flatMap((row) =>
      chapterSearchStatements({ id: row.id, bookId: row.book_id, content: row.content }, now)
    ),
    ...notes.flatMap((row) =>
      noteSearchStatements({ id: row.id, bookId: row.book_id, content: row.content }, now)
    ),
    ...canvases.flatMap((row) =>
      canvasSearchStatements({ id: row.id, doc: parseCanvasDoc(row.doc) }, now)
    ),
  ]);
}

/**
 * Best effort after a failed pass: recreate the FTS index from what the table
 * holds, bring the triggers back, and record a stale version so the next launch
 * starts over. If even this fails the marker stays set and the launch check
 * answers it.
 */
async function closeInterruptedRebuild(): Promise<void> {
  try {
    const db = await getDatabase();
    await db.executeAtomic([
      SEARCH_FTS_REBUILD,
      ...createSearchTriggerStatements(),
      settingStatement(SEARCH_REBUILD_MARKER_KEY, "0"),
      settingStatement(SEARCH_INDEX_VERSION_KEY, "0"),
    ]);
  } catch (error) {
    console.warn("[search] closing an interrupted index rebuild failed:", error);
  }
}

async function rebuildOnce(): Promise<void> {
  // The Tutorial Library is in memory and never searched; a rebuild started
  // for the author's Library must not read sample data either.
  if (isTutorialLibraryActive()) return;

  const db = await getDatabase();
  // Anything saved from here on is re-read by the sweep at the end.
  const startedAt = nowSeconds() - 1;

  // One batch: mark the pass, stand the FTS triggers down, empty the content
  // table, and empty the FTS index the cheap way instead of one delete entry
  // per row. Clearing first keeps the rebuild idempotent: rows for items
  // deleted while the app was closed do not survive.
  await db.executeAtomic([
    settingStatement(SEARCH_REBUILD_MARKER_KEY, "1"),
    ...dropSearchTriggerStatements(),
    SEARCH_FTS_DELETE_ALL,
    `DELETE FROM ${SEARCH_TEXT_TABLE}`,
  ]);

  try {
    await rebuildBooks();
    await rebuildChapters();
    await rebuildNotes();
    await rebuildCanvases();
    await sweepSavedItems(startedAt);

    // One batch: FTS reindexes the whole content table in one pass, the
    // triggers come back, the marker clears, and the version says the index is
    // current. A save lands before this batch or after it, never inside it.
    await db.executeAtomic([
      SEARCH_FTS_REBUILD,
      ...createSearchTriggerStatements(),
      settingStatement(SEARCH_REBUILD_MARKER_KEY, "0"),
      settingStatement(SEARCH_INDEX_VERSION_KEY, String(SEARCH_INDEX_VERSION)),
    ]);
  } catch (error) {
    await closeInterruptedRebuild();
    throw error;
  }
}

async function rebuildLoop(): Promise<void> {
  do {
    restartRequested = false;
    await rebuildOnce();
    // A Restore (or another caller) asked again while this pass was running:
    // that pass may have read pre-Restore rows, so run after it.
  } while (restartRequested);
}

/**
 * Starts a rebuild unless one is already running. A second request while one
 * runs asks for another pass once it finishes, which is what a Restore needs.
 */
export function requestSearchRebuild(): Promise<void> {
  if (currentRun) {
    restartRequested = true;
    // If the running pass already checked the flag before this request
    // arrived, start one more after it settles; a Restore must never be
    // answered by a pass that began before its data landed.
    return currentRun.then(() => (restartRequested ? requestSearchRebuild() : undefined));
  }
  setRebuilding(true);
  currentRun = rebuildLoop().finally(() => {
    currentRun = null;
    setRebuilding(false);
  });
  return currentRun;
}

/** Resolves once no rebuild is running or waiting. */
export async function awaitSearchIndexRebuild(): Promise<void> {
  while (currentRun) {
    await currentRun;
  }
}

interface IndexState {
  version: number | null;
  /** A rebuild was interrupted before it restored the triggers. */
  interrupted: boolean;
}

async function readIndexState(): Promise<IndexState> {
  const db = await getDatabase();
  const rows = await db.select<{ key: string; value: string }[]>(
    "SELECT key, value FROM settings WHERE key IN (?, ?)",
    [SEARCH_INDEX_VERSION_KEY, SEARCH_REBUILD_MARKER_KEY]
  );
  const values = new Map(rows.map((row) => [row.key, row.value]));
  const rawVersion = values.get(SEARCH_INDEX_VERSION_KEY);
  const version = rawVersion === undefined ? Number.NaN : Number.parseInt(rawVersion, 10);
  return {
    version: Number.isFinite(version) ? version : null,
    interrupted: values.get(SEARCH_REBUILD_MARKER_KEY) === "1",
  };
}

async function countRows(sql: string): Promise<number> {
  const db = await getDatabase();
  const rows = await db.select<{ count: number }[]>(sql);
  return rows[0]?.count ?? 0;
}

/**
 * The launch check: rebuild when the stored index version is not the current
 * one (a schema change that needs it, or the first launch after the feature
 * shipped), when the last pass was interrupted (its marker is still set and
 * the triggers may have been down for saves ever since), and when the index is
 * empty while the Library is not.
 */
export async function ensureSearchIndex(): Promise<void> {
  if (isTutorialLibraryActive()) return;

  const state = await readIndexState();
  if (state.interrupted || state.version !== SEARCH_INDEX_VERSION) {
    await requestSearchRebuild();
    return;
  }

  const [indexed, library] = await Promise.all([
    countRows("SELECT COUNT(*) AS count FROM search_text"),
    countRows(`SELECT (
      (SELECT COUNT(*) FROM books) +
      (SELECT COUNT(*) FROM chapters) +
      (SELECT COUNT(*) FROM notes) +
      (SELECT COUNT(*) FROM canvases)
    ) AS count`),
  ]);

  if (indexed === 0 && library > 0) {
    await requestSearchRebuild();
  }
}

/**
 * Wires the background check at launch. Returns an uninstaller for symmetry
 * with the other installers; the job holds no timer between runs.
 */
export function installSearchIndex(): () => void {
  void ensureSearchIndex().catch((error) => {
    console.warn("[search] building the Library index failed:", error);
  });
  return () => {};
}

/** Test hook: forgets an in-flight run and its listeners. */
export function resetSearchIndexForTests(): void {
  rebuilding = false;
  currentRun = null;
  restartRequested = false;
  listeners = new Set();
}
