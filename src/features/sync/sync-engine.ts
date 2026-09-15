import { getDatabase } from "@/lib/db";
import { isSyncCryptoError } from "@/features/sync/crypto";
import {
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
  refreshAuth as pbRefreshAuth,
  listRemoteVersions,
  pushVersionBlob,
  pullVersionBlob,
} from "@/features/sync/client";
import type {
  BookSnapshot,
  NoteSnapshot,
  SingleSyncResult,
  BatchSyncResult,
  SyncOptions,
  SyncScope,
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
import { ensureGenericCollectionMigration } from "@/features/sync/migration-reset";
import { createAsyncQueue } from "@/lib/async-queue";
import { shouldRefreshAuth } from "@/features/sync/auth-policy";
import { flushPendingEdits } from "@/features/sync/pending-edits";
import {
  canPull,
  canPush,
  processPendingDeletions,
  syncEntity,
  syncEntityBatch,
  type BatchSeen,
  type EntityDeletionRegistry,
  type EntitySyncAdapter,
  type EntitySyncContext,
} from "@/features/sync/entity-sync";
import { pocketBaseRemote, type RemoteItemMeta } from "@/features/sync/remote-port";

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

interface LocalIdRow {
  id: string;
  updated_at: number;
}

interface TitleRow {
  title: string;
}

// The Book side of Entity Sync: local reads through the serializer and the
// same timestamp/title queries the per-book copies used, remote operations
// through the Remote port. The pre-pull Checkpoint stays here because only
// the engine may touch the version store. Exported for per-adapter tests.
export const bookAdapter: EntitySyncAdapter<BookSnapshot> = {
  entityType: "book",
  label: "Book",

  async listLocal() {
    const db = await getDatabase();
    const rows = await db.select<LocalIdRow[]>(
      `SELECT b.id, MAX(b.updated_at, COALESCE(MAX(c.updated_at), 0)) AS updated_at
       FROM books b
       LEFT JOIN chapters c ON c.book_id = b.id
       GROUP BY b.id`
    );
    return rows.map((row) => ({ id: row.id, updatedAt: row.updated_at }));
  },

  async getLocalUpdatedAt(bookId) {
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
  },

  async getTitle(bookId) {
    const db = await getDatabase();
    const rows = await db.select<TitleRow[]>("SELECT title FROM books WHERE id = ?", [bookId]);
    return rows[0]?.title ?? bookId;
  },

  async snapshotChecksums(bookId) {
    const json = await serializeBook(bookId);
    return { json, checksum: await computeChecksumAsync(await normalizeBookSnapshotAsync(json)) };
  },

  async legacyRawChecksum(json) {
    return computeChecksumAsync(json);
  },

  titleOfSnapshot(snapshot) {
    return snapshot.book.title;
  },

  async applySnapshot(snapshot) {
    await applyBookSnapshot(snapshot);
  },

  async removeLocal(bookId) {
    await removeLocalBook(bookId);
  },

  async currentChecksum(bookId) {
    return (await this.snapshotChecksums(bookId)).checksum;
  },

  async beforePull(bookId) {
    await useVersionStore.getState().createVersion({ bookId, triggerType: "pre-sync" });
  },
};

// The Note side of Entity Sync. Notes are not versioned, so there is no
// pre-pull snapshot to take (the pre-sync backup is the safety net) and no
// legacy checksum history to adopt. Exported for per-adapter tests.
export const noteAdapter: EntitySyncAdapter<NoteSnapshot> = {
  entityType: "note",
  label: "Note",

  async listLocal() {
    const db = await getDatabase();
    const rows = await db.select<LocalIdRow[]>("SELECT id, updated_at FROM notes");
    return rows.map((row) => ({ id: row.id, updatedAt: row.updated_at }));
  },

  async getLocalUpdatedAt(noteId) {
    const db = await getDatabase();
    const rows = await db.select<EffectiveTimestamp[]>(
      "SELECT updated_at FROM notes WHERE id = ?",
      [noteId]
    );
    return rows[0]?.updated_at ?? 0;
  },

  async getTitle(noteId) {
    const db = await getDatabase();
    const rows = await db.select<TitleRow[]>("SELECT title FROM notes WHERE id = ?", [noteId]);
    return rows[0]?.title ?? noteId;
  },

  async snapshotChecksums(noteId) {
    const json = await serializeNote(noteId);
    return { json, checksum: await computeChecksumAsync(await normalizeNoteSnapshotAsync(json)) };
  },

  async legacyRawChecksum() {
    return null;
  },

  titleOfSnapshot(snapshot) {
    return snapshot.note.title;
  },

  async applySnapshot(snapshot) {
    await applyNoteSnapshot(snapshot);
  },

  async removeLocal(noteId) {
    await removeLocalNote(noteId);
  },

  async currentChecksum(noteId) {
    return (await this.snapshotChecksums(noteId)).checksum;
  },
};

// Pending deletions dispatch through this registry keyed by entityType. Only
// Book and Note sync — a tombstone of any other kind has no entry and is
// skipped, never sent to another kind's delete.
const deletionRegistry: EntityDeletionRegistry = {
  book: { deleteRemote: (entityId) => pocketBaseRemote.deleteRemote("book", entityId) },
  note: { deleteRemote: (entityId) => pocketBaseRemote.deleteRemote("note", entityId) },
};

function entityContext(
  passphrase: string,
  onConflict: ConflictResolver,
  options: SyncOptions
): EntitySyncContext {
  return {
    passphrase,
    onConflict,
    options,
    remote: pocketBaseRemote,
    ensureBackup: () => ensurePreSyncBackup(options),
    emitLog: (entry) => emitLog(options, entry),
    queueRemoteDeletionReview: (item) => {
      remoteDeletionReviews.push(item);
    },
  };
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

// A book whose remote row is deleted has no versions to reconcile unless this
// run restored it: otherwise it was removed here, awaits review, or was left.
function shouldSyncVersions(
  bookId: string,
  action: SyncAction,
  remoteBooks: RemoteItemMeta[],
  remoteDeletions: RemoteDeletionMeta[]
): boolean {
  if (action === "cancelled") return false;
  if (action === "pushed") return true;
  return (
    remoteBooks.some((remote) => remote.entityId === bookId) ||
    !remoteDeletions.some((deletion) => deletion.entityId === bookId)
  );
}

function afterBookItem(
  passphrase: string,
  options: SyncOptions
): (id: string, action: SyncAction, seen: BatchSeen) => Promise<void> {
  return async (id, action, seen) => {
    if (shouldSyncVersions(id, action, seen.remotes, seen.deletions)) {
      await syncVersions(id, passphrase, options);
    }
  };
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
  const ctx = entityContext(passphrase, onConflict, options);

  const deletionResult = await processPendingDeletions(
    deletionRegistry,
    ["book"],
    options,
    ctx.emitLog
  );
  if (deletionResult.pendingDeletions.length > 0) {
    return {
      outcome: "partial",
      action: "skipped",
      pendingDeletions: deletionResult.pendingDeletions,
    };
  }

  const remotes = await pocketBaseRemote.list("book");
  const live = new Set(remotes.map((remote) => remote.entityId));
  const deletions = live.has(bookId) ? [] : await pocketBaseRemote.listDeleted("book");
  const action = await syncEntity(bookAdapter, bookId, ctx, { remotes, deletions });
  if (shouldSyncVersions(bookId, action, remotes, deletions)) {
    await syncVersions(bookId, passphrase, options);
  }
  await syncMetrics(passphrase, options);
  return singleSyncResult(action);
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
  const ctx = entityContext(passphrase, onConflict, options);

  const remotes = await pocketBaseRemote.list("note");
  const live = new Set(remotes.map((remote) => remote.entityId));
  const deletions = live.has(noteId) ? [] : await pocketBaseRemote.listDeleted("note");
  const localUpdatedAt = await noteAdapter.getLocalUpdatedAt(noteId);
  const action = await syncEntity(noteAdapter, noteId, ctx, { remotes, deletions }, localUpdatedAt);
  await syncMetrics(passphrase, options);
  return singleSyncResult(action);
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
  const ctx = entityContext(passphrase, onConflict, options);

  const deletionScopes: SyncEntityType[] = [];
  if (includesScope(options.scope, "book")) deletionScopes.push("book");
  if (includesScope(options.scope, "note")) deletionScopes.push("note");
  const deletionResult = await processPendingDeletions(
    deletionRegistry,
    deletionScopes,
    options,
    ctx.emitLog
  );
  actions.push(...deletionResult.actions);
  const { pendingDeletions } = deletionResult;
  // A manual sync stops so the deletions are reviewed first. An automatic
  // sync keeps syncing everything else: tombstones already keep the deleted
  // items from being pulled back, and the review waits for the user.
  if (pendingDeletions.length > 0 && options.trigger !== "auto") {
    return {
      outcome: "partial",
      actions,
      pendingDeletions: deletionResult.pendingDeletions,
    };
  }

  if (includesScope(options.scope, "book")) {
    const bookBatch = await syncEntityBatch(bookAdapter, ctx, {
      afterItem: afterBookItem(passphrase, options),
    });
    actions.push(...bookBatch.actions);
    if (bookBatch.cancelled) {
      await syncMetrics(passphrase, options);
      return {
        outcome: actions.some((entry) => entry !== "cancelled") ? "partial" : "cancelled",
        actions,
        ...pendingDeletionsField(pendingDeletions),
      };
    }
  }

  // Notes sync alongside books in the same pass, sharing the auth check and
  // pre-sync backup. A cancelled note conflict aborts the rest of note sync.
  if (includesScope(options.scope, "note")) {
    const noteBatch = await syncEntityBatch(noteAdapter, ctx);
    actions.push(...noteBatch.actions);
    if (noteBatch.cancelled) {
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
