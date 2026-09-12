import { parseSqlStatements } from "@/lib/db/sql-parser";
import type { BookSnapshot, NoteSnapshot } from "@/features/sync/types";

// Pure CPU-bound helpers shared by the sync codec worker and its
// no-Worker fallback. No database access here — only JSON encode/decode
// loops and SQL text scanning. Byte/base64 loops live in crypto.ts (single
// source of truth) and are re-exported for worker/fallback convenience.

// Re-exported (not duplicated): identical semantics to crypto.ts. Note for
// tests that mock `@/features/sync/crypto` — pass these two through via
// `importOriginal`, otherwise the codec fallback sees `undefined`.
export { uint8ArrayToBase64, base64ToUint8Array } from "@/features/sync/crypto";

export function stringifySnapshot(value: unknown): string {
  return JSON.stringify(value);
}

export function parseJsonValue(text: string): unknown {
  return JSON.parse(text);
}

export function normalizeNoteSnapshotJson(json: string): string {
  const snapshot = JSON.parse(json) as NoteSnapshot;
  // contentUpdatedAt is derived from content (already in the checksum) and is
  // absent from snapshots pushed by older clients. Drop the key entirely —
  // rather than nulling it — so the checksum byte-matches a legacy snapshot and
  // unchanged notes don't hit the conflict path on the first sync after upgrade.
  const { contentUpdatedAt: _contentUpdatedAt, ...note } = snapshot.note;
  return JSON.stringify({
    ...snapshot,
    note: {
      language: "en",
      ...note,
      collapsedHeadings: null,
    },
  });
}

export function normalizeBookSnapshotJson(json: string): string {
  const snapshot = JSON.parse(json) as BookSnapshot;
  // Per-device navigation state: opening a book stamps lastOpenedAt, switching
  // chapters stamps lastChapterId and the book's updatedAt. None of it is
  // content, and counting it made merely opening a book look like a local edit
  // (turning every incoming change into a conflict). Content edits still change
  // the checksum through the book fields and each chapter's own updatedAt.
  const {
    lastOpenedAt: _lastOpenedAt,
    lastChapterId: _lastChapterId,
    updatedAt: _updatedAt,
    ...book
  } = snapshot.book;
  return JSON.stringify({ ...snapshot, book });
}

const INSERT_PATTERN = /^INSERT\s/i;

export function dumpHasDataSql(sql: string): boolean {
  return parseSqlStatements(sql).some((s) => INSERT_PATTERN.test(s.trim()));
}

// Copy bytes into a freshly owned buffer, respecting the input view's
// byteOffset/length. Never detaches the caller's buffer.
export function toOwnedBuffer(data: Uint8Array): ArrayBuffer {
  return data.slice().buffer as ArrayBuffer;
}
