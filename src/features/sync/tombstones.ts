import { getDatabase } from "../../lib/db";
import type { SyncEntityType, SyncTombstone } from "./types";

interface TombstoneRow {
  id: string;
  entity_type: SyncEntityType;
  entity_id: string;
  title: string;
  deleted_at: number;
  confirmed_at: number | null;
  pushed_at: number | null;
}

interface RecordTombstoneInput {
  entityType: SyncEntityType;
  entityId: string;
  title: string;
  deletedAt?: number;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function tombstoneId(entityType: SyncEntityType, entityId: string): string {
  return `${entityType}:${entityId}`;
}

function toModel(row: TombstoneRow): SyncTombstone {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    title: row.title,
    deletedAt: row.deleted_at,
    confirmedAt: row.confirmed_at,
    pushedAt: row.pushed_at,
  };
}

export async function recordTombstone(input: RecordTombstoneInput): Promise<SyncTombstone> {
  const db = await getDatabase();
  const id = tombstoneId(input.entityType, input.entityId);
  const deletedAt = input.deletedAt ?? nowSeconds();

  await db.execute(
    `INSERT INTO sync_tombstones
       (id, entity_type, entity_id, title, deleted_at, confirmed_at, pushed_at)
     VALUES (?, ?, ?, ?, ?, NULL, NULL)
     ON CONFLICT(entity_type, entity_id) DO UPDATE SET
       title = excluded.title,
       deleted_at = excluded.deleted_at,
       confirmed_at = NULL,
       pushed_at = NULL`,
    [id, input.entityType, input.entityId, input.title, deletedAt]
  );

  return {
    id,
    entityType: input.entityType,
    entityId: input.entityId,
    title: input.title,
    deletedAt,
    confirmedAt: null,
    pushedAt: null,
  };
}

export async function listPendingTombstones(
  entityTypes: SyncEntityType[]
): Promise<SyncTombstone[]> {
  if (entityTypes.length === 0) return [];

  const db = await getDatabase();
  const placeholders = entityTypes.map(() => "?").join(", ");
  const rows = await db.select<TombstoneRow[]>(
    `SELECT id, entity_type, entity_id, title, deleted_at, confirmed_at, pushed_at
     FROM sync_tombstones
     WHERE entity_type IN (${placeholders}) AND pushed_at IS NULL
     ORDER BY deleted_at ASC, id ASC`,
    entityTypes
  );

  return rows.map(toModel);
}

export async function confirmTombstones(ids: string[], confirmedAt = nowSeconds()): Promise<void> {
  if (ids.length === 0) return;

  const db = await getDatabase();
  for (const id of ids) {
    await db.execute("UPDATE sync_tombstones SET confirmed_at = ? WHERE id = ?", [confirmedAt, id]);
  }
}

export async function markTombstonePushed(
  entityType: SyncEntityType,
  entityId: string,
  pushedAt = nowSeconds()
): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    "UPDATE sync_tombstones SET pushed_at = ? WHERE entity_type = ? AND entity_id = ?",
    [pushedAt, entityType, entityId]
  );
}

export async function hasTombstone(entityType: SyncEntityType, entityId: string): Promise<boolean> {
  const db = await getDatabase();
  const rows = await db.select<{ id: string }[]>(
    "SELECT id FROM sync_tombstones WHERE entity_type = ? AND entity_id = ? LIMIT 1",
    [entityType, entityId]
  );
  return rows.length > 0;
}

export async function getTombstone(
  entityType: SyncEntityType,
  entityId: string
): Promise<SyncTombstone | null> {
  const db = await getDatabase();
  const rows = await db.select<TombstoneRow[]>(
    `SELECT id, entity_type, entity_id, title, deleted_at, confirmed_at, pushed_at
     FROM sync_tombstones
     WHERE entity_type = ? AND entity_id = ? LIMIT 1`,
    [entityType, entityId]
  );
  return rows[0] ? toModel(rows[0]) : null;
}
