// Narrow write path for Notes (ADR 0005): every mutation of the notes table
// goes through here — normalize, persist, return the stored Note, emit the
// Change. Stores, Version Restore, Import, and the sync serializer all call
// these; nobody hand-signals. View updates stay in the Zustand store.
//
// Each statement auto-commits on its own (the Tauri pool cannot hold
// BEGIN/COMMIT across calls), so multi-write paths emit for data already
// persisted before rethrowing a partial failure.

import { getDatabase } from "@/lib/db";
import { recordTombstone } from "@/features/sync/tombstones";
import { emitChange, type ChangeKind, type ChangeOrigin } from "@/features/sync/change-feed";
import { reindexSource } from "@/features/links/link-index";
import type {
  CreateNoteInput,
  Note,
  ReorderNoteItem,
  UpdateNoteInput,
} from "@/features/notes/types";
import type { NoteSnapshot } from "@/features/sync/types";

function generateId(): string {
  return crypto.randomUUID();
}

function parseTags(raw: unknown): string[] {
  if (typeof raw !== "string" || raw.length === 0) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

function parseCollapsedHeadings(raw: unknown): string[] {
  if (typeof raw !== "string" || raw.length === 0) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function toNote(row: Record<string, unknown>): Note {
  return {
    id: row.id as string,
    bookId: row.book_id as string | null | undefined,
    title: row.title as string,
    content: (row.content as string) ?? "",
    language: (row.language as string | null) ?? "en",
    tags: parseTags(row.tags),
    pinned: Boolean(row.pinned),
    order: row.order as number,
    wordCount: (row.word_count as number) ?? 0,
    collapsedHeadings: parseCollapsedHeadings(row.collapsed_headings),
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
    // Fall back to updated_at for rows created before the column existed.
    contentUpdatedAt: (row.content_updated_at as number | null) ?? (row.updated_at as number),
  };
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

async function readNote(id: string): Promise<Note | null> {
  const db = await getDatabase();
  const rows = await db.select<Record<string, unknown>[]>("SELECT * FROM notes WHERE id = ?", [
    id,
  ]);
  return rows.length > 0 ? toNote(rows[0]) : null;
}

export async function createNoteRow(
  input: CreateNoteInput,
  origin: ChangeOrigin
): Promise<Note> {
  const db = await getDatabase();
  const id = generateId();
  const now = nowSeconds();

  const orderResult = await db.select<{ max_order: number | null }[]>(
    'SELECT MAX("order") as max_order FROM notes'
  );
  const order = input.order ?? (orderResult[0]?.max_order ?? -1) + 1;

  const note: Note = {
    id,
    bookId: input.bookId ?? null,
    title: input.title,
    content: input.content ?? "",
    language: input.language ?? "en",
    tags: input.tags ?? [],
    pinned: input.pinned ?? false,
    order,
    wordCount: input.wordCount ?? 0,
    collapsedHeadings: input.collapsedHeadings ?? [],
    createdAt: now,
    updatedAt: now,
    contentUpdatedAt: now,
  };

  await db.execute(
    `INSERT INTO notes (id, book_id, title, content, language, tags, pinned, "order", word_count, collapsed_headings, created_at, updated_at, content_updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      note.id,
      note.bookId ?? null,
      note.title,
      note.content,
      note.language,
      JSON.stringify(note.tags),
      note.pinned ? 1 : 0,
      note.order,
      note.wordCount,
      JSON.stringify(note.collapsedHeadings),
      note.createdAt,
      note.updatedAt,
      note.contentUpdatedAt,
    ]
  );

  let stored: Note | null = null;
  try {
    stored = await readNote(id);
  } catch {
    stored = null;
  }
  // A read-back failure after the durable write still emits below.
  await emitChange({ entity: "note", id, origin, kind: "content" });
  return stored ?? note;
}

/**
 * Resolves with the note as stored, or null when it no longer exists.
 * Title/content edits are content Changes (they move Last Edited);
 * tagging, pinning, filing, language, and reordering are metadata Changes.
 * updated_at always bumps as the sync conflict clock.
 */
export async function updateNoteRow(
  input: UpdateNoteInput,
  origin: ChangeOrigin
): Promise<Note | null> {
  const db = await getDatabase();
  const rows = await db.select<Record<string, unknown>[]>("SELECT * FROM notes WHERE id = ?", [
    input.id,
  ]);
  if (rows.length === 0) return null;
  const existing = toNote(rows[0]);
  const now = nowSeconds();
  const contentChanged =
    (input.title !== undefined && input.title !== existing.title) ||
    (input.content !== undefined && input.content !== existing.content);
  const kind: ChangeKind = contentChanged ? "content" : "metadata";
  const updated: Note = {
    ...existing,
    ...input,
    updatedAt: now,
    contentUpdatedAt: contentChanged ? now : existing.contentUpdatedAt,
  };

  await db.execute(
    `UPDATE notes SET book_id = ?, title = ?, content = ?, language = ?, tags = ?, pinned = ?, "order" = ?, word_count = ?, collapsed_headings = ?, updated_at = ?, content_updated_at = ? WHERE id = ?`,
    [
      updated.bookId ?? null,
      updated.title,
      updated.content,
      updated.language,
      JSON.stringify(updated.tags),
      updated.pinned ? 1 : 0,
      updated.order,
      updated.wordCount,
      JSON.stringify(updated.collapsedHeadings),
      updated.updatedAt,
      updated.contentUpdatedAt,
      updated.id,
    ]
  );

  // Capture this save's stored result before unrelated awaits (reindex,
  // emission): a later save must not replace it with newer content. A
  // read-back failure after the durable write still emits below.
  let stored: Note | null = null;
  try {
    stored = await readNote(updated.id);
  } catch {
    stored = null;
  }
  const own: Note = stored ?? updated;

  if (input.content !== undefined) {
    // The link index is derived data: a failure there must not turn a
    // persisted save into a failure.
    await reindexSource({
      sourceType: "note",
      sourceId: updated.id,
      contentHtml: updated.content,
    }).catch((error) => console.warn("[notes] link reindex failed:", error));
  }
  await emitChange({ entity: "note", id: updated.id, origin, kind });
  return own;
}

/** Local delete: records a tombstone so sync carries the deletion. */
export async function deleteNoteRow(id: string, origin: ChangeOrigin): Promise<void> {
  const db = await getDatabase();
  const rows = await db.select<{ title: string }[]>("SELECT title FROM notes WHERE id = ?", [id]);
  if (rows.length > 0) {
    await recordTombstone({
      entityType: "note",
      entityId: id,
      title: rows[0].title,
    });
  }
  await db.execute("DELETE FROM notes WHERE id = ?", [id]);
  await db.execute("DELETE FROM links WHERE source_id = ?", [id]).catch(() => {});
  await emitChange({ entity: "note", id, origin, kind: "content" });
}

/**
 * Removal of a note deleted on another device. Records no tombstone (the
 * server already has the deletion, and a tombstone would block pulling the
 * note back if another device restores it).
 */
export async function removeNoteRow(id: string, origin: ChangeOrigin): Promise<void> {
  const db = await getDatabase();
  await db.execute("DELETE FROM notes WHERE id = ?", [id]);
  await db.execute("DELETE FROM links WHERE source_id = ?", [id]).catch(() => {});
  await emitChange({ entity: "note", id, origin, kind: "content" });
}

export async function reorderNoteRows(
  orderedItems: string[] | ReorderNoteItem[],
  origin: ChangeOrigin
): Promise<void> {
  const db = await getDatabase();
  const now = nowSeconds();
  const ordered = orderedItems.map((item) =>
    typeof item === "string" ? { id: item, pinned: undefined } : item
  );

  // Only rows that actually persisted earn a notification: zero durable
  // writes means zero Changes, and unpersisted ids are never announced.
  const persistedIds: string[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const item = ordered[i];
    let affected = 0;
    try {
      const result =
        item.pinned === undefined
          ? await db.execute('UPDATE notes SET "order" = ?, updated_at = ? WHERE id = ?', [
              i,
              now,
              item.id,
            ])
          : await db.execute(
              'UPDATE notes SET "order" = ?, pinned = ?, updated_at = ? WHERE id = ?',
              [i, item.pinned ? 1 : 0, now, item.id]
            );
      affected = result.rowsAffected ?? 0;
    } catch (error) {
      for (const id of persistedIds) {
        await emitChange({ entity: "note", id, origin, kind: "metadata" });
      }
      throw error;
    }
    if (affected > 0) persistedIds.push(item.id);
  }

  for (const id of persistedIds) {
    await emitChange({ entity: "note", id, origin, kind: "metadata" });
  }
}

/**
 * Collapsed headings are editor view state, invisible to sync (the checksum
 * normalizes them out), so saving them emits no Change.
 */
export async function saveCollapsedHeadingsRow(
  noteId: string,
  collapsedHeadings: string[]
): Promise<void> {
  const db = await getDatabase();
  await db.execute("UPDATE notes SET collapsed_headings = ? WHERE id = ?", [
    JSON.stringify(collapsedHeadings),
    noteId,
  ]);
}

/**
 * Replace the local note row with a synced snapshot (pull or local restore).
 * The device's collapsed headings win over the snapshot's: they are view
 * state, not content. A metadata-only change preserves the existing Last
 * Edited instead of adopting the snapshot's clock; legacy snapshots without
 * contentUpdatedAt fall back to updatedAt only when the content actually
 * changed. Resolves with the note as stored.
 */
export async function applyNoteSnapshotData(
  snapshot: NoteSnapshot,
  origin: ChangeOrigin
): Promise<Note> {
  const db = await getDatabase();
  const { note } = snapshot;
  const existingRows = await db.select<Record<string, unknown>[]>(
    "SELECT * FROM notes WHERE id = ?",
    [note.id]
  );
  const existing = existingRows.length > 0 ? toNote(existingRows[0]) : null;
  const collapsedHeadings =
    existing !== null
      ? JSON.stringify(existing.collapsedHeadings)
      : (note.collapsedHeadings ?? "[]");

  // Classify against the current row so a metadata-only Pull keeps its kind
  // and timestamp. A fresh row (or a local restore, which reads as a new
  // local edit) is always content.
  const now = nowSeconds();
  let kind: ChangeKind = "content";
  const updatedAt = origin === "local" ? now : note.updatedAt;
  let contentUpdatedAt = origin === "local" ? now : (note.contentUpdatedAt ?? note.updatedAt);
  if (existing !== null && origin !== "local") {
    const changed =
      note.title !== existing.title || (note.content ?? "") !== existing.content;
    kind = changed ? "content" : "metadata";
    if (!changed) contentUpdatedAt = existing.contentUpdatedAt;
  }

  await db.execute(
    `INSERT OR REPLACE INTO notes (
      id, book_id, title, content, language, tags, pinned, "order", word_count, collapsed_headings, created_at, updated_at, content_updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      note.id,
      note.bookId ?? null,
      note.title,
      note.content,
      note.language ?? "en",
      note.tags,
      note.pinned ? 1 : 0,
      note.order,
      note.wordCount,
      collapsedHeadings,
      note.createdAt,
      updatedAt,
      contentUpdatedAt,
    ]
  );

  // Capture this apply's stored result before the emission's awaits: a later
  // save must not replace it. A read-back failure after the durable write
  // still emits below.
  let stored: Note | null = null;
  try {
    stored = await readNote(note.id);
  } catch {
    stored = null;
  }
  const own: Note =
    stored ??
    toNote({
      id: note.id,
      book_id: note.bookId ?? null,
      title: note.title,
      content: note.content,
      language: note.language ?? "en",
      tags: note.tags,
      pinned: note.pinned ? 1 : 0,
      order: note.order,
      word_count: note.wordCount,
      collapsed_headings: collapsedHeadings,
      created_at: note.createdAt,
      updated_at: updatedAt,
      content_updated_at: contentUpdatedAt,
    });
  await emitChange({ entity: "note", id: note.id, origin, kind });
  return own;
}
