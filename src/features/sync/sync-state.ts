import { getDatabase } from "@/lib/db";
import type { SyncBase } from "@/features/sync/sync-decision";

// Per-device record of the last successful sync of each book and note (the
// "base" of the three-way decision in sync-decision.ts). Local-only: it is not
// part of backups, and restores or resets clear it, so a restored library is
// compared against the server from scratch instead of against stale bases.

export type SyncStateEntity = "book" | "note";

interface SyncStateRow {
  local_checksum: string;
  remote_checksum: string;
}

export async function getSyncBase(
  entityType: SyncStateEntity,
  entityId: string
): Promise<SyncBase | null> {
  const db = await getDatabase();
  const rows = await db.select<SyncStateRow[]>(
    "SELECT local_checksum, remote_checksum FROM sync_state WHERE entity_type = ? AND entity_id = ?",
    [entityType, entityId]
  );
  const row = rows[0];
  return row ? { localChecksum: row.local_checksum, remoteChecksum: row.remote_checksum } : null;
}

export async function setSyncBase(
  entityType: SyncStateEntity,
  entityId: string,
  base: SyncBase
): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    `INSERT INTO sync_state (entity_type, entity_id, local_checksum, remote_checksum, synced_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(entity_type, entity_id) DO UPDATE SET
       local_checksum = excluded.local_checksum,
       remote_checksum = excluded.remote_checksum,
       synced_at = excluded.synced_at`,
    [entityType, entityId, base.localChecksum, base.remoteChecksum, Math.floor(Date.now() / 1000)]
  );
}

/** Forget every base: they describe one account on one server. */
export async function clearAllSyncBases(): Promise<void> {
  const db = await getDatabase();
  await db.execute("DELETE FROM sync_state");
}

export async function clearSyncBase(entityType: SyncStateEntity, entityId: string): Promise<void> {
  const db = await getDatabase();
  await db.execute("DELETE FROM sync_state WHERE entity_type = ? AND entity_id = ?", [
    entityType,
    entityId,
  ]);
}
