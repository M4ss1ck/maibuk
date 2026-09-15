import { describe, it, expect, beforeEach, vi } from "vitest";
import type { DatabaseAdapter } from "@/lib/platform/types";
import { createTestDatabase } from "../../../support/db-test-context";
import { InMemoryRemote } from "../../../support/in-memory-remote";
import type {
  EntitySyncAdapter,
  EntitySyncContext,
} from "@/features/sync/entity-sync";
import type { SyncLogEntry, SyncDeletionReviewItem, SyncOptions } from "@/features/sync/types";

const { mockGetDatabase } = vi.hoisted(() => ({ mockGetDatabase: vi.fn() }));
vi.mock("../../../../lib/db", () => ({ getDatabase: mockGetDatabase }));

const {
  syncEntity,
  syncEntityBatch,
  pullEntity,
  processPendingDeletions,
} = await import("@/features/sync/entity-sync");
const { bookAdapter, noteAdapter } = await import("@/features/sync/sync-engine");
const { createBookRow, updateBookRow, fetchStoredBook, deleteBookRow } = await import(
  "@/features/books/write"
);
const { createNoteRow, updateNoteRow, deleteNoteRow } = await import("@/features/notes/write");
const { serializeBook, serializeNote } = await import("@/features/sync/serializer");
const {
  encryptToBuffer,
  decryptBufferToText,
  parseJsonAsync,
  stringifySnapshotAsync,
  normalizeBookSnapshotAsync,
  normalizeNoteSnapshotAsync,
  computeChecksumAsync,
} = await import("@/features/sync/sync-codec");
const { getSyncBase } = await import("@/features/sync/sync-state");
const { recordTombstone, listPendingTombstones } = await import("@/features/sync/tombstones");
const { onChange, resetChangeFeedForTests } = await import("@/features/sync/change-feed");

const PASS = "test-passphrase";

let testDb: DatabaseAdapter;

beforeEach(async () => {
  testDb = await createTestDatabase();
  mockGetDatabase.mockReset();
  mockGetDatabase.mockResolvedValue(testDb);
  resetChangeFeedForTests();
});

function makeCtx(
  remote: InMemoryRemote,
  overrides?: {
    onConflict?: EntitySyncContext["onConflict"];
    options?: Partial<SyncOptions>;
  }
): {
  ctx: EntitySyncContext;
  logs: SyncLogEntry[];
  reviews: SyncDeletionReviewItem[];
} {
  const logs: SyncLogEntry[] = [];
  const reviews: SyncDeletionReviewItem[] = [];
  const options: SyncOptions = {
    scope: "all",
    direction: "bidirectional",
    confirmedDeletionIds: [],
    ...overrides?.options,
  };
  const ctx: EntitySyncContext = {
    passphrase: PASS,
    onConflict:
      overrides?.onConflict ??
      (() => {
        throw new Error("unexpected conflict");
      }),
    options,
    remote,
    ensureBackup: vi.fn().mockResolvedValue(undefined),
    emitLog: (entry) => {
      logs.push({
        id: `log-${logs.length}`,
        timestamp: 1000,
        ...entry,
      });
    },
    queueRemoteDeletionReview: (item) => {
      reviews.push(item);
    },
  };
  return { ctx, logs, reviews };
}

interface World {
  adapter: EntitySyncAdapter<unknown>;
  kind: "book" | "note";
  seedLocal(title: string): Promise<string>;
  editLocal(id: string, title: string): Promise<void>;
  readTitle(id: string): Promise<string | null>;
  exists(id: string): Promise<boolean>;
  deleteLocal(id: string): Promise<void>;
  serialize(id: string): Promise<string>;
  normalize(json: string): Promise<string>;
}

const bookWorld: World = {
  adapter: bookAdapter as EntitySyncAdapter<unknown>,
  kind: "book",
  async seedLocal(title) {
    return (await createBookRow({ title, authorName: "Author" }, "local")).id;
  },
  async editLocal(id, title) {
    await updateBookRow(id, { title }, "local");
  },
  async readTitle(id) {
    return (await fetchStoredBook(id))?.title ?? null;
  },
  async exists(id) {
    return (await fetchStoredBook(id)) !== null;
  },
  async deleteLocal(id) {
    await deleteBookRow(id, "local");
  },
  serialize: serializeBook,
  normalize: normalizeBookSnapshotAsync,
};

const noteWorld: World = {
  adapter: noteAdapter as EntitySyncAdapter<unknown>,
  kind: "note",
  async seedLocal(title) {
    return (await createNoteRow({ title }, "local")).id;
  },
  async editLocal(id, title) {
    await updateNoteRow({ id, title }, "local");
  },
  async readTitle(id) {
    const rows = await testDb.select<{ title: string }[]>("SELECT title FROM notes WHERE id = ?", [
      id,
    ]);
    return rows[0]?.title ?? null;
  },
  async exists(id) {
    const rows = await testDb.select<{ id: string }[]>("SELECT id FROM notes WHERE id = ?", [id]);
    return rows.length > 0;
  },
  async deleteLocal(id) {
    await deleteNoteRow(id, "local");
  },
  serialize: serializeNote,
  normalize: normalizeNoteSnapshotAsync,
};

async function remoteChecksumFor(world: World, json: string): Promise<string> {
  return computeChecksumAsync(await world.normalize(json));
}

async function seedRemoteFromLocal(
  world: World,
  remote: InMemoryRemote,
  id: string,
  updatedAt?: number
): Promise<void> {
  const json = await world.serialize(id);
  const data = new Uint8Array(await encryptToBuffer(json, PASS));
  await remote.seedLive(world.kind, id, data, await remoteChecksumFor(world, json), updatedAt);
}

async function seedRemoteTitle(
  world: World,
  remote: InMemoryRemote,
  id: string,
  title: string,
  updatedAt?: number
): Promise<void> {
  const json = await world.serialize(id);
  const obj = (await parseJsonAsync<Record<string, { title?: string }>>(json)) as Record<
    string,
    { title?: string }
  >;
  if (obj.book) obj.book.title = title;
  if (obj.note) obj.note.title = title;
  const edited = await stringifySnapshotAsync(obj);
  const data = new Uint8Array(await encryptToBuffer(edited, PASS));
  await remote.seedLive(world.kind, id, data, await remoteChecksumFor(world, edited), updatedAt);
}

/** Seed a remote-only item with no local row (built from a scratch copy). */
async function seedRemoteOnly(
  world: World,
  remote: InMemoryRemote,
  title: string,
  updatedAt?: number
): Promise<string> {
  const scratchId = await world.seedLocal(`scratch-${title}`);
  const json = await world.serialize(scratchId);
  const obj = (await parseJsonAsync<Record<string, { title?: string; id?: string }>>(json)) as Record<
    string,
    { title?: string; id?: string }
  >;
  const id = `remote-only-${world.kind}-${title}`;
  if (obj.book) {
    obj.book.title = title;
    obj.book.id = id;
  }
  if (obj.note) {
    obj.note.title = title;
    obj.note.id = id;
  }
  const edited = await stringifySnapshotAsync(obj);
  const data = new Uint8Array(await encryptToBuffer(edited, PASS));
  await remote.seedLive(world.kind, id, data, await remoteChecksumFor(world, edited), updatedAt);
  await testDb.execute("DELETE FROM books WHERE id = ?", [scratchId]);
  await testDb.execute("DELETE FROM notes WHERE id = ?", [scratchId]);
  return id;
}

async function seenFor(remote: InMemoryRemote, kind: "book" | "note", localIds: string[]) {
  const remotes = await remote.list(kind);
  const live = new Set(remotes.map((r) => r.entityId));
  const deletions = localIds.some((id) => !live.has(id))
    ? await remote.listDeleted(kind)
    : [];
  return { remotes, deletions };
}

async function remoteTitleOf(
  world: World,
  remote: InMemoryRemote,
  id: string
): Promise<string | null> {
  const row = remote.getObject(world.kind, id);
  if (!row || row.deleted) return null;
  const json = await decryptBufferToText(row.data, PASS);
  const obj = (await parseJsonAsync<{ book?: { title: string }; note?: { title: string } }>(json));
  return obj.book?.title ?? obj.note?.title ?? null;
}


describe.each([
  { name: "book", world: bookWorld },
  { name: "note", world: noteWorld },
])("entity sync — $name adapter", ({ world }) => {
  it("pushes a new local item", async () => {
    const remote = new InMemoryRemote();
    const { ctx, logs } = makeCtx(remote);
    const id = await world.seedLocal("First");

    const batch = await syncEntityBatch(world.adapter, ctx);

    expect(batch).toEqual({ actions: ["pushed"], cancelled: false });
    const row = remote.getObject(world.kind, id);
    expect(row?.deleted).toBe(false);
    const base = await getSyncBase(world.kind, id);
    expect(base).not.toBeNull();
    expect(base?.localChecksum).toBe(base?.remoteChecksum);
    expect(logs.some((l) => l.event === "push")).toBe(true);
  });

  it("pulls a new remote item and lands a pre-sync backup first", async () => {
    const remote = new InMemoryRemote();
    const { ctx } = makeCtx(remote);
    const id = await seedRemoteOnly(world, remote, "Elsewhere");

    const batch = await syncEntityBatch(world.adapter, ctx);

    expect(batch.actions).toEqual(["pulled"]);
    expect(await world.readTitle(id)).toBe("Elsewhere");
    expect(ctx.ensureBackup).toHaveBeenCalled();
    const base = await getSyncBase(world.kind, id);
    expect(base).not.toBeNull();
  });

  it("leaves an unchanged item alone", async () => {
    const remote = new InMemoryRemote();
    const { ctx } = makeCtx(remote);
    await world.seedLocal("Steady");
    await syncEntityBatch(world.adapter, ctx);
    const pushes = remote.pushed.length;

    const batch = await syncEntityBatch(world.adapter, ctx);

    expect(batch.actions).toEqual(["skipped"]);
    expect(remote.pushed.length).toBe(pushes);
    expect(remote.pulled.length).toBe(0);
  });

  it("pushes a locally edited item", async () => {
    const remote = new InMemoryRemote();
    const { ctx } = makeCtx(remote);
    const id = await world.seedLocal("Draft");
    await syncEntityBatch(world.adapter, ctx);
    await world.editLocal(id, "Revised");

    const batch = await syncEntityBatch(world.adapter, ctx);

    expect(batch.actions).toEqual(["pushed"]);
    expect(await remoteTitleOf(world, remote, id)).toBe("Revised");
  });

  it("pulls a remotely edited item", async () => {
    const remote = new InMemoryRemote();
    const { ctx } = makeCtx(remote);
    const id = await world.seedLocal("Local");
    await syncEntityBatch(world.adapter, ctx);
    await seedRemoteTitle(world, remote, id, "Remote edit");

    const batch = await syncEntityBatch(world.adapter, ctx);

    expect(batch.actions).toEqual(["pulled"]);
    expect(await world.readTitle(id)).toBe("Remote edit");
  });

  it("asks on both-sides change: push keeps local, pull takes remote, cancel stops", async () => {
    for (const choice of ["push", "pull", "cancel"] as const) {
      const fresh = await createTestDatabase();
      mockGetDatabase.mockResolvedValue(fresh);
      testDb = fresh;
      const remote = new InMemoryRemote();
      const { ctx } = makeCtx(remote, {
        onConflict: vi.fn().mockResolvedValue(choice),
      });
      const id = await world.seedLocal("Base");
      await syncEntityBatch(world.adapter, ctx);
      await world.editLocal(id, "Local edit");
      await seedRemoteTitle(world, remote, id, "Remote edit");

      const seen = await seenFor(remote, world.kind, [id]);
      const action = await syncEntity(world.adapter, id, ctx, seen);

      if (choice === "push") {
        expect(action).toBe("pushed");
        expect(await remoteTitleOf(world, remote, id)).toBe("Local edit");
      } else if (choice === "pull") {
        expect(action).toBe("pulled");
        expect(await world.readTitle(id)).toBe("Remote edit");
      } else {
        expect(action).toBe("cancelled");
      }
      expect(ctx.onConflict).toHaveBeenCalledWith(
        expect.objectContaining({ entityId: id, remoteUpdatedAt: expect.any(Number) })
      );
    }
  });

  it("defers a conflict during Auto Sync instead of prompting", async () => {
    const remote = new InMemoryRemote();
    const { ctx } = makeCtx(remote, {
      onConflict: vi.fn().mockResolvedValue("skip"),
      options: { trigger: "auto" },
    });
    const id = await world.seedLocal("Base");
    await syncEntityBatch(world.adapter, ctx);
    await world.editLocal(id, "Local edit");
    await seedRemoteTitle(world, remote, id, "Remote edit");

    const seen = await seenFor(remote, world.kind, [id]);
    const action = await syncEntity(world.adapter, id, ctx, seen);

    expect(action).toBe("deferred");
  });

  it("holds a remotely deleted item for review, then removes it once confirmed", async () => {
    const remote = new InMemoryRemote();
    const holder = makeCtx(remote);
    const id = await world.seedLocal("Doomed");
    await syncEntityBatch(world.adapter, holder.ctx);
    await remote.deleteRemote(world.kind, id);

    const seen = await seenFor(remote, world.kind, [id]);
    const first = await syncEntity(world.adapter, id, holder.ctx, seen);

    expect(first).toBe("skipped");
    expect(holder.reviews).toHaveLength(1);
    expect(holder.reviews[0]).toMatchObject({ entityId: id, deletedRemotely: true });
    expect(await world.exists(id)).toBe(true);

    const reviewId = (holder.reviews[0] as { id: string }).id;
    const confirmer = makeCtx(remote, { options: { confirmedDeletionIds: [reviewId] } });
    const seenAgain = await seenFor(remote, world.kind, [id]);
    const second = await syncEntity(world.adapter, id, confirmer.ctx, seenAgain);

    expect(second).toBe("pulled");
    expect(await world.exists(id)).toBe(false);
    expect(await getSyncBase(world.kind, id)).toBeNull();
  });

  it("asks when a remotely deleted item was also edited here", async () => {
    const remote = new InMemoryRemote();
    const id = await world.seedLocal("Shared");
    await syncEntityBatch(world.adapter, makeCtx(remote).ctx);
    await world.editLocal(id, "Kept work");
    await remote.deleteRemote(world.kind, id);

    const keeper = makeCtx(remote, { onConflict: vi.fn().mockResolvedValue("push") });
    const seen = await seenFor(remote, world.kind, [id]);
    const kept = await syncEntity(world.adapter, id, keeper.ctx, seen);

    expect(kept).toBe("pushed");
    expect(keeper.ctx.onConflict).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: id, remoteDeleted: true })
    );
    // Reviving updates the deleted row: the item is live again with local work.
    expect(remote.getObject(world.kind, id)?.deleted).toBe(false);
    expect(await remoteTitleOf(world, remote, id)).toBe("Kept work");
    expect(await world.exists(id)).toBe(true);
  });

  it("does not resurrect a tombstoned remote-only item", async () => {
    const remote = new InMemoryRemote();
    const { ctx, logs } = makeCtx(remote);
    const id = await world.seedLocal("Gone");
    await syncEntityBatch(world.adapter, ctx);
    await seedRemoteFromLocal(world, remote, id);
    await world.deleteLocal(id);

    const batch = await syncEntityBatch(world.adapter, ctx);

    expect(batch.actions).toEqual(["skipped"]);
    expect(logs.some((l) => l.message.includes("tombstoned"))).toBe(true);
    expect(await world.exists(id)).toBe(false);
  });
});

describe("entity sync — books take a pre-sync Checkpoint on pulls over local copies", () => {
  it("pull-all remote-only books go through pullEntity (no Checkpoint, remote Change)", async () => {
    const remote = new InMemoryRemote();
    const { ctx, logs } = makeCtx(remote);
    const changes: { entity: string; origin: string; id: string }[] = [];
    const stop = onChange((change) => {
      changes.push({ entity: change.entity, origin: change.origin, id: change.id });
    });
    const id = await seedRemoteOnly(bookWorld, remote, "Pulled Book");

    const batch = await syncEntityBatch(bookWorld.adapter, ctx);

    expect(batch.actions).toEqual(["pulled"]);
    expect(await bookWorld.readTitle(id)).toBe("Pulled Book");
    // The shared pull path's remote-only log message, not an inline copy.
    expect(logs.some((l) => l.message === `Pulled remote-only book Pulled Book`)).toBe(true);
    // A remote-only item has nothing to snapshot: no Checkpoint, same as before.
    const versions = await testDb.select<{ trigger_type: string }[]>(
      "SELECT trigger_type FROM book_versions WHERE book_id = ?",
      [id]
    );
    expect(versions).toHaveLength(0);
    // The pulled content reaches views through a remote Change.
    expect(changes).toContainEqual({ entity: "book", origin: "remote", id });
    stop();
  });

  it("a conflict pull takes the Checkpoint through the same pullEntity", async () => {
    const remote = new InMemoryRemote();
    const { ctx } = makeCtx(remote, { onConflict: vi.fn().mockResolvedValue("pull") });
    const id = await bookWorld.seedLocal("Base");
    await syncEntityBatch(bookWorld.adapter, ctx);
    await bookWorld.editLocal(id, "Local edit");
    await seedRemoteTitle(bookWorld, remote, id, "Remote edit");

    const seen = await seenFor(remote, "book", [id]);
    const action = await syncEntity(bookWorld.adapter, id, ctx, seen);

    expect(action).toBe("pulled");
    const versions = await testDb.select<{ trigger_type: string }[]>(
      "SELECT trigger_type FROM book_versions WHERE book_id = ?",
      [id]
    );
    expect(versions).toHaveLength(1);
    expect(versions[0].trigger_type).toBe("pre-sync");
  });

  it("a direct pullEntity over a local book matches the batch pull path", async () => {
    const remote = new InMemoryRemote();
    const { ctx, logs } = makeCtx(remote);
    const id = await bookWorld.seedLocal("Base");
    await syncEntityBatch(bookWorld.adapter, ctx);
    await seedRemoteTitle(bookWorld, remote, id, "Remote edit");
    const [meta] = await remote.list("book");

    const action = await pullEntity(bookWorld.adapter, id, meta, ctx, {
      title: "Base",
      remoteOnly: false,
    });

    expect(action).toBe("pulled");
    expect(await bookWorld.readTitle(id)).toBe("Remote edit");
    expect(logs.some((l) => l.message === "Pulled book Base")).toBe(true);
  });

  it("pulled notes reach views through a remote Change and take no Checkpoint", async () => {
    const remote = new InMemoryRemote();
    const { ctx } = makeCtx(remote);
    const changes: { entity: string; origin: string; id: string }[] = [];
    const stop = onChange((change) => {
      changes.push({ entity: change.entity, origin: change.origin, id: change.id });
    });
    const id = await seedRemoteOnly(noteWorld, remote, "Pulled Note");

    const batch = await syncEntityBatch(noteWorld.adapter, ctx);

    expect(batch.actions).toEqual(["pulled"]);
    expect(await noteWorld.readTitle(id)).toBe("Pulled Note");
    expect(changes).toContainEqual({ entity: "note", origin: "remote", id });
    stop();
  });
});

describe("entity sync — pending deletions through the registry", () => {
  function registryFor(remote: InMemoryRemote) {
    return {
      book: { deleteRemote: (entityId: string) => remote.deleteRemote("book", entityId) },
      note: { deleteRemote: (entityId: string) => remote.deleteRemote("note", entityId) },
    };
  }

  it("holds unconfirmed tombstones and pushes confirmed ones", async () => {
    const remote = new InMemoryRemote();
    const emitLog = vi.fn();
    const bookId = await bookWorld.seedLocal("Old Book");
    await seedRemoteFromLocal(bookWorld, remote, bookId);
    await bookWorld.deleteLocal(bookId);
    await recordTombstone({ entityType: "book", entityId: bookId, title: "Old Book" });

    const held = await processPendingDeletions(
      registryFor(remote),
      ["book"],
      { scope: "all", direction: "bidirectional", confirmedDeletionIds: [] },
      emitLog
    );

    expect(held.pendingDeletions).toHaveLength(1);
    expect(remote.deleted).toHaveLength(0);

    const pushed = await processPendingDeletions(
      registryFor(remote),
      ["book"],
      {
        scope: "all",
        direction: "bidirectional",
        confirmedDeletionIds: [`book:${bookId}`],
      },
      emitLog
    );

    expect(pushed.actions).toEqual(["pushed"]);
    expect(remote.getObject("book", bookId)?.deleted).toBe(true);
    expect(await listPendingTombstones(["book"])).toHaveLength(0);
  });

  it("does nothing in pull-only direction", async () => {
    const remote = new InMemoryRemote();
    const emitLog = vi.fn();
    const noteId = await noteWorld.seedLocal("Old Note");
    await noteWorld.deleteLocal(noteId);
    await recordTombstone({ entityType: "note", entityId: noteId, title: "Old Note" });

    const result = await processPendingDeletions(
      registryFor(remote),
      ["note"],
      { scope: "all", direction: "pull", confirmedDeletionIds: [`note:${noteId}`] },
      emitLog
    );

    expect(result).toEqual({ actions: [], pendingDeletions: [] });
    expect(remote.deleted).toHaveLength(0);
  });
});

