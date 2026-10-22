import { getDatabase } from "@/lib/db";
import { isSyncCryptoError } from "@/features/sync/crypto";
import { decryptBufferToText, encryptToBuffer } from "@/features/sync/sync-codec";
import {
  listDeletedObjects,
  listObjects,
  listRemoteVersions,
  pullVersionBlob,
  pushVersionBlob,
  softDeleteObject,
} from "@/features/sync/client";
import type { BookSnapshot } from "@/features/sync/types";
import {
  deleteVersionRows,
  insertSplitVersionStatements,
  isVersionUpgradePending,
  readVersionSnapshot,
  withVersionWrites,
} from "@/features/versions/content-store";
import { retainVersions } from "@/features/versions/retention";

// Version sync (ADR 0033). Version Retention runs over this device's Versions
// and the remote list, which carries metadata but no content, before anything
// is downloaded: only Versions the rule keeps are pulled or pushed, local ones
// it drops are deleted, and remote ones it drops are tombstoned (marked deleted
// with their content cleared). A remote tombstone wins over a local copy. Every
// device computes the same kept set from the same union, so they converge
// without remembering what they pruned.

export interface VersionSyncDirection {
  push: boolean;
  pull: boolean;
}

interface LocalVersionRow {
  id: string;
  checksum: string;
  name: string | null;
  trigger_type: string;
  created_at: number;
  word_count: number;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** Tombstones remote copies of Versions deleted or renamed on this device. */
async function pushPendingTombstones(bookId: string): Promise<void> {
  const db = await getDatabase();
  const pending = await db.select<{ version_id: string }[]>(
    "SELECT version_id FROM version_tombstones WHERE book_id = ?",
    [bookId]
  );
  for (const { version_id } of pending) {
    try {
      await softDeleteObject("version", version_id, undefined, bookId);
      await db.execute("DELETE FROM version_tombstones WHERE version_id = ?", [version_id]);
    } catch (error) {
      // The row stays, so the next sync retries it.
      console.warn(`Version sync: could not tombstone version ${version_id}`, error);
    }
  }
}

export async function syncVersions(
  bookId: string,
  passphrase: string,
  direction: VersionSyncDirection
): Promise<void> {
  const db = await getDatabase();
  // Until the upgrade has taken its safety Backup, nothing may drop a Version
  // here or on the server; the next sync after it runs catches up.
  if (await isVersionUpgradePending(db)) return;

  if (direction.push) await pushPendingTombstones(bookId);

  const [remotes, remoteTombstones] = await Promise.all([
    listRemoteVersions(bookId),
    listDeletedObjects("version", bookId),
  ]);
  const tombstoned = new Set(remoteTombstones.map((row) => row.key));
  const pendingLocal = new Set(
    (
      await db.select<{ version_id: string }[]>(
        "SELECT version_id FROM version_tombstones WHERE book_id = ?",
        [bookId]
      )
    ).map((row) => row.version_id)
  );

  const localRows = await db.select<LocalVersionRow[]>(
    `SELECT id, checksum, name, trigger_type, created_at, word_count
     FROM book_versions WHERE book_id = ?`,
    [bookId]
  );
  const localIds = new Set(localRows.map((row) => row.id));
  const liveRemotes = remotes.filter(
    (remote) => !tombstoned.has(remote.versionId) && !pendingLocal.has(remote.versionId)
  );
  const remoteIds = new Set(liveRemotes.map((remote) => remote.versionId));

  const keep = retainVersions(
    [
      ...localRows
        .filter((row) => !tombstoned.has(row.id))
        .map((row) => ({ id: row.id, triggerType: row.trigger_type, createdAt: row.created_at })),
      ...liveRemotes.map((remote) => ({
        id: remote.versionId,
        triggerType: remote.triggerType,
        createdAt: remote.createdAt,
      })),
    ],
    nowSeconds()
  );

  // Local copies the rule drops, or that another device tombstoned.
  const dropLocal = localRows
    .filter((row) => tombstoned.has(row.id) || !keep.has(row.id))
    .map((row) => row.id);
  if (dropLocal.length > 0) {
    await withVersionWrites(() => deleteVersionRows(db, dropLocal));
  }

  if (direction.push) {
    // Push kept local Versions the remote lacks. A single failed push must not
    // abort the whole version sync; synced_at is only stamped after a
    // successful push, so a skipped version retries next sync.
    for (const local of localRows) {
      if (!keep.has(local.id) || remoteIds.has(local.id) || tombstoned.has(local.id)) continue;
      try {
        const stored = await readVersionSnapshot(db, local.id);
        if (!stored) continue;
        const encrypted = await encryptToBuffer(JSON.stringify(stored.snapshot), passphrase);
        await pushVersionBlob(
          {
            versionId: local.id,
            bookId,
            checksum: local.checksum,
            name: local.name,
            triggerType: local.trigger_type,
            createdAt: local.created_at,
            wordCount: local.word_count,
          },
          new Blob([encrypted])
        );
        await db.execute("UPDATE book_versions SET synced_at = ? WHERE id = ?", [
          nowSeconds(),
          local.id,
        ]);
      } catch (error) {
        console.warn(`Version sync: skipping push of version ${local.id}`, error);
      }
    }

    // Remote Versions the rule drops lose their content on the server.
    for (const remote of liveRemotes) {
      if (keep.has(remote.versionId)) continue;
      try {
        await softDeleteObject("version", remote.versionId, undefined, bookId);
      } catch (error) {
        console.warn(`Version sync: could not tombstone version ${remote.versionId}`, error);
      }
    }
  }

  if (direction.pull) {
    // Pull only kept remote Versions this device lacks. AES-GCM authenticates
    // each blob on decrypt, so a corrupt or tampered payload throws. Each
    // version is isolated so one bad blob cannot abort the whole sync, but a
    // wrong passphrase, which fails every version, is surfaced.
    for (const remote of liveRemotes) {
      if (!keep.has(remote.versionId) || localIds.has(remote.versionId)) continue;
      try {
        const blob = await pullVersionBlob(remote.remoteId);
        if (!blob) continue;
        const snapshot = JSON.parse(
          await decryptBufferToText(blob.data, passphrase)
        ) as BookSnapshot;
        await withVersionWrites(async () =>
          db.executeAtomic(
            await insertSplitVersionStatements(
              db,
              {
                id: remote.versionId,
                bookId,
                name: remote.name,
                wordCount: remote.wordCount,
                checksum: remote.checksum,
                triggerType: remote.triggerType,
                createdAt: remote.createdAt,
                syncedAt: nowSeconds(),
              },
              snapshot,
              "INSERT OR IGNORE"
            )
          )
        );
      } catch (error) {
        if (isSyncCryptoError(error) && error.code === "INVALID_PASSPHRASE") {
          throw error;
        }
        console.warn(`Version sync: skipping version ${remote.versionId}`, error);
      }
    }
  }
}

/**
 * Tombstones remote Versions of Books deleted remotely, so a deleted Book's
 * history stops taking server space. Only Books explicitly deleted count: a
 * Book not yet pushed has no remote Versions either.
 */
export async function tombstoneVersionsOfDeletedBooks(): Promise<void> {
  const [versions, deletedBooks, liveBooks] = await Promise.all([
    listObjects("version"),
    listDeletedObjects("book"),
    listObjects("book"),
  ]);
  const live = new Set(liveBooks.map((row) => row.key));
  const deleted = new Set(deletedBooks.map((row) => row.key).filter((key) => !live.has(key)));
  for (const version of versions) {
    if (!deleted.has(version.group)) continue;
    try {
      await softDeleteObject("version", version.key, undefined, version.group);
    } catch (error) {
      console.warn(`Version sync: could not tombstone version ${version.key}`, error);
    }
  }
}
