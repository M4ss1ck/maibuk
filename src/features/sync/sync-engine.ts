import { getDatabase } from "@/lib/db";
import { isSyncCryptoError } from "@/features/sync/crypto";
import {
  parseJsonAsync,
  computeChecksumAsync,
  normalizeNoteSnapshotAsync,
  normalizeBookSnapshotAsync,
  encryptToBuffer,
  decryptBufferToText,
} from "@/features/sync/sync-codec";
import {
  serializeBook,
  applyBookSnapshot,
  serializeNote,
  applyNoteSnapshot,
  removeLocalBook,
  removeLocalNote,
} from "@/features/sync/serializer";
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
  listRemoteDeletedBooks,
  listRemoteDeletedNotes,
} from "@/features/sync/client";
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
  RemoteDeletionMeta,
} from "@/features/sync/types";
import type { SyncAction, ConflictResolver } from "@/features/sync/types";
import { createBackup } from "@/lib/platform";
import { BackupService } from "@/features/backup/backup-service";
import { useSettingsStore } from "@/features/settings/store";
import { useSyncStore } from "@/features/sync/store";
import { useVersionStore } from "@/features/versions/store";
import { syncMetricsRows } from "@/features/metrics/metrics-sync";
import {
  getTombstone,
  listPendingTombstones,
  markTombstonePushed,
  tombstoneId,
} from "@/features/sync/tombstones";
import { ensureGenericCollectionMigration } from "@/features/sync/migration-reset";
import { createAsyncQueue } from "@/lib/async-queue";
import { shouldRefreshAuth } from "@/features/sync/auth-policy";
import { decideSyncAction } from "@/features/sync/sync-decision";
import { clearSyncBase, getSyncBase, setSyncBase } from "@/features/sync/sync-state";
import { flushPendingEdits } from "@/features/sync/pending-edits";

// FIFO serialization of all sync entrypoints (syncAllBooks, syncBook,
// syncSingleNote). Concurrent callers queue instead of failing: each queued
// operation runs to completion with its own passphrase, options, log and
// conflict callback, including its own pre-sync backup. The chain always
// advances, so a rejection or cancellation never blocks later requests.
let syncQueue = createAsyncQueue();
const PRE_SYNC_BACKUP_ERROR =
  "Could not create a safety backup. Sync aborted. Free up disk space and try again.";
const DEFAULT_SYNC_OPTIONS: SyncOptions = {
  scope: "all",
  direction: "bidirectional",
  confirmedDeletionIds: [],
};

async function decryptSnapshot(data: Uint8Array, passphrase: string): Promise<BookSnapshot> {
  const decrypted = await decryptBufferToText(data, passphrase);
  try {
    return await parseJsonAsync<BookSnapshot>(decrypted);
  } catch {
    throw new Error("Synced payload is invalid or corrupted");
  }
}

async function decryptNoteSnapshot(data: Uint8Array, passphrase: string): Promise<NoteSnapshot> {
  const decrypted = await decryptBufferToText(data, passphrase);
  try {
    return await parseJsonAsync<NoteSnapshot>(decrypted);
  } catch {
    throw new Error("Synced payload is invalid or corrupted");
  }
}

function assertOnline(): void {
  if (!navigator.onLine) {
    throw new Error("No internet connection");
  }
}

function resolveSyncOptions(options?: Partial<SyncOptions>): SyncOptions {
  return {
    ...DEFAULT_SYNC_OPTIONS,
    ...options,
    // Copy at enqueue time so a caller mutating its array afterwards cannot
    // affect the queued operation.
    confirmedDeletionIds: [...(options?.confirmedDeletionIds ?? [])],
  };
}

function includesScope(scope: SyncScope, entity: SyncEntityType | "metrics"): boolean {
  return (
    scope === "all" ||
    scope === entity ||
    (entity === "book" && scope === "books") ||
    (entity === "note" && scope === "notes")
  );
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

function emitLog(options: SyncOptions, entry: Omit<SyncLogEntry, "id" | "timestamp">): void {
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

// Runs are serialized by syncQueue, so one flag (and one review list) per run is safe.
let backupTakenThisRun = false;
// Items this run found deleted on another device, waiting for confirmation.
let remoteDeletionReviews: SyncDeletionReviewItem[] = [];

/** `{ pendingDeletions }` (local deletions first, then this run's reviews), or `{}` when none. */
function pendingDeletionsField(pending: SyncDeletionReviewItem[] = []): {
  pendingDeletions?: SyncDeletionReviewItem[];
} {
  const all = [...pending, ...remoteDeletionReviews];
  return all.length > 0 ? { pendingDeletions: all } : {};
}

function singleSyncResult(action: SyncAction): SingleSyncResult {
  const pending = pendingDeletionsField();
  return {
    outcome:
      action === "cancelled"
        ? "cancelled"
        : action === "deferred" || pending.pendingDeletions
          ? "partial"
          : "success",
    action,
    ...pending,
  };
}

async function ensurePreSyncBackup(options: SyncOptions): Promise<void> {
  if (backupTakenThisRun) return;
  await createPreSyncBackupOrThrow();
  backupTakenThisRun = true;
  emitLog(options, {
    level: "success",
    event: "backup",
    message: "Created pre-sync safety backup",
  });
}

/**
 * Open editors save what they hold before the run backs up or reads the Library.
 * A failed save rejects (PendingEditsFlushError) and stops the run: syncing now
 * would push or replace a Library that is missing the author's latest text.
 */
async function landPendingEdits(): Promise<void> {
  await flushPendingEdits();
}

async function beginSyncRun(options: SyncOptions): Promise<void> {
  backupTakenThisRun = false;
  remoteDeletionReviews = [];
  if (options.trigger === "auto") {
    emitLog(options, { level: "info", event: "scope", message: "Automatic sync" });
    // An automatic sync backs up only right before it first replaces local
    // data, so an idle run that finds nothing to pull does not dump the whole
    // database every time.
    return;
  }
  await ensurePreSyncBackup(options);
}

async function computeLocalBookChecksum(bookId: string): Promise<{ json: string; checksum: string }> {
  const json = await serializeBook(bookId);
  return { json, checksum: await computeChecksumAsync(await normalizeBookSnapshotAsync(json)) };
}

async function computeLocalNoteChecksum(noteId: string): Promise<{ json: string; checksum: string }> {
  const json = await serializeNote(noteId);
  return { json, checksum: await computeChecksumAsync(await normalizeNoteSnapshotAsync(json)) };
}

/** Only a local item without a live remote row can collide with a deleted one. */
async function listDeletionsIfNeeded(
  localIds: string[],
  liveIds: string[],
  list: () => Promise<RemoteDeletionMeta[]>
): Promise<RemoteDeletionMeta[]> {
  const live = new Set(liveIds);
  return localIds.some((id) => !live.has(id)) ? list() : [];
}

// A book whose remote row is deleted has no versions to reconcile unless this
// run restored it: otherwise it was removed here, awaits review, or was left.
function shouldSyncVersions(
  bookId: string,
  action: SyncAction,
  remoteBooks: SyncItemMeta[],
  remoteDeletions: RemoteDeletionMeta[]
): boolean {
  if (action === "cancelled") return false;
  if (action === "pushed") return true;
  return (
    remoteBooks.some((remote) => remote.bookId === bookId) ||
    !remoteDeletions.some((deletion) => deletion.entityId === bookId)
  );
}

interface RemoteDeletionContext {
  entityType: "book" | "note";
  entityId: string;
  title: string;
  localChecksum: string;
  localUpdatedAt: number;
  deletion: RemoteDeletionMeta;
  onConflict: ConflictResolver;
  options: SyncOptions;
  /** Uploads the local copy onto the given (deleted) row, restoring it. */
  revive: (remoteId: string) => Promise<SyncAction>;
  currentChecksum: () => Promise<string>;
}

async function removeDeletedElsewhere(ctx: RemoteDeletionContext): Promise<SyncAction> {
  await ensurePreSyncBackup(ctx.options);
  await (ctx.entityType === "book" ? removeLocalBook(ctx.entityId) : removeLocalNote(ctx.entityId));
  await clearSyncBase(ctx.entityType, ctx.entityId);
  emitLog(ctx.options, {
    level: "success",
    event: "pull",
    message: `Removed ${ctx.entityType} ${ctx.title}, deleted on another device`,
    entityType: ctx.entityType,
    entityId: ctx.entityId,
  });
  return "pulled";
}

// The item exists here, but its remote row is soft-deleted. That row still
// holds the server's unique identity, so the item is never re-created: an
// unedited copy follows the deletion once the user confirms it, and an edited
// one asks whether to restore it (update the deleted row) or delete it here.
async function resolveRemoteDeletion(ctx: RemoteDeletionContext): Promise<SyncAction> {
  const { entityType, entityId, title, options } = ctx;
  const label = entityType === "book" ? "Book" : "Note";
  const base = await getSyncBase(entityType, entityId);
  // Without a base this copy was never agreed with the server (a restore, or a
  // first sync here), so it may hold work the deletion never saw.
  const editedHere = !base || base.localChecksum !== ctx.localChecksum;

  if (!editedHere || options.direction === "pull") {
    if (!canPull(options.direction)) {
      emitLog(options, {
        level: "warning",
        event: "skip",
        message: `${label} ${title} was deleted on another device; run a two-way or pull sync to review it`,
        entityType,
        entityId,
      });
      return "skipped";
    }

    const reviewId = tombstoneId(entityType, entityId);
    if (!options.confirmedDeletionIds?.includes(reviewId)) {
      remoteDeletionReviews.push({
        id: reviewId,
        entityType,
        entityId,
        title,
        deletedAt: ctx.deletion.updatedAt,
        deletedRemotely: true,
      });
      emitLog(options, {
        level: "warning",
        event: "delete-pending",
        message: `Deleted on another device, needs confirmation: ${title}`,
        entityType,
        entityId,
      });
      return "skipped";
    }

    // The confirmation covered the copy the user reviewed. Land any pending
    // editor save and re-check, so an edit made since is not deleted with it.
    await flushPendingEdits();
    if ((await ctx.currentChecksum()) !== ctx.localChecksum) {
      emitLog(options, {
        level: "warning",
        event: "skip",
        message: `${label} ${title} changed during sync; it will sync next time`,
        entityType,
        entityId,
      });
      return "deferred";
    }
    return removeDeletedElsewhere(ctx);
  }

  emitLog(options, {
    level: "warning",
    event: "conflict",
    message: `${label} ${title} was deleted on another device but changed here`,
    entityType,
    entityId,
  });
  const choice = await ctx.onConflict({
    entityType,
    entityId,
    entityTitle: title,
    bookId: entityId,
    bookTitle: title,
    localUpdatedAt: ctx.localUpdatedAt,
    remoteUpdatedAt: ctx.deletion.updatedAt,
    remoteDeleted: true,
  });

  if (choice === "cancel") return "cancelled";
  if (choice === "skip") {
    emitLog(options, {
      level: "warning",
      event: "skip",
      message: `${label} ${title} was deleted on another device but changed here; run a manual sync to choose`,
      entityType,
      entityId,
    });
    return "deferred";
  }
  if (choice === "push") return ctx.revive(ctx.deletion.remoteId);
  return removeDeletedElsewhere(ctx);
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
    await clearSyncBase(tombstone.entityType === "book" ? "book" : "note", tombstone.entityId);
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
  // Checking only authVerified let a sync run on a token that had expired while
  // the app stayed open. PocketBase treats an expired token as a guest, whose
  // owner-scoped list requests come back empty rather than failing, so a stale
  // token must be renewed (or rejected) before the sync reads remote state.
  const { authVerified, authToken, authRefreshedAt } = useSyncStore.getState();
  if (
    !shouldRefreshAuth({
      token: authToken ?? null,
      authVerified,
      refreshedAt: authRefreshedAt ?? null,
      now: Date.now(),
    })
  ) {
    return;
  }

  try {
    const result = await pbRefreshAuth();
    useSyncStore.setState({
      authStatus: "logged-in",
      userEmail: result.email,
      authToken: result.token,
      authVerified: true,
      authRefreshedAt: Date.now(),
    });
  } catch (error: unknown) {
    const status = (error as { status?: number }).status;
    if (status === 401) {
      useSyncStore.setState({
        authStatus: "logged-out",
        userEmail: null,
        authToken: null,
        authVerified: false,
        authRefreshedAt: null,
      });
      throw new Error("sync.sessionExpired");
    }
    throw error;
  }
}

async function pullBook(
  bookId: string,
  bookTitle: string,
  remote: SyncItemMeta,
  passphrase: string,
  options: SyncOptions
): Promise<SyncAction> {
  await ensurePreSyncBackup(options);
  await useVersionStore.getState().createVersion({ bookId, triggerType: "pre-sync" });
  const pulled = await pullBookBlob(bookId, remote.remoteId);
  if (!pulled) return "skipped";

  const snapshot = await decryptSnapshot(pulled.data, passphrase);
  await applyBookSnapshot(snapshot);
  const { checksum } = await computeLocalBookChecksum(bookId);
  await setSyncBase("book", bookId, { localChecksum: checksum, remoteChecksum: remote.checksum });
  emitLog(options, {
    level: "success",
    event: "pull",
    message: `Pulled book ${bookTitle}`,
    entityType: "book",
    entityId: bookId,
  });
  return "pulled";
}

async function syncBookInBatch(
  bookId: string,
  passphrase: string,
  onConflict: ConflictResolver,
  options: SyncOptions,
  remoteBooks: SyncItemMeta[],
  remoteDeletions: RemoteDeletionMeta[],
  precomputedLocalUpdatedAt?: number
): Promise<SyncAction> {
  assertOnline();

  const { json, checksum: localChecksum } = await computeLocalBookChecksum(bookId);
  const bookTitle = await getBookTitle(bookId);
  // Reuse the timestamp from syncAllBooks' GROUP BY query when available,
  // avoiding a redundant per-book MAX query.
  const localUpdatedAt = precomputedLocalUpdatedAt ?? (await getLocalUpdatedAt(bookId));

  const remote = remoteBooks.find((r) => r.bookId === bookId);

  const push = async (remoteId?: string): Promise<SyncAction> => {
    const encrypted = await encryptToBuffer(json, passphrase);
    const blob = new Blob([encrypted]);
    // A local-only item has no remote row yet: create it (no remoteId argument).
    await (remoteId
      ? pushBookBlob(bookId, blob, localChecksum, remoteId)
      : pushBookBlob(bookId, blob, localChecksum));
    await setSyncBase("book", bookId, { localChecksum, remoteChecksum: localChecksum });
    emitLog(options, {
      level: "success",
      event: "push",
      message: `Pushed book ${bookTitle}`,
      entityType: "book",
      entityId: bookId,
    });
    return "pushed";
  };

  if (!remote) {
    const deletion = remoteDeletions.find((d) => d.entityId === bookId);
    if (deletion) {
      return resolveRemoteDeletion({
        entityType: "book",
        entityId: bookId,
        title: bookTitle,
        localChecksum,
        localUpdatedAt,
        deletion,
        onConflict,
        options,
        revive: push,
        currentChecksum: async () => (await computeLocalBookChecksum(bookId)).checksum,
      });
    }
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
    return push();
  }

  const base = await getSyncBase("book", bookId);

  // Books pushed before the checksum ignored navigation state carry the raw
  // snapshot checksum. An unchanged book still matches it: adopt it as the base
  // instead of reporting a conflict on the first sync after upgrading.
  if (
    !base &&
    remote.checksum !== localChecksum &&
    remote.checksum === (await computeChecksumAsync(json))
  ) {
    await setSyncBase("book", bookId, { localChecksum, remoteChecksum: remote.checksum });
    emitLog(options, {
      level: "info",
      event: "skip",
      message: `Skipped unchanged book ${bookTitle}`,
      entityType: "book",
      entityId: bookId,
    });
    return "skipped";
  }

  const decision = decideSyncAction({
    localChecksum,
    remoteChecksum: remote.checksum,
    base,
    direction: options.direction,
    localUpdatedAt,
    remoteUpdatedAt: remote.updatedAt,
  });

  if (decision === "in-sync" || decision === "unchanged") {
    if (
      decision === "in-sync" &&
      (base?.localChecksum !== localChecksum || base?.remoteChecksum !== remote.checksum)
    ) {
      await setSyncBase("book", bookId, { localChecksum, remoteChecksum: remote.checksum });
    }
    emitLog(options, {
      level: "info",
      event: "skip",
      message: `Skipped unchanged book ${bookTitle}`,
      entityType: "book",
      entityId: bookId,
    });
    return "skipped";
  }

  if (decision === "push") return push(remote.remoteId);

  if (decision === "pull") {
    // Only the remote changed, so nobody was asked. Land any pending editor
    // save and re-check: an edit made while this sync ran must not be replaced.
    if (options.direction === "bidirectional") {
      await flushPendingEdits();
      const { checksum: current } = await computeLocalBookChecksum(bookId);
      if (current !== localChecksum) {
        emitLog(options, {
          level: "warning",
          event: "skip",
          message: `Book ${bookTitle} changed during sync; it will sync next time`,
          entityType: "book",
          entityId: bookId,
        });
        return "deferred";
      }
    }
    return pullBook(bookId, bookTitle, remote, passphrase, options);
  }

  // Both sides changed (or no base and the remote looks newer): ask.
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
  if (choice === "skip") {
    emitLog(options, {
      level: "warning",
      event: "skip",
      message: `Book ${bookTitle} changed here and on another device; run a manual sync to choose`,
      entityType: "book",
      entityId: bookId,
    });
    return "deferred";
  }
  if (choice === "push") {
    return push(remote.remoteId);
  }
  return pullBook(bookId, bookTitle, remote, passphrase, options);
}

async function pullNote(
  noteId: string,
  noteTitle: string,
  remote: NoteSyncItemMeta,
  passphrase: string,
  options: SyncOptions
): Promise<SyncAction> {
  await ensurePreSyncBackup(options);
  const pulled = await pullNoteBlob(noteId, remote.remoteId);
  if (!pulled) return "skipped";

  const snapshot = await decryptNoteSnapshot(pulled.data, passphrase);
  await applyNoteSnapshot(snapshot);
  const { checksum } = await computeLocalNoteChecksum(noteId);
  await setSyncBase("note", noteId, { localChecksum: checksum, remoteChecksum: remote.checksum });
  emitLog(options, {
    level: "success",
    event: "pull",
    message: `Pulled note ${noteTitle}`,
    entityType: "note",
    entityId: noteId,
  });
  return "pulled";
}

async function syncNoteInBatch(
  noteId: string,
  passphrase: string,
  onConflict: ConflictResolver,
  options: SyncOptions,
  remoteNotes: NoteSyncItemMeta[],
  remoteDeletions: RemoteDeletionMeta[],
  localUpdatedAt: number
): Promise<SyncAction> {
  assertOnline();

  const { json, checksum: localChecksum } = await computeLocalNoteChecksum(noteId);
  const noteTitle = await getNoteTitle(noteId);

  const remote = remoteNotes.find((r) => r.noteId === noteId);

  const push = async (remoteId?: string): Promise<SyncAction> => {
    const encrypted = await encryptToBuffer(json, passphrase);
    const blob = new Blob([encrypted]);
    // A local-only item has no remote row yet: create it (no remoteId argument).
    await (remoteId
      ? pushNoteBlob(noteId, blob, localChecksum, remoteId)
      : pushNoteBlob(noteId, blob, localChecksum));
    await setSyncBase("note", noteId, { localChecksum, remoteChecksum: localChecksum });
    emitLog(options, {
      level: "success",
      event: "push",
      message: `Pushed note ${noteTitle}`,
      entityType: "note",
      entityId: noteId,
    });
    return "pushed";
  };

  if (!remote) {
    const deletion = remoteDeletions.find((d) => d.entityId === noteId);
    if (deletion) {
      return resolveRemoteDeletion({
        entityType: "note",
        entityId: noteId,
        title: noteTitle,
        localChecksum,
        localUpdatedAt,
        deletion,
        onConflict,
        options,
        revive: push,
        currentChecksum: async () => (await computeLocalNoteChecksum(noteId)).checksum,
      });
    }
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
    return push();
  }

  const base = await getSyncBase("note", noteId);
  const decision = decideSyncAction({
    localChecksum,
    remoteChecksum: remote.checksum,
    base,
    direction: options.direction,
    localUpdatedAt,
    remoteUpdatedAt: remote.updatedAt,
  });

  if (decision === "in-sync" || decision === "unchanged") {
    if (
      decision === "in-sync" &&
      (base?.localChecksum !== localChecksum || base?.remoteChecksum !== remote.checksum)
    ) {
      await setSyncBase("note", noteId, { localChecksum, remoteChecksum: remote.checksum });
    }
    emitLog(options, {
      level: "info",
      event: "skip",
      message: `Skipped unchanged note ${noteTitle}`,
      entityType: "note",
      entityId: noteId,
    });
    return "skipped";
  }

  if (decision === "push") return push(remote.remoteId);

  if (decision === "pull") {
    // Only the remote changed, so nobody was asked. Land any pending editor
    // save and re-check: an edit made while this sync ran must not be replaced.
    if (options.direction === "bidirectional") {
      await flushPendingEdits();
      const { checksum: current } = await computeLocalNoteChecksum(noteId);
      if (current !== localChecksum) {
        emitLog(options, {
          level: "warning",
          event: "skip",
          message: `Note ${noteTitle} changed during sync; it will sync next time`,
          entityType: "note",
          entityId: noteId,
        });
        return "deferred";
      }
    }
    return pullNote(noteId, noteTitle, remote, passphrase, options);
  }

  // Both sides changed (or no base and the remote looks newer): ask. Notes are
  // not versioned, so there is no pre-pull snapshot to take (the pre-sync
  // backup is the safety net).
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
  if (choice === "skip") {
    emitLog(options, {
      level: "warning",
      event: "skip",
      message: `Note ${noteTitle} changed here and on another device; run a manual sync to choose`,
      entityType: "note",
      entityId: noteId,
    });
    return "deferred";
  }
  if (choice === "push") {
    return push(remote.remoteId);
  }
  return pullNote(noteId, noteTitle, remote, passphrase, options);
}

async function syncVersions(
  bookId: string,
  passphrase: string,
  options: SyncOptions = DEFAULT_SYNC_OPTIONS
): Promise<void> {
  const db = await getDatabase();

  const localRows = await db.select<
    {
      id: string;
      checksum: string;
      name: string | null;
      trigger_type: string;
      created_at: number;
      word_count: number;
      snapshot: string;
    }[]
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
        const encrypted = await encryptToBuffer(local.snapshot, passphrase);
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

        const now = Math.floor(Date.now() / 1000);
        await db.execute("UPDATE book_versions SET synced_at = ? WHERE id = ?", [now, local.id]);
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

        const decrypted = await decryptBufferToText(blob.data, passphrase);

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
  const localNotes = await db.select<NoteTimestampRow[]>("SELECT id, updated_at FROM notes");
  const localNoteIds = new Set(localNotes.map((n) => n.id));

  const remoteNotes = await listRemoteNotes();
  const remoteDeletions = await listDeletionsIfNeeded(
    localNotes.map((note) => note.id),
    remoteNotes.map((remote) => remote.noteId),
    listRemoteDeletedNotes
  );
  const actions: SyncAction[] = [];

  for (const note of localNotes) {
    const action = await syncNoteInBatch(
      note.id,
      passphrase,
      onConflict,
      options,
      remoteNotes,
      remoteDeletions,
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

      await ensurePreSyncBackup(options);
      const pulled = await pullNoteBlob(remote.noteId, remote.remoteId);
      if (!pulled) continue;

      const snapshot = await decryptNoteSnapshot(pulled.data, passphrase);
      await applyNoteSnapshot(snapshot);
      const { checksum } = await computeLocalNoteChecksum(remote.noteId);
      await setSyncBase("note", remote.noteId, {
        localChecksum: checksum,
        remoteChecksum: remote.checksum,
      });
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

// Only log metrics push progress when there's a real backlog (e.g. the one-time
// post-cutover re-upload), so ordinary incremental syncs stay quiet.
const METRICS_PROGRESS_LOG_THRESHOLD = 200;

async function syncMetrics(passphrase: string, options?: SyncOptions): Promise<void> {
  if (!useSettingsStore.getState().metrics.syncMetrics) return;
  await syncMetricsRows(passphrase, ({ pushed, total }) => {
    if (!options || total <= METRICS_PROGRESS_LOG_THRESHOLD) return;
    emitLog(options, {
      level: "info",
      event: "push",
      message: `Uploading metrics… ${pushed}/${total}`,
      entityType: "metrics",
      entityId: "metrics",
    });
  });
}

export async function syncBook(
  bookId: string,
  passphrase: string,
  onConflict: ConflictResolver,
  optionsInput?: Partial<SyncOptions>
): Promise<SingleSyncResult> {
  // Normalized here — at enqueue time — so each queued caller keeps its own
  // options snapshot (including its own confirmedDeletionIds copy).
  const options = resolveSyncOptions({ scope: "books", ...optionsInput });
  return syncQueue.enqueue(() => syncBookInternal(bookId, passphrase, onConflict, options));
}

async function syncBookInternal(
  bookId: string,
  passphrase: string,
  onConflict: ConflictResolver,
  options: SyncOptions
): Promise<SingleSyncResult> {
  await ensureGenericCollectionMigration();
  await ensureAuth();
  await landPendingEdits();
  await beginSyncRun(options);

  const deletionResult = await processPendingDeletions(["book"], options);
  if (deletionResult.pendingDeletions.length > 0) {
    return {
      outcome: "partial",
      action: "skipped",
      pendingDeletions: deletionResult.pendingDeletions,
    };
  }

  const remoteBooks = await listRemoteBooks();
  const remoteDeletions = await listDeletionsIfNeeded(
    [bookId],
    remoteBooks.map((remote) => remote.bookId),
    listRemoteDeletedBooks
  );
  const action = await syncBookInBatch(
    bookId,
    passphrase,
    onConflict,
    options,
    remoteBooks,
    remoteDeletions
  );
  if (shouldSyncVersions(bookId, action, remoteBooks, remoteDeletions)) {
    await syncVersions(bookId, passphrase, options);
  }
  await syncMetrics(passphrase, options);
  return singleSyncResult(action);
}

async function getNoteUpdatedAt(noteId: string): Promise<number> {
  const db = await getDatabase();
  const rows = await db.select<EffectiveTimestamp[]>("SELECT updated_at FROM notes WHERE id = ?", [
    noteId,
  ]);
  return rows[0]?.updated_at ?? 0;
}

export async function syncSingleNote(
  noteId: string,
  passphrase: string,
  onConflict: ConflictResolver,
  optionsInput?: Partial<SyncOptions>
): Promise<SingleSyncResult> {
  // Normalized here — at enqueue time — so each queued caller keeps its own
  // options snapshot (including its own confirmedDeletionIds copy).
  const options = resolveSyncOptions({ scope: "notes", ...optionsInput });
  return syncQueue.enqueue(() => syncSingleNoteInternal(noteId, passphrase, onConflict, options));
}

async function syncSingleNoteInternal(
  noteId: string,
  passphrase: string,
  onConflict: ConflictResolver,
  options: SyncOptions
): Promise<SingleSyncResult> {
  await ensureGenericCollectionMigration();
  await ensureAuth();
  await landPendingEdits();
  await beginSyncRun(options);

  const remoteNotes = await listRemoteNotes();
  const remoteDeletions = await listDeletionsIfNeeded(
    [noteId],
    remoteNotes.map((remote) => remote.noteId),
    listRemoteDeletedNotes
  );
  const localUpdatedAt = await getNoteUpdatedAt(noteId);
  const action = await syncNoteInBatch(
    noteId,
    passphrase,
    onConflict,
    options,
    remoteNotes,
    remoteDeletions,
    localUpdatedAt
  );
  await syncMetrics(passphrase, options);
  return singleSyncResult(action);
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
  // Normalized here — at enqueue time — so each queued caller keeps its own
  // options snapshot (including its own confirmedDeletionIds copy).
  const options = resolveSyncOptions(optionsInput);
  return syncQueue.enqueue(() => syncAllBooksInternal(passphrase, onConflict, options));
}

async function syncAllBooksInternal(
  passphrase: string,
  onConflict: ConflictResolver,
  options: SyncOptions
): Promise<BatchSyncResult> {
  await ensureGenericCollectionMigration();
  await ensureAuth();
  assertOnline();
  const actions: SyncAction[] = [];

    await landPendingEdits();
    await beginSyncRun(options);

    const deletionScopes: SyncEntityType[] = [];
    if (includesScope(options.scope, "book")) deletionScopes.push("book");
    if (includesScope(options.scope, "note")) deletionScopes.push("note");
    const deletionResult = await processPendingDeletions(deletionScopes, options);
    actions.push(...deletionResult.actions);
    const { pendingDeletions } = deletionResult;
    // A manual sync stops so the deletions are reviewed first. An automatic
    // sync keeps syncing everything else: tombstones already keep the deleted
    // items from being pulled back, and the review waits for the user.
    if (pendingDeletions.length > 0 && options.trigger !== "auto") {
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
      const remoteBookDeletions = await listDeletionsIfNeeded(
        localBooks.map((book) => book.id),
        remoteBooks.map((remote) => remote.bookId),
        listRemoteDeletedBooks
      );

      for (const book of localBooks) {
        const action = await syncBookInBatch(
          book.id,
          passphrase,
          onConflict,
          options,
          remoteBooks,
          remoteBookDeletions,
          book.updated_at
        );
        if (shouldSyncVersions(book.id, action, remoteBooks, remoteBookDeletions)) {
          await syncVersions(book.id, passphrase, options);
        }
        actions.push(action);
        if (action === "cancelled") {
          await syncMetrics(passphrase, options);
          return {
            outcome: actions.some((entry) => entry !== "cancelled") ? "partial" : "cancelled",
            actions,
            ...pendingDeletionsField(pendingDeletions),
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

          await ensurePreSyncBackup(options);
          const pulled = await pullBookBlob(remote.bookId, remote.remoteId);
          if (!pulled) continue;

          const snapshot = await decryptSnapshot(pulled.data, passphrase);
          await applyBookSnapshot(snapshot);
          const { checksum } = await computeLocalBookChecksum(remote.bookId);
          await setSyncBase("book", remote.bookId, {
            localChecksum: checksum,
            remoteChecksum: remote.checksum,
          });
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
        await syncMetrics(passphrase, options);
        return {
          outcome: actions.some((entry) => entry !== "cancelled") ? "partial" : "cancelled",
          actions,
          ...pendingDeletionsField(pendingDeletions),
        };
      }
    }

    if (includesScope(options.scope, "metrics")) {
      await syncMetrics(passphrase, options);
    }

    const pending = pendingDeletionsField(pendingDeletions);
    if (pending.pendingDeletions) {
      return { outcome: "partial", actions, ...pending };
    }
    return { outcome: actions.includes("deferred") ? "partial" : "success", actions };
}

export function resetSyncEngineForTests(): void {
  // Drop any settled chain state so tests start from a clean queue.
  syncQueue = createAsyncQueue();
}
