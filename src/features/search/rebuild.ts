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
 */

import { getDatabase } from "@/lib/db";
import { isTutorialLibraryActive } from "@/features/tutorial/library-switch";
import {
  bookSearchStatements,
  canvasSearchStatements,
  chapterSearchStatements,
  noteSearchStatements,
} from "@/features/search/statements";

/** Bumped whenever a stored index no longer matches what extraction produces. */
export const SEARCH_INDEX_VERSION = 1;

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

async function setIndexVersion(version: number): Promise<void> {
  const db = await getDatabase();
  const now = Math.floor(Date.now() / 1000);
  await db.execute(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [SEARCH_INDEX_VERSION_KEY, String(version), now]
  );
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
    const now = Math.floor(Date.now() / 1000);
    await db.executeAtomic(
      page.flatMap((row) =>
        bookSearchStatements(
          {
            id: row.id,
            title: row.title,
            subtitle: row.subtitle,
            description: row.description,
          },
          now
        )
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
    const now = Math.floor(Date.now() / 1000);
    await db.executeAtomic(
      page.flatMap((row) =>
        chapterSearchStatements(
          { id: row.id, bookId: row.book_id, content: row.content },
          now
        )
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
    const now = Math.floor(Date.now() / 1000);
    await db.executeAtomic(
      page.flatMap((row) =>
        noteSearchStatements(
          { id: row.id, bookId: row.book_id, content: row.content },
          now
        )
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
    const now = Math.floor(Date.now() / 1000);
    await db.executeAtomic(
      page.flatMap((row) =>
        canvasSearchStatements({ id: row.id, doc: parseCanvasDoc(row.doc) }, now)
      )
    );
    after = page[page.length - 1].rowid;
    if (page.length < PAGE_SIZE) break;
    await yieldToEventLoop();
  }
}

async function rebuildOnce(): Promise<void> {
  // The Tutorial Library is in memory and never searched; a rebuild started
  // for the author's Library must not read sample data either.
  if (isTutorialLibraryActive()) return;

  const db = await getDatabase();
  // Clearing first keeps a rebuild idempotent: rows for items deleted while
  // the app was closed do not survive, and the FTS index follows the delete
  // triggers.
  await db.execute("DELETE FROM search_text");

  await rebuildBooks();
  await rebuildChapters();
  await rebuildNotes();
  await rebuildCanvases();

  await setIndexVersion(SEARCH_INDEX_VERSION);
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

async function readIndexVersion(): Promise<number | null> {
  const db = await getDatabase();
  const rows = await db.select<{ value: string }[]>(
    "SELECT value FROM settings WHERE key = ?",
    [SEARCH_INDEX_VERSION_KEY]
  );
  if (rows.length === 0) return null;
  const version = Number.parseInt(rows[0].value, 10);
  return Number.isFinite(version) ? version : null;
}

async function countRows(sql: string): Promise<number> {
  const db = await getDatabase();
  const rows = await db.select<{ count: number }[]>(sql);
  return rows[0]?.count ?? 0;
}

/**
 * The launch check: rebuild when the stored index version is not the current
 * one (a schema change that needs it, or the first launch after the feature
 * shipped), and when the index is empty while the Library is not.
 */
export async function ensureSearchIndex(): Promise<void> {
  if (isTutorialLibraryActive()) return;

  const version = await readIndexVersion();
  if (version !== SEARCH_INDEX_VERSION) {
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
