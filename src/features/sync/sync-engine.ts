import { getDatabase } from "../../lib/db";
import { encrypt, decrypt, computeChecksum, isSyncCryptoError } from "./crypto";
import { serializeBook, applyBookSnapshot, serializeNote, applyNoteSnapshot } from "./serializer";
import {
  pushBookBlob,
  pullBookBlob,
  listRemoteBooks,
  refreshAuth as pbRefreshAuth,
  listRemoteVersions,
  pushVersionBlob,
  pullVersionBlob,
  pullMetricsBlob,
  pushNoteBlob,
  pullNoteBlob,
  listRemoteNotes,
} from "./client";
import type {
  BookSnapshot,
  NoteSnapshot,
  SyncItemMeta,
  NoteSyncItemMeta,
  SingleSyncResult,
  BatchSyncResult,
  MetricsSyncBlob,
} from "./types";
import type { SyncAction, ConflictResolver } from "./types";
import { createBackup } from "../../lib/platform";
import { BackupService } from "../backup/backup-service";
import { useSettingsStore } from "../settings/store";
import { useSyncStore } from "./store";
import { useVersionStore } from "../versions/store";
import {
  applyLegacyBlobAndMarkPushed,
  syncMetricsRows,
} from "../metrics/metrics-sync";

const BLOB_MIGRATED_KEY = "maibuk.metrics.blobMigrated";

let isSyncing = false;
const PRE_SYNC_BACKUP_ERROR =
  "Could not create a safety backup. Sync aborted. Free up disk space and try again.";

async function decryptSnapshot(data: Uint8Array, passphrase: string): Promise<BookSnapshot> {
  const decrypted = await decrypt(data, passphrase);
  try {
    return JSON.parse(decrypted) as BookSnapshot;
  } catch {
    throw new Error("Synced payload is invalid or corrupted");
  }
}

async function decryptNoteSnapshot(data: Uint8Array, passphrase: string): Promise<NoteSnapshot> {
  const decrypted = await decrypt(data, passphrase);
  try {
    return JSON.parse(decrypted) as NoteSnapshot;
  } catch {
    throw new Error("Synced payload is invalid or corrupted");
  }
}

function assertOnline(): void {
  if (!navigator.onLine) {
    throw new Error("No internet connection");
  }
}

function toBlobPart(data: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  return buffer;
}

interface EffectiveTimestamp {
  updated_at: number;
}

async function getLocalUpdatedAt(bookId: string): Promise<number> {
  const db = await getDatabase();
  const rows = await db.select<EffectiveTimestamp[]>(
    `SELECT COALESCE(MAX(ts), 0) AS updated_at FROM (
      SELECT updated_at AS ts FROM books WHERE id = ?
      UNION ALL
      SELECT updated_at AS ts FROM chapters WHERE book_id = ?
    )`,
    [bookId, bookId]
  );
  return rows[0]?.updated_at ?? 0;
}

async function getBookTitle(bookId: string): Promise<string> {
  const db = await getDatabase();
  const rows = await db.select<{ title: string }[]>("SELECT title FROM books WHERE id = ?", [
    bookId,
  ]);
  return rows[0]?.title ?? bookId;
}

async function getNoteTitle(noteId: string): Promise<string> {
  const db = await getDatabase();
  const rows = await db.select<{ title: string }[]>("SELECT title FROM notes WHERE id = ?", [
    noteId,
  ]);
  return rows[0]?.title ?? noteId;
}

function assertNotSyncing(): void {
  if (isSyncing) {
    throw new Error("A sync operation is already in progress");
  }
}

async function createPreSyncBackupOrThrow(): Promise<void> {
  try {
    const adapter = await createBackup(useSettingsStore.getState().backupDirectory);
    const backupService = new BackupService(adapter);
    await backupService.deleteByTrigger("pre-sync");
    await backupService.createBackup("pre-sync");
  } catch (error) {
    // An empty database has nothing to lose, so there is nothing to back up.
    // This is the normal case on a fresh device whose first sync is a pull —
    // refusing to proceed here is what previously forced users to create a
    // book before they could sync. Proceed without a backup.
    if (error instanceof Error && error.message === "BACKUP_EMPTY") {
      return;
    }
    // Surface the real failure for diagnosis instead of masking every cause as
    // "out of disk space".
    console.error("Pre-sync backup failed:", error);
    throw new Error(PRE_SYNC_BACKUP_ERROR);
  }
}

async function ensureAuth(): Promise<void> {
  if (useSyncStore.getState().authVerified) return;

  try {
    const result = await pbRefreshAuth();
    useSyncStore.setState({
      authStatus: "logged-in",
      userEmail: result.email,
      authToken: result.token,
      authVerified: true,
    });
  } catch (error: unknown) {
    const status = (error as { status?: number }).status;
    if (status === 401) {
      useSyncStore.setState({
        authStatus: "logged-out",
        userEmail: null,
        authToken: null,
        authVerified: false,
      });
      throw new Error("sync.sessionExpired");
    }
    throw error;
  }
}

async function syncBookInBatch(
  bookId: string,
  passphrase: string,
  onConflict: ConflictResolver,
  remoteBooks?: SyncItemMeta[],
  precomputedLocalUpdatedAt?: number
): Promise<SyncAction> {
  assertOnline();

  const json = await serializeBook(bookId);
  const localChecksum = await computeChecksum(json);
  // Reuse the timestamp from syncAllBooks' GROUP BY query when available,
  // avoiding a redundant per-book MAX query.
  const localUpdatedAt = precomputedLocalUpdatedAt ?? (await getLocalUpdatedAt(bookId));

  const remotes = remoteBooks ?? (await listRemoteBooks());
  const remote = remotes.find((r) => r.bookId === bookId);

  if (!remote) {
    const encrypted = await encrypt(json, passphrase);
    await pushBookBlob(bookId, new Blob([toBlobPart(encrypted)]), localChecksum);
    return "pushed";
  }

  if (remote.checksum === localChecksum) {
    return "skipped";
  }

  // Checksums differ — compare timestamps
  if (localUpdatedAt > remote.updatedAt) {
    // Local is strictly newer — push
    const encrypted = await encrypt(json, passphrase);
    await pushBookBlob(bookId, new Blob([toBlobPart(encrypted)]), localChecksum);
    return "pushed";
  }

  // Remote is newer or equal timestamps — ask user
  const bookTitle = await getBookTitle(bookId);
  const choice = await onConflict({
    bookId,
    bookTitle,
    localUpdatedAt,
    remoteUpdatedAt: remote.updatedAt,
  });

  if (choice === "cancel") {
    return "cancelled";
  }

  if (choice === "push") {
    const encrypted = await encrypt(json, passphrase);
    await pushBookBlob(bookId, new Blob([toBlobPart(encrypted)]), localChecksum);
    return "pushed";
  }

  // choice === "pull"
  await useVersionStore.getState().createVersion({ bookId, triggerType: "pre-sync" });

  const pulled = await pullBookBlob(bookId);
  if (!pulled) return "skipped";

  const snapshot = await decryptSnapshot(pulled.data, passphrase);
  await applyBookSnapshot(snapshot);
  return "pulled";
}

async function syncNoteInBatch(
  noteId: string,
  passphrase: string,
  onConflict: ConflictResolver,
  remoteNotes: NoteSyncItemMeta[],
  localUpdatedAt: number
): Promise<SyncAction> {
  assertOnline();

  const json = await serializeNote(noteId);
  const localChecksum = await computeChecksum(json);

  const remote = remoteNotes.find((r) => r.noteId === noteId);

  if (!remote) {
    const encrypted = await encrypt(json, passphrase);
    await pushNoteBlob(noteId, new Blob([toBlobPart(encrypted)]), localChecksum);
    return "pushed";
  }

  if (remote.checksum === localChecksum) {
    return "skipped";
  }

  // Checksums differ — compare timestamps
  if (localUpdatedAt > remote.updatedAt) {
    const encrypted = await encrypt(json, passphrase);
    await pushNoteBlob(noteId, new Blob([toBlobPart(encrypted)]), localChecksum);
    return "pushed";
  }

  // Remote is newer or equal timestamps — ask user. Notes are not versioned, so
  // there is no pre-pull snapshot to take (the pre-sync backup is the safety net).
  const noteTitle = await getNoteTitle(noteId);
  const choice = await onConflict({
    bookId: noteId,
    bookTitle: noteTitle,
    localUpdatedAt,
    remoteUpdatedAt: remote.updatedAt,
  });

  if (choice === "cancel") {
    return "cancelled";
  }

  if (choice === "push") {
    const encrypted = await encrypt(json, passphrase);
    await pushNoteBlob(noteId, new Blob([toBlobPart(encrypted)]), localChecksum);
    return "pushed";
  }

  // choice === "pull"
  const pulled = await pullNoteBlob(noteId);
  if (!pulled) return "skipped";

  const snapshot = await decryptNoteSnapshot(pulled.data, passphrase);
  await applyNoteSnapshot(snapshot);
  return "pulled";
}

async function syncVersions(bookId: string, passphrase: string): Promise<void> {
  const db = await getDatabase();

  const localRows = await db.select<
    { id: string; checksum: string; name: string | null; trigger_type: string; created_at: number; word_count: number; snapshot: string }[]
  >(
    `SELECT id, checksum, name, trigger_type, created_at, word_count, snapshot
     FROM book_versions WHERE book_id = ?`,
    [bookId]
  );

  const remotes = await listRemoteVersions(bookId);
  const remoteIds = new Set(remotes.map((r) => r.versionId));
  const localIds = new Set(localRows.map((r) => r.id));

  // Push local-only versions. A single failed push (e.g. a transient server
  // rejection) must not abort the whole version sync — log it and move on, the
  // same way the pull loop below isolates each version. synced_at is only
  // stamped after a successful push, so a skipped version retries next sync.
  for (const local of localRows) {
    if (remoteIds.has(local.id)) continue;

    try {
      const encrypted = await encrypt(local.snapshot, passphrase);
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
        new Blob([toBlobPart(new Uint8Array(encrypted))])
      );

      const now = Math.floor(Date.now() / 1000);
      await db.execute("UPDATE book_versions SET synced_at = ? WHERE id = ?", [
        now,
        local.id,
      ]);
    } catch (error) {
      console.warn(`Version sync: skipping push of version ${local.id}`, error);
    }
  }

  // Pull remote-only versions. AES-GCM authenticates each blob on decrypt, so a
  // corrupt or tampered payload throws below — there is no separate integrity
  // check to do here. (The stored checksum is a content hash of the snapshot,
  // not a hash of the raw serialized blob, so re-hashing the decrypted payload
  // would never match it.) Each version is isolated so one bad blob cannot
  // abort the whole initial sync, but a wrong passphrase — which fails every
  // version — is surfaced rather than silently swallowed.
  for (const remote of remotes) {
    if (localIds.has(remote.versionId)) continue;

    try {
      const blob = await pullVersionBlob(remote.remoteId);
      if (!blob) continue;

      const decrypted = await decrypt(blob.data, passphrase);

      await db.execute(
        `INSERT OR IGNORE INTO book_versions
         (id, book_id, name, snapshot, word_count, checksum, trigger_type, created_at, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          remote.versionId,
          bookId,
          remote.name,
          decrypted,
          remote.wordCount,
          remote.checksum,
          remote.triggerType,
          remote.createdAt,
          Math.floor(Date.now() / 1000),
        ]
      );
    } catch (error) {
      if (isSyncCryptoError(error) && error.code === "INVALID_PASSPHRASE") {
        throw error;
      }
      console.warn(`Version sync: skipping version ${remote.versionId}`, error);
    }
  }
}

interface NoteTimestampRow {
  id: string;
  updated_at: number;
}

/**
 * Syncs all notes the same way books are synced: one encrypted blob per note,
 * checksum + timestamp conflict resolution, auto-pull of remote-only notes.
 * Notes are not versioned, so there is no per-note version history to reconcile.
 * Returns the per-note actions and whether the user cancelled at a conflict.
 */
async function syncAllNotes(
  passphrase: string,
  onConflict: ConflictResolver
): Promise<{ actions: SyncAction[]; cancelled: boolean }> {
  assertOnline();

  const db = await getDatabase();
  const localNotes = await db.select<NoteTimestampRow[]>(
    "SELECT id, updated_at FROM notes"
  );
  const localNoteIds = new Set(localNotes.map((n) => n.id));

  const remoteNotes = await listRemoteNotes();
  const actions: SyncAction[] = [];

  for (const note of localNotes) {
    const action = await syncNoteInBatch(
      note.id,
      passphrase,
      onConflict,
      remoteNotes,
      note.updated_at
    );
    actions.push(action);
    if (action === "cancelled") {
      return { actions, cancelled: true };
    }
  }

  // Pull remote-only notes (no local data — auto-pull, no conflict dialog)
  for (const remote of remoteNotes) {
    if (localNoteIds.has(remote.noteId)) continue;

    const pulled = await pullNoteBlob(remote.noteId);
    if (!pulled) continue;

    const snapshot = await decryptNoteSnapshot(pulled.data, passphrase);
    await applyNoteSnapshot(snapshot);
    actions.push("pulled");
  }

  return { actions, cancelled: false };
}

async function syncMetrics(passphrase: string): Promise<void> {
  if (!useSettingsStore.getState().metrics.syncMetrics) return;

  // One-time migration: if a legacy `metrics_sync` blob exists on the server
  // and we haven't migrated yet, decrypt + apply it locally and mark the
  // local rows as already-pushed. After this, all sync goes through the row
  // collections.
  await migrateLegacyMetricsBlobIfNeeded(passphrase);

  await syncMetricsRows(passphrase);
}

async function migrateLegacyMetricsBlobIfNeeded(
  passphrase: string,
): Promise<void> {
  if (typeof localStorage !== "undefined") {
    if (localStorage.getItem(BLOB_MIGRATED_KEY) === "true") return;
  }

  let remote: { data: Uint8Array; checksum: string } | null = null;
  try {
    remote = await pullMetricsBlob();
  } catch {
    // Old collection may not exist on the server. That's expected on fresh
    // deployments — just mark migration done so we don't keep probing.
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(BLOB_MIGRATED_KEY, "true");
    }
    return;
  }

  if (!remote) {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(BLOB_MIGRATED_KEY, "true");
    }
    return;
  }

  const decrypted = await decrypt(remote.data, passphrase);
  let snapshot: MetricsSyncBlob;
  try {
    snapshot = JSON.parse(decrypted) as MetricsSyncBlob;
  } catch {
    throw new Error("Synced metrics payload is invalid or corrupted");
  }
  await applyLegacyBlobAndMarkPushed(snapshot);

  if (typeof localStorage !== "undefined") {
    localStorage.setItem(BLOB_MIGRATED_KEY, "true");
  }
}

export async function syncBook(
  bookId: string,
  passphrase: string,
  onConflict: ConflictResolver
): Promise<SingleSyncResult> {
  assertNotSyncing();
  isSyncing = true;
  try {
    await ensureAuth();
    await createPreSyncBackupOrThrow();

    const action = await syncBookInBatch(bookId, passphrase, onConflict);
    if (action !== "cancelled") {
      await syncVersions(bookId, passphrase);
    }
    await syncMetrics(passphrase);
    return {
      outcome: action === "cancelled" ? "cancelled" : "success",
      action,
    };
  } finally {
    isSyncing = false;
  }
}

interface BookTimestampRow {
  id: string;
  updated_at: number;
}

export async function syncAllBooks(
  passphrase: string,
  onConflict: ConflictResolver
): Promise<BatchSyncResult> {
  assertNotSyncing();
  isSyncing = true;
  try {
    await ensureAuth();
    assertOnline();
    const actions: SyncAction[] = [];

    await createPreSyncBackupOrThrow();

    const db = await getDatabase();
    const localBooks = await db.select<BookTimestampRow[]>(
      `SELECT b.id, MAX(b.updated_at, COALESCE(MAX(c.updated_at), 0)) AS updated_at
       FROM books b
       LEFT JOIN chapters c ON c.book_id = b.id
       GROUP BY b.id`
    );
    const localBookIds = new Set(localBooks.map((b) => b.id));

    const remoteBooks = await listRemoteBooks();

    for (const book of localBooks) {
      const action = await syncBookInBatch(
        book.id,
        passphrase,
        onConflict,
        remoteBooks,
        book.updated_at
      );
      if (action !== "cancelled") {
        await syncVersions(book.id, passphrase);
      }
      actions.push(action);
      if (action === "cancelled") {
        await syncMetrics(passphrase);
        return {
          outcome: actions.some((entry) => entry !== "cancelled") ? "partial" : "cancelled",
          actions,
        };
      }
    }

    // Pull remote-only books (no local data — auto-pull, no conflict dialog)
    for (const remote of remoteBooks) {
      if (localBookIds.has(remote.bookId)) continue;

      const pulled = await pullBookBlob(remote.bookId);
      if (!pulled) continue;

      const snapshot = await decryptSnapshot(pulled.data, passphrase);
      await applyBookSnapshot(snapshot);
      actions.push("pulled");
      await syncVersions(remote.bookId, passphrase);
    }

    // Notes sync alongside books in the same pass, sharing the auth check and
    // pre-sync backup. A cancelled note conflict aborts the rest of note sync.
    const noteResult = await syncAllNotes(passphrase, onConflict);
    actions.push(...noteResult.actions);
    if (noteResult.cancelled) {
      await syncMetrics(passphrase);
      return {
        outcome: actions.some((entry) => entry !== "cancelled") ? "partial" : "cancelled",
        actions,
      };
    }

    await syncMetrics(passphrase);

    return { outcome: "success", actions };
  } finally {
    isSyncing = false;
  }
}

export function resetSyncEngineForTests(): void {
  isSyncing = false;
}
