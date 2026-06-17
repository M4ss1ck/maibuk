import { getDatabase } from "../../lib/db";
import { encrypt, decrypt, computeChecksum, isSyncCryptoError } from "./crypto";
import {
  serializeBook,
  applyBookSnapshot,
  serializeNote,
  applyNoteSnapshot,
  normalizeNoteSnapshotForSync,
} from "./serializer";
import {
  pushBookBlob,
  pullBookBlob,
  listRemoteBooks,
  refreshAuth as pbRefreshAuth,
  listRemoteVersions,
  pushVersionBlob,
  pullVersionBlob,
  pushNoteBlob,
  pullNoteBlob,
  listRemoteNotes,
  deleteRemoteBook,
  deleteRemoteNote,
} from "./client";
import type {
  BookSnapshot,
  NoteSnapshot,
  SyncItemMeta,
  NoteSyncItemMeta,
  SingleSyncResult,
  BatchSyncResult,
  SyncOptions,
  SyncScope,
  SyncDirection,
  SyncEntityType,
  SyncDeletionReviewItem,
  SyncLogEntry,
} from "./types";
import type { SyncAction, ConflictResolver } from "./types";
import { createBackup } from "../../lib/platform";
import { BackupService } from "../backup/backup-service";
import { useSettingsStore } from "../settings/store";
import { useSyncStore } from "./store";
import { useVersionStore } from "../versions/store";
import {
  syncMetricsRows,
} from "../metrics/metrics-sync";
import {
  getTombstone,
  listPendingTombstones,
  markTombstonePushed,
} from "./tombstones";
import { ensureGenericCollectionMigration } from "./migration-reset";

let isSyncing = false;
const PRE_SYNC_BACKUP_ERROR =
  "Could not create a safety backup. Sync aborted. Free up disk space and try again.";
const DEFAULT_SYNC_OPTIONS: SyncOptions = {
  scope: "all",
  direction: "bidirectional",
  confirmedDeletionIds: [],
};

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

function resolveSyncOptions(options?: Partial<SyncOptions>): SyncOptions {
  return {
    ...DEFAULT_SYNC_OPTIONS,
    ...options,
    confirmedDeletionIds: options?.confirmedDeletionIds ?? [],
  };
}

function includesScope(scope: SyncScope, entity: SyncEntityType | "metrics"): boolean {
  return scope === "all" || scope === entity || (entity === "book" && scope === "books") ||
    (entity === "note" && scope === "notes");
}

function canPull(direction: SyncDirection): boolean {
  return direction !== "push";
}

function canPush(direction: SyncDirection): boolean {
  return direction !== "pull";
}

function toDeletionReviewItem(tombstone: {
  id: string;
  entityType: SyncEntityType;
  entityId: string;
  title: string;
  deletedAt: number;
}): SyncDeletionReviewItem {
  return {
    id: tombstone.id,
    entityType: tombstone.entityType,
    entityId: tombstone.entityId,
    title: tombstone.title,
    deletedAt: tombstone.deletedAt,
  };
}

function emitLog(
  options: SyncOptions,
  entry: Omit<SyncLogEntry, "id" | "timestamp">
): void {
  options.onLog?.({
    id: crypto.randomUUID(),
    timestamp: Math.floor(Date.now() / 1000),
    ...entry,
  });
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

async function processPendingDeletions(
  entityTypes: SyncEntityType[],
  options: SyncOptions
): Promise<{
  actions: SyncAction[];
  pendingDeletions: SyncDeletionReviewItem[];
}> {
  if (!canPush(options.direction) || entityTypes.length === 0) {
    return { actions: [], pendingDeletions: [] };
  }

  const tombstones = await listPendingTombstones(entityTypes);
  const confirmedIds = new Set(options.confirmedDeletionIds ?? []);
  const pendingDeletions: SyncDeletionReviewItem[] = [];
  const actions: SyncAction[] = [];

  for (const tombstone of tombstones) {
    const isConfirmed = tombstone.confirmedAt != null || confirmedIds.has(tombstone.id);
    if (!isConfirmed) {
      emitLog(options, {
        level: "warning",
        event: "delete-pending",
        message: `Deletion needs confirmation: ${tombstone.title}`,
        entityType: tombstone.entityType,
        entityId: tombstone.entityId,
      });
      pendingDeletions.push(toDeletionReviewItem(tombstone));
      continue;
    }

    if (tombstone.entityType === "book") {
      await deleteRemoteBook(tombstone.entityId);
    } else {
      await deleteRemoteNote(tombstone.entityId);
    }
    await markTombstonePushed(tombstone.entityType, tombstone.entityId);
    emitLog(options, {
      level: "success",
      event: "delete-pushed",
      message: `Deleted remote ${tombstone.entityType}: ${tombstone.title}`,
      entityType: tombstone.entityType,
      entityId: tombstone.entityId,
    });
    actions.push("pushed");
  }

  return { actions, pendingDeletions };
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
  options: SyncOptions,
  remoteBooks?: SyncItemMeta[],
  precomputedLocalUpdatedAt?: number
): Promise<SyncAction> {
  assertOnline();

  const json = await serializeBook(bookId);
  const bookTitle = await getBookTitle(bookId);
  const localChecksum = await computeChecksum(json);
  // Reuse the timestamp from syncAllBooks' GROUP BY query when available,
  // avoiding a redundant per-book MAX query.
  const localUpdatedAt = precomputedLocalUpdatedAt ?? (await getLocalUpdatedAt(bookId));

  const remotes = remoteBooks ?? (await listRemoteBooks());
  const remote = remotes.find((r) => r.bookId === bookId);

  if (!remote) {
    if (!canPush(options.direction)) {
      emitLog(options, {
        level: "info",
        event: "skip",
        message: `Skipped local-only book ${bookTitle} in pull-only sync`,
        entityType: "book",
        entityId: bookId,
      });
      return "skipped";
    }
    const encrypted = await encrypt(json, passphrase);
    await pushBookBlob(bookId, new Blob([toBlobPart(encrypted)]), localChecksum);
    emitLog(options, {
      level: "success",
      event: "push",
      message: `Pushed book ${bookTitle}`,
      entityType: "book",
      entityId: bookId,
    });
    return "pushed";
  }

  if (remote.checksum === localChecksum) {
    emitLog(options, {
      level: "info",
      event: "skip",
      message: `Skipped unchanged book ${bookTitle}`,
      entityType: "book",
      entityId: bookId,
    });
    return "skipped";
  }

  if (options.direction === "pull") {
    await useVersionStore.getState().createVersion({ bookId, triggerType: "pre-sync" });
    const pulled = await pullBookBlob(bookId);
    if (!pulled) return "skipped";

    const snapshot = await decryptSnapshot(pulled.data, passphrase);
    await applyBookSnapshot(snapshot);
    emitLog(options, {
      level: "success",
      event: "pull",
      message: `Pulled book ${bookTitle}`,
      entityType: "book",
      entityId: bookId,
    });
    return "pulled";
  }

  if (options.direction === "push") {
    const encrypted = await encrypt(json, passphrase);
    await pushBookBlob(bookId, new Blob([toBlobPart(encrypted)]), localChecksum, remote.remoteId);
    emitLog(options, {
      level: "success",
      event: "push",
      message: `Pushed book ${bookTitle}`,
      entityType: "book",
      entityId: bookId,
    });
    return "pushed";
  }

  // Checksums differ — compare timestamps
  if (localUpdatedAt > remote.updatedAt) {
    // Local is strictly newer — push
    const encrypted = await encrypt(json, passphrase);
    await pushBookBlob(bookId, new Blob([toBlobPart(encrypted)]), localChecksum, remote.remoteId);
    emitLog(options, {
      level: "success",
      event: "push",
      message: `Pushed book ${bookTitle}`,
      entityType: "book",
      entityId: bookId,
    });
    return "pushed";
  }

  // Remote is newer or equal timestamps — ask user
  emitLog(options, {
    level: "warning",
    event: "conflict",
    message: `Book conflict: ${bookTitle}`,
    entityType: "book",
    entityId: bookId,
  });
  const choice = await onConflict({
    entityType: "book",
    entityId: bookId,
    entityTitle: bookTitle,
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
    await pushBookBlob(bookId, new Blob([toBlobPart(encrypted)]), localChecksum, remote.remoteId);
    emitLog(options, {
      level: "success",
      event: "push",
      message: `Pushed book ${bookTitle}`,
      entityType: "book",
      entityId: bookId,
    });
    return "pushed";
  }

  // choice === "pull"
  await useVersionStore.getState().createVersion({ bookId, triggerType: "pre-sync" });

  const pulled = await pullBookBlob(bookId);
  if (!pulled) return "skipped";

  const snapshot = await decryptSnapshot(pulled.data, passphrase);
  await applyBookSnapshot(snapshot);
  emitLog(options, {
    level: "success",
    event: "pull",
    message: `Pulled book ${bookId}`,
    entityType: "book",
    entityId: bookId,
  });
  return "pulled";
}

async function syncNoteInBatch(
  noteId: string,
  passphrase: string,
  onConflict: ConflictResolver,
  options: SyncOptions,
  remoteNotes: NoteSyncItemMeta[],
  localUpdatedAt: number
): Promise<SyncAction> {
  assertOnline();

  const json = await serializeNote(noteId);
  const noteTitle = await getNoteTitle(noteId);
  const localChecksum = await computeChecksum(normalizeNoteSnapshotForSync(json));

  const remote = remoteNotes.find((r) => r.noteId === noteId);

  if (!remote) {
    if (!canPush(options.direction)) {
      emitLog(options, {
        level: "info",
        event: "skip",
        message: `Skipped local-only note ${noteTitle} in pull-only sync`,
        entityType: "note",
        entityId: noteId,
      });
      return "skipped";
    }
    const encrypted = await encrypt(json, passphrase);
    await pushNoteBlob(noteId, new Blob([toBlobPart(encrypted)]), localChecksum);
    emitLog(options, {
      level: "success",
      event: "push",
      message: `Pushed note ${noteTitle}`,
      entityType: "note",
      entityId: noteId,
    });
    return "pushed";
  }

  if (remote.checksum === localChecksum) {
    emitLog(options, {
      level: "info",
      event: "skip",
      message: `Skipped unchanged note ${noteTitle}`,
      entityType: "note",
      entityId: noteId,
    });
    return "skipped";
  }

  if (options.direction === "pull") {
    const pulled = await pullNoteBlob(noteId);
    if (!pulled) return "skipped";

    const snapshot = await decryptNoteSnapshot(pulled.data, passphrase);
    await applyNoteSnapshot(snapshot);
    emitLog(options, {
      level: "success",
      event: "pull",
      message: `Pulled note ${noteTitle}`,
      entityType: "note",
      entityId: noteId,
    });
    return "pulled";
  }

  if (options.direction === "push") {
    const encrypted = await encrypt(json, passphrase);
    await pushNoteBlob(noteId, new Blob([toBlobPart(encrypted)]), localChecksum, remote.remoteId);
    emitLog(options, {
      level: "success",
      event: "push",
      message: `Pushed note ${noteTitle}`,
      entityType: "note",
      entityId: noteId,
    });
    return "pushed";
  }

  // Checksums differ — compare timestamps
  if (localUpdatedAt > remote.updatedAt) {
    const encrypted = await encrypt(json, passphrase);
    await pushNoteBlob(noteId, new Blob([toBlobPart(encrypted)]), localChecksum, remote.remoteId);
    emitLog(options, {
      level: "success",
      event: "push",
      message: `Pushed note ${noteTitle}`,
      entityType: "note",
      entityId: noteId,
    });
    return "pushed";
  }

  // Remote is newer or equal timestamps — ask user. Notes are not versioned, so
  // there is no pre-pull snapshot to take (the pre-sync backup is the safety net).
  emitLog(options, {
    level: "warning",
    event: "conflict",
    message: `Note conflict: ${noteTitle}`,
    entityType: "note",
    entityId: noteId,
  });
  const choice = await onConflict({
    entityType: "note",
    entityId: noteId,
    entityTitle: noteTitle,
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
    await pushNoteBlob(noteId, new Blob([toBlobPart(encrypted)]), localChecksum, remote.remoteId);
    emitLog(options, {
      level: "success",
      event: "push",
      message: `Pushed note ${noteTitle}`,
      entityType: "note",
      entityId: noteId,
    });
    return "pushed";
  }

  // choice === "pull"
  const pulled = await pullNoteBlob(noteId);
  if (!pulled) return "skipped";

  const snapshot = await decryptNoteSnapshot(pulled.data, passphrase);
  await applyNoteSnapshot(snapshot);
  emitLog(options, {
    level: "success",
    event: "pull",
    message: `Pulled note ${noteId}`,
    entityType: "note",
    entityId: noteId,
  });
  return "pulled";
}

async function syncVersions(
  bookId: string,
  passphrase: string,
  options: SyncOptions = DEFAULT_SYNC_OPTIONS
): Promise<void> {
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
  if (canPush(options.direction)) {
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
  }

  // Pull remote-only versions. AES-GCM authenticates each blob on decrypt, so a
  // corrupt or tampered payload throws below — there is no separate integrity
  // check to do here. (The stored checksum is a content hash of the snapshot,
  // not a hash of the raw serialized blob, so re-hashing the decrypted payload
  // would never match it.) Each version is isolated so one bad blob cannot
  // abort the whole initial sync, but a wrong passphrase — which fails every
  // version — is surfaced rather than silently swallowed.
  if (canPull(options.direction)) {
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
  onConflict: ConflictResolver,
  options: SyncOptions
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
      options,
      remoteNotes,
      note.updated_at
    );
    actions.push(action);
    if (action === "cancelled") {
      return { actions, cancelled: true };
    }
  }

  // Pull remote-only notes (no local data — auto-pull, no conflict dialog)
  if (canPull(options.direction)) {
    for (const remote of remoteNotes) {
      if (localNoteIds.has(remote.noteId)) continue;
      const noteTombstone = await getTombstone("note", remote.noteId);
      if (noteTombstone) {
        emitLog(options, {
          level: "warning",
          event: "skip",
          message: `Skipped tombstoned remote note ${noteTombstone.title}`,
          entityType: "note",
          entityId: remote.noteId,
        });
        actions.push("skipped");
        continue;
      }

      const pulled = await pullNoteBlob(remote.noteId);
      if (!pulled) continue;

      const snapshot = await decryptNoteSnapshot(pulled.data, passphrase);
      await applyNoteSnapshot(snapshot);
      emitLog(options, {
        level: "success",
        event: "pull",
        message: `Pulled remote-only note ${snapshot.note.title}`,
        entityType: "note",
        entityId: remote.noteId,
      });
      actions.push("pulled");
    }
  }

  return { actions, cancelled: false };
}

async function syncMetrics(passphrase: string): Promise<void> {
  if (!useSettingsStore.getState().metrics.syncMetrics) return;
  await syncMetricsRows(passphrase);
}

export async function syncBook(
  bookId: string,
  passphrase: string,
  onConflict: ConflictResolver,
  optionsInput?: Partial<SyncOptions>
): Promise<SingleSyncResult> {
  assertNotSyncing();
  isSyncing = true;
  const options = resolveSyncOptions({ scope: "books", ...optionsInput });
  try {
    await ensureGenericCollectionMigration();
    await ensureAuth();
    await createPreSyncBackupOrThrow();
    emitLog(options, {
      level: "success",
      event: "backup",
      message: "Created pre-sync safety backup",
    });

    const deletionResult = await processPendingDeletions(["book"], options);
    if (deletionResult.pendingDeletions.length > 0) {
      return {
        outcome: "partial",
        action: "skipped",
        pendingDeletions: deletionResult.pendingDeletions,
      };
    }

    const action = await syncBookInBatch(bookId, passphrase, onConflict, options);
    if (action !== "cancelled") {
      await syncVersions(bookId, passphrase, options);
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

async function getNoteUpdatedAt(noteId: string): Promise<number> {
  const db = await getDatabase();
  const rows = await db.select<EffectiveTimestamp[]>(
    "SELECT updated_at FROM notes WHERE id = ?",
    [noteId]
  );
  return rows[0]?.updated_at ?? 0;
}

export async function syncSingleNote(
  noteId: string,
  passphrase: string,
  onConflict: ConflictResolver,
  optionsInput?: Partial<SyncOptions>
): Promise<SingleSyncResult> {
  assertNotSyncing();
  isSyncing = true;
  const options = resolveSyncOptions({ scope: "notes", ...optionsInput });
  try {
    await ensureGenericCollectionMigration();
    await ensureAuth();
    await createPreSyncBackupOrThrow();
    emitLog(options, {
      level: "success",
      event: "backup",
      message: "Created pre-sync safety backup",
    });

    const remoteNotes = await listRemoteNotes();
    const localUpdatedAt = await getNoteUpdatedAt(noteId);
    const action = await syncNoteInBatch(
      noteId,
      passphrase,
      onConflict,
      options,
      remoteNotes,
      localUpdatedAt
    );
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
  onConflict: ConflictResolver,
  optionsInput?: Partial<SyncOptions>
): Promise<BatchSyncResult> {
  assertNotSyncing();
  isSyncing = true;
  const options = resolveSyncOptions(optionsInput);
  try {
    await ensureGenericCollectionMigration();
    await ensureAuth();
    assertOnline();
    const actions: SyncAction[] = [];

    await createPreSyncBackupOrThrow();
    emitLog(options, {
      level: "success",
      event: "backup",
      message: "Created pre-sync safety backup",
    });

    const deletionScopes: SyncEntityType[] = [];
    if (includesScope(options.scope, "book")) deletionScopes.push("book");
    if (includesScope(options.scope, "note")) deletionScopes.push("note");
    const deletionResult = await processPendingDeletions(deletionScopes, options);
    actions.push(...deletionResult.actions);
    if (deletionResult.pendingDeletions.length > 0) {
      return {
        outcome: actions.length > 0 ? "partial" : "partial",
        actions,
        pendingDeletions: deletionResult.pendingDeletions,
      };
    }

    const db = await getDatabase();
    if (includesScope(options.scope, "book")) {
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
          options,
          remoteBooks,
          book.updated_at
        );
        if (action !== "cancelled") {
          await syncVersions(book.id, passphrase, options);
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
      if (canPull(options.direction)) {
        for (const remote of remoteBooks) {
          if (localBookIds.has(remote.bookId)) continue;
          const bookTombstone = await getTombstone("book", remote.bookId);
          if (bookTombstone) {
            emitLog(options, {
              level: "warning",
              event: "skip",
              message: `Skipped tombstoned remote book ${bookTombstone.title}`,
              entityType: "book",
              entityId: remote.bookId,
            });
            actions.push("skipped");
            continue;
          }

          const pulled = await pullBookBlob(remote.bookId);
          if (!pulled) continue;

          const snapshot = await decryptSnapshot(pulled.data, passphrase);
          await applyBookSnapshot(snapshot);
          emitLog(options, {
            level: "success",
            event: "pull",
            message: `Pulled remote-only book ${snapshot.book.title}`,
            entityType: "book",
            entityId: remote.bookId,
          });
          actions.push("pulled");
          await syncVersions(remote.bookId, passphrase, options);
        }
      }
    }

    // Notes sync alongside books in the same pass, sharing the auth check and
    // pre-sync backup. A cancelled note conflict aborts the rest of note sync.
    if (includesScope(options.scope, "note")) {
      const noteResult = await syncAllNotes(passphrase, onConflict, options);
      actions.push(...noteResult.actions);
      if (noteResult.cancelled) {
        await syncMetrics(passphrase);
        return {
          outcome: actions.some((entry) => entry !== "cancelled") ? "partial" : "cancelled",
          actions,
        };
      }
    }

    if (includesScope(options.scope, "metrics")) {
      await syncMetrics(passphrase);
    }

    return { outcome: "success", actions };
  } finally {
    isSyncing = false;
  }
}

export function resetSyncEngineForTests(): void {
  isSyncing = false;
}
