// Narrow write path for Canvases (ADR 0005): every mutation of the
// canvases table goes through here — normalize, persist, return the stored
// Canvas, emit the Change. The Zustand store, the sync serializer, and the
// Canvas page's Edit Session all call these; nobody hand-signals.
//
// Each statement auto-commits on its own (the Tauri pool cannot hold
// BEGIN/COMMIT across calls).
//
// The viewport (pan and zoom) is device-local (ADR 0004): it lives in the
// reading-position module, never in the synced row. Writers strip it before
// persisting, so a stored doc carries content only; readers overlay the
// device's viewport on top. A pulled doc never carries a viewport either.

import { getDatabase } from "@/lib/db";
import { assertWritableId } from "@/features/tutorial/library-switch";
import { recordTombstone } from "@/features/sync/tombstones";
import { emitChange, type ChangeKind, type ChangeOrigin } from "@/features/sync/change-feed";
import { CURRENT_CANVAS_SCHEMA_VERSION } from "@/lib/canvas/defaultDoc";
import {
  createDefaultCanvasDoc,
  type Canvas,
  type CanvasDoc,
  type CreateCanvasInput,
  type ReorderCanvasItem,
  type UpdateCanvasInput,
} from "@/features/canvas/types";
import type { CanvasSnapshot } from "@/features/sync/types";

function generateId(): string {
  return crypto.randomUUID();
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

/** The doc as stored: content only, without the device-local viewport. */
export function stripViewportForStorage(doc: CanvasDoc): string {
  const { viewport: _viewport, ...content } = doc;
  return JSON.stringify(content);
}

/** Content identity of a doc, ignoring the viewport. */
function docContentKey(doc: unknown): string {
  if (doc !== null && typeof doc === "object" && !Array.isArray(doc)) {
    const { viewport: _viewport, ...content } = doc as Record<string, unknown>;
    return JSON.stringify(content);
  }
  return JSON.stringify(doc);
}

function schemaVersionOf(doc: unknown): number | null {
  if (doc !== null && typeof doc === "object" && !Array.isArray(doc)) {
    const version = (doc as Record<string, unknown>).schemaVersion;
    if (typeof version === "number" && Number.isInteger(version)) return version;
  }
  return null;
}

/** True when this client must never push the doc back (ADR 0006). */
export function isReadOnlySchemaVersion(doc: unknown): boolean {
  const version = schemaVersionOf(doc);
  return version !== null && version > CURRENT_CANVAS_SCHEMA_VERSION;
}

function toCanvas(row: Record<string, unknown>, doc: CanvasDoc): Canvas {
  return {
    id: row.id as string,
    title: row.title as string,
    doc,
    pinned: Boolean(row.pinned),
    order: row.order as number,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
    contentUpdatedAt: (row.content_updated_at as number | null) ?? (row.updated_at as number),
  };
}

async function readCanvasRow(id: string): Promise<Record<string, unknown> | null> {
  const db = await getDatabase();
  const rows = await db.select<Record<string, unknown>[]>("SELECT * FROM canvases WHERE id = ?", [
    id,
  ]);
  return rows.length > 0 ? rows[0] : null;
}

/** Read the stored canvas, or null when it no longer exists. */
export async function fetchStoredCanvas(id: string): Promise<Canvas | null> {
  const row = await readCanvasRow(id);
  if (!row) return null;
  return toCanvas(row, parseStoredDoc(row.doc));
}

/** Best-effort parse of a stored doc; corrupt rows read as the default doc. */
function parseStoredDoc(raw: unknown): CanvasDoc {
  if (typeof raw !== "string" || raw.trim().length === 0) return createDefaultCanvasDoc();
  try {
    const parsed = JSON.parse(raw) as Partial<CanvasDoc>;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return createDefaultCanvasDoc();
    }
    return { ...createDefaultCanvasDoc(), ...parsed };
  } catch {
    return createDefaultCanvasDoc();
  }
}

export async function createCanvasRow(
  input: CreateCanvasInput,
  origin: ChangeOrigin
): Promise<Canvas> {
  const db = await getDatabase();
  const id = generateId();
  const now = nowSeconds();
  const doc = createDefaultCanvasDoc();

  const orderResult = await db.select<{ max_order: number | null }[]>(
    'SELECT MAX("order") as max_order FROM canvases'
  );
  const order = (orderResult[0]?.max_order ?? -1) + 1;

  await db.execute(
    'INSERT INTO canvases (id, title, doc, pinned, "order", created_at, updated_at, content_updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, input.title ?? "", stripViewportForStorage(doc), 0, order, now, now, now]
  );

  const stored = await fetchStoredCanvas(id);
  // A read-back failure after the durable write still emits below.
  await emitChange({ entity: "canvas", id, origin, kind: "content" });
  return (
    stored ?? {
      id,
      title: input.title ?? "",
      doc,
      pinned: false,
      order,
      createdAt: now,
      updatedAt: now,
      contentUpdatedAt: now,
    }
  );
}

/**
 * Save the canvas document. Doc edits are content Changes (they move Last
 * Edited). Resolves with the canvas as stored, or null when it no longer
 * exists.
 */
export async function updateCanvasDocRow(
  id: string,
  doc: CanvasDoc,
  origin: ChangeOrigin
): Promise<Canvas | null> {
  assertWritableId(id);
  const db = await getDatabase();
  const existing = await readCanvasRow(id);
  if (!existing) return null;
  const now = nowSeconds();

  await db.execute("UPDATE canvases SET doc = ?, updated_at = ?, content_updated_at = ? WHERE id = ?", [
    stripViewportForStorage(doc),
    now,
    now,
    id,
  ]);

  const stored = await fetchStoredCanvas(id);
  // A read-back failure after the durable write still emits below.
  await emitChange({ entity: "canvas", id, origin, kind: "content" });
  return stored;
}

/**
 * Save canvas metadata. A title change is a content Change (it moves Last
 * Edited); pin and order changes are metadata Changes. updated_at always
 * bumps as the sync conflict clock. Resolves with the canvas as stored, or
 * null when it no longer exists.
 */
export async function updateCanvasRow(
  id: string,
  input: UpdateCanvasInput,
  origin: ChangeOrigin
): Promise<Canvas | null> {
  assertWritableId(id);
  const db = await getDatabase();
  const existing = await readCanvasRow(id);
  if (!existing) return null;
  const now = nowSeconds();
  const title = input.title ?? (existing.title as string);
  const pinned = input.pinned ?? Boolean(existing.pinned);
  const order = input.order ?? (existing.order as number);
  const contentChanged = input.title !== undefined && input.title !== (existing.title as string);
  const kind: ChangeKind = contentChanged ? "content" : "metadata";

  await db.execute(
    'UPDATE canvases SET title = ?, pinned = ?, "order" = ?, updated_at = ?, content_updated_at = ? WHERE id = ?',
    [
      title,
      pinned ? 1 : 0,
      order,
      now,
      contentChanged ? now : (existing.content_updated_at as number),
      id,
    ]
  );

  const stored = await fetchStoredCanvas(id);
  // A read-back failure after the durable write still emits below.
  await emitChange({ entity: "canvas", id, origin, kind });
  return stored;
}

export async function reorderCanvasRows(
  items: ReorderCanvasItem[],
  origin: ChangeOrigin
): Promise<void> {
  for (const item of items) assertWritableId(item.id);
  const db = await getDatabase();
  const now = nowSeconds();

  // Only rows that actually persisted earn a notification: zero durable
  // writes means zero Changes, and unpersisted ids are never announced.
  const persistedIds: string[] = [];
  for (const item of items) {
    let affected = 0;
    try {
      const result = await db.execute('UPDATE canvases SET "order" = ?, updated_at = ? WHERE id = ?', [
        item.order,
        now,
        item.id,
      ]);
      affected = result.rowsAffected ?? 0;
    } catch (error) {
      for (const id of persistedIds) {
        await emitChange({ entity: "canvas", id, origin, kind: "metadata" });
      }
      throw error;
    }
    if (affected > 0) persistedIds.push(item.id);
  }

  for (const id of persistedIds) {
    await emitChange({ entity: "canvas", id, origin, kind: "metadata" });
  }
}

/** Local delete: records a tombstone so sync carries the deletion. */
export async function deleteCanvasRow(id: string, origin: ChangeOrigin): Promise<void> {
  assertWritableId(id);
  const db = await getDatabase();
  const rows = await db.select<{ title: string }[]>("SELECT title FROM canvases WHERE id = ?", [
    id,
  ]);
  if (rows.length > 0) {
    await recordTombstone({
      entityType: "canvas",
      entityId: id,
      title: rows[0].title,
    });
  }
  await db.execute("DELETE FROM canvases WHERE id = ?", [id]);
  await emitChange({ entity: "canvas", id, origin, kind: "content" });
}

/**
 * Removal of a canvas deleted on another device. Records no tombstone (the
 * server already has the deletion, and a tombstone would block pulling the
 * canvas back if another device restores it).
 */
export async function removeCanvasRow(id: string, origin: ChangeOrigin): Promise<void> {
  assertWritableId(id);
  const db = await getDatabase();
  await db.execute("DELETE FROM canvases WHERE id = ?", [id]);
  await emitChange({ entity: "canvas", id, origin, kind: "content" });
}

/**
 * Replace the local canvas row with a synced snapshot (pull or local
 * restore). The payload never carries a viewport, and neither does the
 * stored doc: the device keeps its own view. A doc with a newer
 * schemaVersion than this client understands is stored verbatim — never
 * parsed or migrated — and the adapter refuses to push it back (ADR 0006).
 *
 * A doc or title difference is a content Change; a metadata-only Pull keeps
 * its kind and the existing Last Edited. Resolves with the canvas as stored.
 */
export async function applyCanvasSnapshotData(
  snapshot: CanvasSnapshot,
  origin: ChangeOrigin
): Promise<Canvas> {
  assertWritableId(snapshot.canvas.id);
  const db = await getDatabase();
  const { canvas } = snapshot;
  const existing = await readCanvasRow(canvas.id);

  const now = nowSeconds();
  let kind: ChangeKind = "content";
  const updatedAt = origin === "local" ? now : canvas.updatedAt;
  let contentUpdatedAt = origin === "local" ? now : (canvas.contentUpdatedAt ?? canvas.updatedAt);
  if (existing !== null && origin !== "local") {
    const existingTitle = existing.title as string;
    const changed =
      canvas.title !== existingTitle ||
      docContentKey(canvas.doc) !== docContentKey(parseStoredRaw(existing.doc));
    kind = changed ? "content" : "metadata";
    if (!changed) contentUpdatedAt = (existing.content_updated_at as number | null) ?? (existing.updated_at as number);
  }

  await db.execute(
    `INSERT OR REPLACE INTO canvases (
      id, title, doc, pinned, "order", created_at, updated_at, content_updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      canvas.id,
      canvas.title,
      JSON.stringify(canvas.doc),
      canvas.pinned ? 1 : 0,
      canvas.order,
      canvas.createdAt,
      updatedAt,
      contentUpdatedAt,
    ]
  );

  // Capture this apply's stored result before the emission's awaits: a later
  // save must not replace it. A read-back failure after the durable write
  // still emits below.
  const stored = await fetchStoredCanvas(canvas.id);
  await emitChange({ entity: "canvas", id: canvas.id, origin, kind });
  return (
    stored ?? {
      id: canvas.id,
      title: canvas.title,
      doc: parseStoredDoc(JSON.stringify(canvas.doc)),
      pinned: canvas.pinned,
      order: canvas.order,
      createdAt: canvas.createdAt,
      updatedAt,
      contentUpdatedAt,
    }
  );
}

/** Raw stored doc parsed without validation, for checksum comparison. */
function parseStoredRaw(raw: unknown): unknown {
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}
