// Entity Sync: the one shared Push, Pull, and Conflict flow every Synced Item
// follows (Book or Note today; Canvas joins with its own adapter later).
// Per-kind behavior lives in an EntitySyncAdapter; this module owns the
// orchestration — three-way decision via decideSyncAction, conflict and
// Deletion Review handling, Deleted Elsewhere resolution, pre-sync backup and
// pending-edits flush ordering, Sync Log events, and SyncAction results —
// exactly as the per-kind copies behaved before.
//
// This module never imports UI stores. Store state (settings, versions,
// auth) is resolved at the public boundary in sync-engine.ts and passed in
// through the adapter hooks and the run context.
import { decideSyncAction } from "@/features/sync/sync-decision";
import { clearSyncBase, getSyncBase, setSyncBase } from "@/features/sync/sync-state";
import { flushPendingEdits } from "@/features/sync/pending-edits";
import {
  getTombstone,
  listPendingTombstones,
  markTombstonePushed,
  tombstoneId,
} from "@/features/sync/tombstones";
import {
  decryptBufferToText,
  encryptToBuffer,
  parseJsonAsync,
} from "@/features/sync/sync-codec";
import type { EntityRemote, EntityRemoteKind, RemoteItemMeta } from "@/features/sync/remote-port";
import type {
  ConflictResolver,
  RemoteDeletionMeta,
  SyncAction,
  SyncDeletionReviewItem,
  SyncDirection,
  SyncEntityType,
  SyncLogEntry,
  SyncOptions,
} from "@/features/sync/types";

export interface LocalEntry {
  id: string;
  updatedAt: number;
}

/**
 * Per-kind behavior for one synced kind. Local reads/writes go through the
 * existing serializer and checksum paths; remote operations go through the
 * Remote port (never directly to the client). The book adapter's beforePull
 * takes the pre-pull Checkpoint; notes have no beforePull.
 */
export interface EntitySyncAdapter<TSnapshot> {
  entityType: EntityRemoteKind;
  /** Capitalized kind for log and Conflict messages ("Book", "Note"). */
  label: string;
  listLocal(): Promise<LocalEntry[]>;
  getLocalUpdatedAt(id: string): Promise<number>;
  getTitle(id: string): Promise<string>;
  /** Snapshot JSON plus its normalized checksum. */
  snapshotChecksums(id: string): Promise<{ json: string; checksum: string }>;
  /**
   * Legacy checksum of the raw snapshot, or null when the kind has no
   * pre-checksum history to adopt (notes). Lets an unchanged item adopt its
   * base instead of conflicting on the first sync after upgrading.
   */
  legacyRawChecksum(json: string): Promise<string | null>;
  titleOfSnapshot(snapshot: TSnapshot): string;
  applySnapshot(snapshot: TSnapshot): Promise<void>;
  removeLocal(id: string): Promise<void>;
  currentChecksum(id: string): Promise<string>;
  beforePull?(id: string): Promise<void>;
}

export interface EntitySyncContext {
  passphrase: string;
  onConflict: ConflictResolver;
  options: SyncOptions;
  remote: EntityRemote;
  /** Pre-sync safety backup, taken once per run (owned by sync-engine). */
  ensureBackup(): Promise<void>;
  emitLog(entry: Omit<SyncLogEntry, "id" | "timestamp">): void;
  /** Items found Deleted Elsewhere, waiting for the author's confirmation. */
  queueRemoteDeletionReview(item: SyncDeletionReviewItem): void;
}

export function canPull(direction: SyncDirection): boolean {
  return direction !== "push";
}

export function canPush(direction: SyncDirection): boolean {
  return direction !== "pull";
}

function assertOnline(): void {
  if (!navigator.onLine) {
    throw new Error("No internet connection");
  }
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

async function decryptSnapshot<T>(data: Uint8Array, passphrase: string): Promise<T> {
  const decrypted = await decryptBufferToText(data, passphrase);
  try {
    return await parseJsonAsync<T>(decrypted);
  } catch {
    throw new Error("Synced payload is invalid or corrupted");
  }
}

/**
 * Pull one item through the same path for single pulls, conflict pulls, and
 * remote-only pulls: backup, fetch, decrypt, apply, re-checksum, base, log.
 * The per-kind pre-pull hook (the Book Checkpoint) runs only when pulling
 * over an existing local copy — a remote-only item has nothing to snapshot,
 * same as the old inline pull loops.
 */
export async function pullEntity<TSnapshot>(
  adapter: EntitySyncAdapter<TSnapshot>,
  id: string,
  remote: RemoteItemMeta,
  ctx: EntitySyncContext,
  opts: { title?: string; remoteOnly: boolean }
): Promise<SyncAction> {
  await ctx.ensureBackup();
  if (!opts.remoteOnly) {
    await adapter.beforePull?.(id);
  }
  const pulled = await ctx.remote.pullBlob(adapter.entityType, id, remote.remoteId);
  if (!pulled) return "skipped";

  const snapshot = await decryptSnapshot<TSnapshot>(pulled.data, ctx.passphrase);
  await adapter.applySnapshot(snapshot);
  const checksum = await adapter.currentChecksum(id);
  await setSyncBase(adapter.entityType, id, {
    localChecksum: checksum,
    remoteChecksum: remote.checksum,
  });
  ctx.emitLog({
    level: "success",
    event: "pull",
    message: `Pulled ${opts.remoteOnly ? "remote-only " : ""}${adapter.entityType} ${opts.title ?? adapter.titleOfSnapshot(snapshot)}`,
    entityType: adapter.entityType,
    entityId: id,
  });
  return "pulled";
}

interface RemoteDeletionContext<TSnapshot> {
  adapter: EntitySyncAdapter<TSnapshot>;
  entityId: string;
  title: string;
  localChecksum: string;
  localUpdatedAt: number;
  deletion: RemoteDeletionMeta;
}

async function removeDeletedElsewhere<TSnapshot>(
  ctx: EntitySyncContext,
  deletionCtx: RemoteDeletionContext<TSnapshot>
): Promise<SyncAction> {
  const { adapter, entityId, title } = deletionCtx;
  await ctx.ensureBackup();
  await adapter.removeLocal(entityId);
  await clearSyncBase(adapter.entityType, entityId);
  ctx.emitLog({
    level: "success",
    event: "pull",
    message: `Removed ${adapter.entityType} ${title}, deleted on another device`,
    entityType: adapter.entityType,
    entityId,
  });
  return "pulled";
}

// The item exists here, but its remote row is soft-deleted. That row still
// holds the server's unique identity, so the item is never re-created: an
// unedited copy follows the deletion once the user confirms it, and an edited
// one asks whether to restore it (update the deleted row) or delete it here.
async function resolveRemoteDeletion<TSnapshot>(
  ctx: EntitySyncContext,
  deletionCtx: RemoteDeletionContext<TSnapshot>,
  revive: (remoteId: string) => Promise<SyncAction>
): Promise<SyncAction> {
  const { adapter, entityId, title, localChecksum, localUpdatedAt, deletion } = deletionCtx;
  const { label } = adapter;
  const { options } = ctx;
  const base = await getSyncBase(adapter.entityType, entityId);
  // Without a base this copy was never agreed with the server (a restore, or a
  // first sync here), so it may hold work the deletion never saw.
  const editedHere = !base || base.localChecksum !== localChecksum;

  if (!editedHere || options.direction === "pull") {
    if (!canPull(options.direction)) {
      ctx.emitLog({
        level: "warning",
        event: "skip",
        message: `${label} ${title} was deleted on another device; run a two-way or pull sync to review it`,
        entityType: adapter.entityType,
        entityId,
      });
      return "skipped";
    }

    const reviewId = tombstoneId(adapter.entityType, entityId);
    if (!options.confirmedDeletionIds?.includes(reviewId)) {
      ctx.queueRemoteDeletionReview({
        id: reviewId,
        entityType: adapter.entityType,
        entityId,
        title,
        deletedAt: deletion.updatedAt,
        deletedRemotely: true,
      });
      ctx.emitLog({
        level: "warning",
        event: "delete-pending",
        message: `Deleted on another device, needs confirmation: ${title}`,
        entityType: adapter.entityType,
        entityId,
      });
      return "skipped";
    }

    // The confirmation covered the copy the user reviewed. Land any pending
    // editor save and re-check, so an edit made since is not deleted with it.
    await flushPendingEdits();
    if ((await adapter.currentChecksum(entityId)) !== localChecksum) {
      ctx.emitLog({
        level: "warning",
        event: "skip",
        message: `${label} ${title} changed during sync; it will sync next time`,
        entityType: adapter.entityType,
        entityId,
      });
      return "deferred";
    }
    return removeDeletedElsewhere(ctx, deletionCtx);
  }

  ctx.emitLog({
    level: "warning",
    event: "conflict",
    message: `${label} ${title} was deleted on another device but changed here`,
    entityType: adapter.entityType,
    entityId,
  });
  const choice = await ctx.onConflict({
    entityType: adapter.entityType,
    entityId,
    entityTitle: title,
    bookId: entityId,
    bookTitle: title,
    localUpdatedAt,
    remoteUpdatedAt: deletion.updatedAt,
    remoteDeleted: true,
  });

  if (choice === "cancel") return "cancelled";
  if (choice === "skip") {
    ctx.emitLog({
      level: "warning",
      event: "skip",
      message: `${label} ${title} was deleted on another device but changed here; run a manual sync to choose`,
      entityType: adapter.entityType,
      entityId,
    });
    return "deferred";
  }
  if (choice === "push") return revive(deletion.remoteId);
  return removeDeletedElsewhere(ctx, deletionCtx);
}

export interface BatchSeen {
  remotes: RemoteItemMeta[];
  deletions: RemoteDeletionMeta[];
}

/**
 * Sync one local item: three-way decision against the last-synced base, then
 * push, pull, or Conflict. Shared by single syncs and batch loops; the batch
 * loop passes the remote listing and its precomputed timestamp.
 */
export async function syncEntity<TSnapshot>(
  adapter: EntitySyncAdapter<TSnapshot>,
  id: string,
  ctx: EntitySyncContext,
  seen: BatchSeen,
  precomputedLocalUpdatedAt?: number
): Promise<SyncAction> {
  assertOnline();
  const { options, onConflict } = ctx;

  const { json, checksum: localChecksum } = await adapter.snapshotChecksums(id);
  const title = await adapter.getTitle(id);
  // The batch loop reuses its listing query's timestamp when available,
  // avoiding a redundant per-item query.
  const localUpdatedAt = precomputedLocalUpdatedAt ?? (await adapter.getLocalUpdatedAt(id));

  const remote = seen.remotes.find((r) => r.entityId === id);

  const push = async (remoteId?: string): Promise<SyncAction> => {
    const encrypted = await encryptToBuffer(json, ctx.passphrase);
    const blob = new Blob([encrypted]);
    // A local-only item has no remote row yet: create it (no remoteId argument).
    await ctx.remote.pushBlob(adapter.entityType, id, blob, localChecksum, remoteId);
    await setSyncBase(adapter.entityType, id, {
      localChecksum,
      remoteChecksum: localChecksum,
    });
    ctx.emitLog({
      level: "success",
      event: "push",
      message: `Pushed ${adapter.entityType} ${title}`,
      entityType: adapter.entityType,
      entityId: id,
    });
    return "pushed";
  };

  if (!remote) {
    const deletion = seen.deletions.find((d) => d.entityId === id);
    if (deletion) {
      return resolveRemoteDeletion(
        ctx,
        { adapter, entityId: id, title, localChecksum, localUpdatedAt, deletion },
        push
      );
    }
    if (!canPush(options.direction)) {
      ctx.emitLog({
        level: "info",
        event: "skip",
        message: `Skipped local-only ${adapter.entityType} ${title} in pull-only sync`,
        entityType: adapter.entityType,
        entityId: id,
      });
      return "skipped";
    }
    return push();
  }

  const base = await getSyncBase(adapter.entityType, id);

  // Items pushed before the checksum ignored navigation state carry the raw
  // snapshot checksum. An unchanged item still matches it: adopt it as the
  // base instead of reporting a conflict on the first sync after upgrading.
  // Kinds without that history (notes) return null and skip this branch.
  if (
    !base &&
    remote.checksum !== localChecksum &&
    remote.checksum === (await adapter.legacyRawChecksum(json))
  ) {
    await setSyncBase(adapter.entityType, id, {
      localChecksum,
      remoteChecksum: remote.checksum,
    });
    ctx.emitLog({
      level: "info",
      event: "skip",
      message: `Skipped unchanged ${adapter.entityType} ${title}`,
      entityType: adapter.entityType,
      entityId: id,
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
      await setSyncBase(adapter.entityType, id, {
        localChecksum,
        remoteChecksum: remote.checksum,
      });
    }
    ctx.emitLog({
      level: "info",
      event: "skip",
      message: `Skipped unchanged ${adapter.entityType} ${title}`,
      entityType: adapter.entityType,
      entityId: id,
    });
    return "skipped";
  }

  if (decision === "push") return push(remote.remoteId);

  if (decision === "pull") {
    // Only the remote changed, so nobody was asked. Land any pending editor
    // save and re-check: an edit made while this sync ran must not be replaced.
    if (options.direction === "bidirectional") {
      await flushPendingEdits();
      if ((await adapter.currentChecksum(id)) !== localChecksum) {
        ctx.emitLog({
          level: "warning",
          event: "skip",
          message: `${adapter.label} ${title} changed during sync; it will sync next time`,
          entityType: adapter.entityType,
          entityId: id,
        });
        return "deferred";
      }
    }
    return pullEntity(adapter, id, remote, ctx, { title, remoteOnly: false });
  }

  // Both sides changed (or no base and the remote looks newer): ask.
  ctx.emitLog({
    level: "warning",
    event: "conflict",
    message: `${adapter.label} conflict: ${title}`,
    entityType: adapter.entityType,
    entityId: id,
  });
  const choice = await onConflict({
    entityType: adapter.entityType,
    entityId: id,
    entityTitle: title,
    bookId: id,
    bookTitle: title,
    localUpdatedAt,
    remoteUpdatedAt: remote.updatedAt,
  });

  if (choice === "cancel") {
    return "cancelled";
  }
  if (choice === "skip") {
    ctx.emitLog({
      level: "warning",
      event: "skip",
      message: `${adapter.label} ${title} changed here and on another device; run a manual sync to choose`,
      entityType: adapter.entityType,
      entityId: id,
    });
    return "deferred";
  }
  if (choice === "push") {
    return push(remote.remoteId);
  }
  return pullEntity(adapter, id, remote, ctx, { title, remoteOnly: false });
}

/**
 * Sync every local item of one kind, then pull remote-only items through the
 * same pullEntity path as single pulls. Returns the per-item actions and
 * whether the user cancelled at a conflict. The optional afterItem hook runs
 * after each landed item (local syncs and remote-only pulls, but not
 * tombstone skips or missing blobs); it is how the engine reconciles per-book
 * versions without teaching this module about versions.
 */
export async function syncEntityBatch<TSnapshot>(
  adapter: EntitySyncAdapter<TSnapshot>,
  ctx: EntitySyncContext,
  hooks?: {
    afterItem?: (id: string, action: SyncAction, seen: BatchSeen) => Promise<void>;
  }
): Promise<{ actions: SyncAction[]; cancelled: boolean }> {
  assertOnline();

  const localEntries = await adapter.listLocal();
  const localIds = new Set(localEntries.map((entry) => entry.id));

  const remotes = await ctx.remote.list(adapter.entityType);
  const deletions = await listDeletionsIfNeeded(
    localEntries.map((entry) => entry.id),
    remotes.map((r) => r.entityId),
    () => ctx.remote.listDeleted(adapter.entityType)
  );
  const seen: BatchSeen = { remotes, deletions };
  const actions: SyncAction[] = [];

  for (const entry of localEntries) {
    const action = await syncEntity(adapter, entry.id, ctx, seen, entry.updatedAt);
    await hooks?.afterItem?.(entry.id, action, seen);
    actions.push(action);
    if (action === "cancelled") {
      return { actions, cancelled: true };
    }
  }

  // Pull remote-only items (no local data — auto-pull, no conflict dialog)
  if (canPull(ctx.options.direction)) {
    for (const remote of remotes) {
      if (localIds.has(remote.entityId)) continue;
      const tombstone = await getTombstone(adapter.entityType, remote.entityId);
      if (tombstone) {
        ctx.emitLog({
          level: "warning",
          event: "skip",
          message: `Skipped tombstoned remote ${adapter.entityType} ${tombstone.title}`,
          entityType: adapter.entityType,
          entityId: remote.entityId,
        });
        actions.push("skipped");
        continue;
      }

      const action = await pullEntity(adapter, remote.entityId, remote, ctx, {
        remoteOnly: true,
      });
      // A missing blob pulls nothing: no action, no follow-up — same as the
      // old inline loops' `continue`.
      if (action === "skipped") continue;
      await hooks?.afterItem?.(remote.entityId, action, seen);
      actions.push(action);
    }
  }

  return { actions, cancelled: false };
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

/** One registered delete path per synced kind. Kinds without an entry (e.g. "canvas") are never synced. */
export interface EntityDeletionHandler {
  deleteRemote(entityId: string): Promise<void>;
}

export type EntityDeletionRegistry = Partial<Record<SyncEntityType, EntityDeletionHandler>>;

/**
 * Carry confirmed deletions to the server through the adapter registry keyed
 * by entityType. A tombstone whose kind has no registered handler is skipped
 * and left pending — never sent to another kind's delete.
 */
export async function processPendingDeletions(
  registry: EntityDeletionRegistry,
  entityTypes: SyncEntityType[],
  options: SyncOptions,
  emitLog: EntitySyncContext["emitLog"]
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
    const handler = registry[tombstone.entityType];
    if (!handler) {
      emitLog({
        level: "info",
        event: "skip",
        message: `Skipping deletion for ${tombstone.entityType} ${tombstone.title}: no sync adapter`,
        entityType: tombstone.entityType,
        entityId: tombstone.entityId,
      });
      continue;
    }

    const isConfirmed = tombstone.confirmedAt != null || confirmedIds.has(tombstone.id);
    if (!isConfirmed) {
      emitLog({
        level: "warning",
        event: "delete-pending",
        message: `Deletion needs confirmation: ${tombstone.title}`,
        entityType: tombstone.entityType,
        entityId: tombstone.entityId,
      });
      pendingDeletions.push(toDeletionReviewItem(tombstone));
      continue;
    }

    await handler.deleteRemote(tombstone.entityId);
    await markTombstonePushed(tombstone.entityType, tombstone.entityId);
    if (tombstone.entityType === "book" || tombstone.entityType === "note") {
      await clearSyncBase(tombstone.entityType, tombstone.entityId);
    }
    emitLog({
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
