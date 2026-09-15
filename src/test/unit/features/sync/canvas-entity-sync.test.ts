import { describe, it, expect, beforeEach, vi } from "vitest";
import type { DatabaseAdapter } from "@/lib/platform/types";
import { createTestDatabase } from "../../../support/db-test-context";
import { InMemoryRemote } from "../../../support/in-memory-remote";
import type { EntitySyncContext } from "@/features/sync/entity-sync";
import type { SyncLogEntry, SyncDeletionReviewItem, SyncOptions } from "@/features/sync/types";
import { CURRENT_CANVAS_SCHEMA_VERSION, createDefaultCanvasDoc } from "@/features/canvas/types";

const { mockGetDatabase } = vi.hoisted(() => ({ mockGetDatabase: vi.fn() }));
vi.mock("../../../../lib/db", () => ({ getDatabase: mockGetDatabase }));

const { syncEntity, syncEntityBatch, processPendingDeletions } = await import(
  "@/features/sync/entity-sync"
);
const { canvasAdapter } = await import("@/features/sync/sync-engine");
const {
  createCanvasRow,
  updateCanvasDocRow,
  updateCanvasRow,
  deleteCanvasRow,
} = await import("@/features/canvas/write");
const { serializeCanvas } = await import("@/features/sync/serializer");
const {
  encryptToBuffer,
  decryptBufferToText,
  parseJsonAsync,
  stringifySnapshotAsync,
  computeChecksumAsync,
  normalizeCanvasSnapshotAsync,
} = await import("@/features/sync/sync-codec");
const { getSyncBase } = await import("@/features/sync/sync-state");
const { listPendingTombstones } = await import("@/features/sync/tombstones");
const { onChange, resetChangeFeedForTests } = await import("@/features/sync/change-feed");
const { useReadingPositionStore } = await import("@/features/reading-position/store");

const PASS = "test-passphrase";

let testDb: DatabaseAdapter;

beforeEach(async () => {
  testDb = await createTestDatabase();
  mockGetDatabase.mockReset();
  mockGetDatabase.mockResolvedValue(testDb);
  resetChangeFeedForTests();
  useReadingPositionStore.setState({ canvasViewports: {} });
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

async function remoteChecksumFor(json: string): Promise<string> {
  return computeChecksumAsync(await normalizeCanvasSnapshotAsync(json));
}

async function seedRemoteFromLocal(
  remote: InMemoryRemote,
  id: string,
  updatedAt?: number
): Promise<void> {
  const json = await serializeCanvas(id);
  const data = new Uint8Array(await encryptToBuffer(json, PASS));
  await remote.seedLive("canvas", id, data, await remoteChecksumFor(json), updatedAt);
}

async function seedRemoteTitle(
  remote: InMemoryRemote,
  id: string,
  title: string,
  updatedAt?: number
): Promise<void> {
  const json = await serializeCanvas(id);
  const obj = (await parseJsonAsync<{ canvas: { title: string } }>(json));
  obj.canvas.title = title;
  const edited = await stringifySnapshotAsync(obj);
  const data = new Uint8Array(await encryptToBuffer(edited, PASS));
  await remote.seedLive("canvas", id, data, await remoteChecksumFor(edited), updatedAt);
}

async function seedRemoteOnly(
  remote: InMemoryRemote,
  title: string,
  updatedAt?: number
): Promise<string> {
  const scratch = await createCanvasRow({ title: `scratch-${title}` }, "local");
  const json = await serializeCanvas(scratch.id);
  const obj = (await parseJsonAsync<{ canvas: { title: string; id: string } }>(json));
  const id = `remote-only-canvas-${title}`;
  obj.canvas.title = title;
  obj.canvas.id = id;
  const edited = await stringifySnapshotAsync(obj);
  const data = new Uint8Array(await encryptToBuffer(edited, PASS));
  await remote.seedLive("canvas", id, data, await remoteChecksumFor(edited), updatedAt);
  await testDb.execute("DELETE FROM canvases WHERE id = ?", [scratch.id]);
  return id;
}

async function seenFor(remote: InMemoryRemote, localIds: string[]) {
  const remotes = await remote.list("canvas");
  const live = new Set(remotes.map((r) => r.entityId));
  const deletions = localIds.some((id) => !live.has(id))
    ? await remote.listDeleted("canvas")
    : [];
  return { remotes, deletions };
}

async function readTitle(id: string): Promise<string | null> {
  const rows = await testDb.select<{ title: string }[]>(
    "SELECT title FROM canvases WHERE id = ?",
    [id]
  );
  return rows[0]?.title ?? null;
}

async function exists(id: string): Promise<boolean> {
  const rows = await testDb.select<{ id: string }[]>("SELECT id FROM canvases WHERE id = ?", [id]);
  return rows.length > 0;
}

async function remoteTitleOf(remote: InMemoryRemote, id: string): Promise<string | null> {
  const row = remote.getObject("canvas", id);
  if (!row || row.deleted) return null;
  const json = await decryptBufferToText(row.data, PASS);
  const obj = await parseJsonAsync<{ canvas: { title: string } }>(json);
  return obj.canvas.title;
}

describe("entity sync — canvas adapter", () => {
  it("pushes a new local canvas", async () => {
    const remote = new InMemoryRemote();
    const { ctx, logs } = makeCtx(remote);
    const canvas = await createCanvasRow({ title: "First" }, "local");

    const batch = await syncEntityBatch(canvasAdapter, ctx);

    expect(batch).toEqual({ actions: ["pushed"], cancelled: false });
    expect(remote.getObject("canvas", canvas.id)?.deleted).toBe(false);
    const base = await getSyncBase("canvas", canvas.id);
    expect(base).not.toBeNull();
    expect(base?.localChecksum).toBe(base?.remoteChecksum);
    expect(logs.some((l) => l.event === "push")).toBe(true);
  });

  it("pulls a new remote canvas and lands a pre-sync backup first", async () => {
    const remote = new InMemoryRemote();
    const { ctx } = makeCtx(remote);
    const id = await seedRemoteOnly(remote, "Elsewhere");

    const batch = await syncEntityBatch(canvasAdapter, ctx);

    expect(batch.actions).toEqual(["pulled"]);
    expect(await readTitle(id)).toBe("Elsewhere");
    expect(ctx.ensureBackup).toHaveBeenCalled();
    expect(await getSyncBase("canvas", id)).not.toBeNull();
  });

  it("pulled canvases reach views through a remote Change", async () => {
    const remote = new InMemoryRemote();
    const { ctx } = makeCtx(remote);
    const seen: { entity: string; origin: string; id: string }[] = [];
    const stop = onChange((change) => {
      seen.push({ entity: change.entity, origin: change.origin, id: change.id });
    });
    const id = await seedRemoteOnly(remote, "Pulled Map");

    await syncEntityBatch(canvasAdapter, ctx);

    expect(seen).toContainEqual({ entity: "canvas", origin: "remote", id });
    stop();
  });

  it("leaves an unchanged canvas alone", async () => {
    const remote = new InMemoryRemote();
    const { ctx } = makeCtx(remote);
    await createCanvasRow({ title: "Steady" }, "local");
    await syncEntityBatch(canvasAdapter, ctx);
    const pushes = remote.pushed.length;

    const batch = await syncEntityBatch(canvasAdapter, ctx);

    expect(batch.actions).toEqual(["skipped"]);
    expect(remote.pushed.length).toBe(pushes);
    expect(remote.pulled.length).toBe(0);
  });

  it("pushes a locally edited canvas", async () => {
    const remote = new InMemoryRemote();
    const { ctx } = makeCtx(remote);
    const canvas = await createCanvasRow({ title: "Draft" }, "local");
    await syncEntityBatch(canvasAdapter, ctx);
    await updateCanvasRow(canvas.id, { title: "Revised" }, "local");

    const batch = await syncEntityBatch(canvasAdapter, ctx);

    expect(batch.actions).toEqual(["pushed"]);
    expect(await remoteTitleOf(remote, canvas.id)).toBe("Revised");
  });

  it("pulls a remotely edited canvas", async () => {
    const remote = new InMemoryRemote();
    const { ctx } = makeCtx(remote);
    const canvas = await createCanvasRow({ title: "Local" }, "local");
    await syncEntityBatch(canvasAdapter, ctx);
    await seedRemoteTitle(remote, canvas.id, "Remote edit");

    const batch = await syncEntityBatch(canvasAdapter, ctx);

    expect(batch.actions).toEqual(["pulled"]);
    expect(await readTitle(canvas.id)).toBe("Remote edit");
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
      const canvas = await createCanvasRow({ title: "Base" }, "local");
      await syncEntityBatch(canvasAdapter, ctx);
      await updateCanvasRow(canvas.id, { title: "Local edit" }, "local");
      await seedRemoteTitle(remote, canvas.id, "Remote edit");

      const seen = await seenFor(remote, [canvas.id]);
      const action = await syncEntity(canvasAdapter, canvas.id, ctx, seen);

      if (choice === "push") {
        expect(action).toBe("pushed");
        expect(await remoteTitleOf(remote, canvas.id)).toBe("Local edit");
      } else if (choice === "pull") {
        expect(action).toBe("pulled");
        expect(await readTitle(canvas.id)).toBe("Remote edit");
      } else {
        expect(action).toBe("cancelled");
      }
      expect(ctx.onConflict).toHaveBeenCalledWith(
        expect.objectContaining({ entityId: canvas.id, remoteUpdatedAt: expect.any(Number) })
      );
    }
  });

  it("defers a conflict during Auto Sync instead of prompting", async () => {
    const remote = new InMemoryRemote();
    const { ctx } = makeCtx(remote, {
      onConflict: vi.fn().mockResolvedValue("skip"),
      options: { trigger: "auto" },
    });
    const canvas = await createCanvasRow({ title: "Base" }, "local");
    await syncEntityBatch(canvasAdapter, ctx);
    await updateCanvasRow(canvas.id, { title: "Local edit" }, "local");
    await seedRemoteTitle(remote, canvas.id, "Remote edit");

    const seen = await seenFor(remote, [canvas.id]);
    const action = await syncEntity(canvasAdapter, canvas.id, ctx, seen);

    expect(action).toBe("deferred");
  });

  it("holds a remotely deleted canvas for review, then removes it once confirmed", async () => {
    const remote = new InMemoryRemote();
    const holder = makeCtx(remote);
    const canvas = await createCanvasRow({ title: "Doomed" }, "local");
    await syncEntityBatch(canvasAdapter, holder.ctx);
    await remote.deleteRemote("canvas", canvas.id);

    const seen = await seenFor(remote, [canvas.id]);
    const first = await syncEntity(canvasAdapter, canvas.id, holder.ctx, seen);

    expect(first).toBe("skipped");
    expect(holder.reviews).toHaveLength(1);
    expect(holder.reviews[0]).toMatchObject({ entityId: canvas.id, deletedRemotely: true });
    expect(await exists(canvas.id)).toBe(true);

    const reviewId = (holder.reviews[0] as { id: string }).id;
    const confirmer = makeCtx(remote, { options: { confirmedDeletionIds: [reviewId] } });
    const seenAgain = await seenFor(remote, [canvas.id]);
    const second = await syncEntity(canvasAdapter, canvas.id, confirmer.ctx, seenAgain);

    expect(second).toBe("pulled");
    expect(await exists(canvas.id)).toBe(false);
    expect(await getSyncBase("canvas", canvas.id)).toBeNull();
  });

  it("asks when a remotely deleted canvas was also edited here", async () => {
    const remote = new InMemoryRemote();
    const canvas = await createCanvasRow({ title: "Shared" }, "local");
    await syncEntityBatch(canvasAdapter, makeCtx(remote).ctx);
    await updateCanvasRow(canvas.id, { title: "Kept work" }, "local");
    await remote.deleteRemote("canvas", canvas.id);

    const keeper = makeCtx(remote, { onConflict: vi.fn().mockResolvedValue("push") });
    const seen = await seenFor(remote, [canvas.id]);
    const kept = await syncEntity(canvasAdapter, canvas.id, keeper.ctx, seen);

    expect(kept).toBe("pushed");
    expect(keeper.ctx.onConflict).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: canvas.id, remoteDeleted: true })
    );
    expect(remote.getObject("canvas", canvas.id)?.deleted).toBe(false);
    expect(await remoteTitleOf(remote, canvas.id)).toBe("Kept work");
    expect(await exists(canvas.id)).toBe(true);
  });

  it("does not resurrect a tombstoned remote-only canvas", async () => {
    const remote = new InMemoryRemote();
    const { ctx, logs } = makeCtx(remote);
    const canvas = await createCanvasRow({ title: "Gone" }, "local");
    await syncEntityBatch(canvasAdapter, ctx);
    await seedRemoteFromLocal(remote, canvas.id);
    await deleteCanvasRow(canvas.id, "local");

    const batch = await syncEntityBatch(canvasAdapter, ctx);

    expect(batch.actions).toEqual(["skipped"]);
    expect(logs.some((l) => l.message.includes("tombstoned"))).toBe(true);
    expect(await exists(canvas.id)).toBe(false);
  });

  it("pushes a confirmed canvas tombstone to deleteRemote and clears the Sync Base", async () => {
    const remote = new InMemoryRemote();
    const emitLog = vi.fn();
    const canvas = await createCanvasRow({ title: "Old Map" }, "local");
    await syncEntityBatch(canvasAdapter, makeCtx(remote).ctx);
    expect(await getSyncBase("canvas", canvas.id)).not.toBeNull();
    await deleteCanvasRow(canvas.id, "local");

    const held = await processPendingDeletions(
      { canvas: { deleteRemote: (entityId: string) => remote.deleteRemote("canvas", entityId) } },
      ["canvas"],
      { scope: "all", direction: "bidirectional", confirmedDeletionIds: [] },
      emitLog
    );
    expect(held.pendingDeletions).toHaveLength(1);
    expect(remote.deleted).toHaveLength(0);
    expect(await getSyncBase("canvas", canvas.id)).not.toBeNull();

    // Confirming carries the deletion to the server and forgets the base.
    const pushed = await processPendingDeletions(
      { canvas: { deleteRemote: (entityId: string) => remote.deleteRemote("canvas", entityId) } },
      ["canvas"],
      {
        scope: "all",
        direction: "bidirectional",
        confirmedDeletionIds: [`canvas:${canvas.id}`],
      },
      emitLog
    );

    expect(pushed.actions).toEqual(["pushed"]);
    expect(remote.getObject("canvas", canvas.id)?.deleted).toBe(true);
    expect(await listPendingTombstones(["canvas"])).toHaveLength(0);
    expect(await getSyncBase("canvas", canvas.id)).toBeNull();
  });
});

describe("entity sync — canvas viewport stays out of the payload", () => {
  it("viewport-only changes move no clock, emit no Change, and keep the checksum", async () => {
    const { onChange } = await import("@/features/sync/change-feed");
    const seen: string[] = [];
    const stop = onChange(() => {
      seen.push("change");
    });
    const canvas = await createCanvasRow({ title: "Map" }, "local");
    const before = await testDb.select<Record<string, unknown>[]>(
      "SELECT updated_at, content_updated_at, doc FROM canvases WHERE id = ?",
      [canvas.id]
    );
    const checksumBefore = await computeChecksumAsync(
      await normalizeCanvasSnapshotAsync(await serializeCanvas(canvas.id))
    );
    seen.length = 0;

    // Viewport moves persist device-local only — no write path runs here.
    useReadingPositionStore.getState().saveCanvasViewport(canvas.id, { x: 5, y: 6, zoom: 2 });

    const after = await testDb.select<Record<string, unknown>[]>(
      "SELECT updated_at, content_updated_at, doc FROM canvases WHERE id = ?",
      [canvas.id]
    );
    expect(after[0].updated_at).toBe(before[0].updated_at);
    expect(after[0].content_updated_at).toBe(before[0].content_updated_at);
    expect(after[0].doc).toBe(before[0].doc);
    expect(seen).toHaveLength(0);
    expect(
      await computeChecksumAsync(
        await normalizeCanvasSnapshotAsync(await serializeCanvas(canvas.id))
      )
    ).toBe(checksumBefore);
    stop();
  });

  it("a pull keeps this device's viewport", async () => {
    const remote = new InMemoryRemote();
    const { ctx } = makeCtx(remote);
    const canvas = await createCanvasRow({ title: "Map" }, "local");
    await syncEntityBatch(canvasAdapter, ctx);
    useReadingPositionStore.getState().saveCanvasViewport(canvas.id, { x: 5, y: 6, zoom: 2 });
    await seedRemoteTitle(remote, canvas.id, "Remote edit");

    const seen = await seenFor(remote, [canvas.id]);
    const action = await syncEntity(canvasAdapter, canvas.id, ctx, seen);

    expect(action).toBe("pulled");
    expect(await readTitle(canvas.id)).toBe("Remote edit");
    expect(useReadingPositionStore.getState().getCanvasViewport(canvas.id)).toEqual({
      x: 5,
      y: 6,
      zoom: 2,
    });
    const rows = await testDb.select<{ doc: string }[]>(
      "SELECT doc FROM canvases WHERE id = ?",
      [canvas.id]
    );
    expect((JSON.parse(rows[0].doc) as Record<string, unknown>).viewport).toBeUndefined();
  });

  it("a legacy doc viewport seeds Reading Position on first read", async () => {
    const { useCanvasStore } = await import("@/features/canvas/store");
    const legacy = {
      ...createDefaultCanvasDoc(),
      viewport: { x: 11, y: 22, zoom: 2 },
    };
    const id = "legacy-viewport-canvas";
    await testDb.execute(
      'INSERT INTO canvases (id, title, doc, pinned, "order", created_at, updated_at, content_updated_at) VALUES (?, ?, ?, 0, 0, 1, 1, 1)',
      [id, "Legacy", JSON.stringify(legacy)]
    );
    expect(useReadingPositionStore.getState().getCanvasViewport(id)).toBeUndefined();

    await useCanvasStore.getState().loadCanvas(id);

    expect(useReadingPositionStore.getState().getCanvasViewport(id)).toEqual({
      x: 11,
      y: 22,
      zoom: 2,
    });
    expect(useCanvasStore.getState().doc.viewport).toEqual({ x: 11, y: 22, zoom: 2 });
    useCanvasStore.getState().closeCanvas();
  });

  it("a newly pulled canvas gets the default viewport", async () => {
    const remote = new InMemoryRemote();
    const { ctx } = makeCtx(remote);
    const id = await seedRemoteOnly(remote, "Fresh");

    await syncEntityBatch(canvasAdapter, ctx);

    expect(useReadingPositionStore.getState().getCanvasViewport(id)).toBeUndefined();
    const { useCanvasStore } = await import("@/features/canvas/store");
    await useCanvasStore.getState().loadCanvas(id);
    expect(useCanvasStore.getState().doc.viewport).toEqual(
      createDefaultCanvasDoc().viewport
    );
    useCanvasStore.getState().closeCanvas();
  });
});

describe("entity sync — newer canvas schema is stored verbatim and never pushed", () => {
  const NEWER = CURRENT_CANVAS_SCHEMA_VERSION + 1;

  async function pullNewerSchema(remote: InMemoryRemote): Promise<string> {
    const scratch = await createCanvasRow({ title: "scratch" }, "local");
    const json = await serializeCanvas(scratch.id);
    const obj = await parseJsonAsync<{ canvas: { id: string; title: string; doc: unknown } }>(json);
    const id = "newer-schema-canvas";
    const newerDoc = {
      schemaVersion: NEWER,
      nodes: [{ id: "future-node" }],
      edges: [],
      strokes: [],
    };
    obj.canvas.id = id;
    obj.canvas.title = "Future Map";
    obj.canvas.doc = newerDoc;
    const edited = await stringifySnapshotAsync(obj);
    const data = new Uint8Array(await encryptToBuffer(edited, PASS));
    await remote.seedLive("canvas", id, data, await remoteChecksumFor(edited));
    await testDb.execute("DELETE FROM canvases WHERE id = ?", [scratch.id]);
    return id;
  }

  it("pull stores the doc verbatim and a later sync never pushes it", async () => {
    const remote = new InMemoryRemote();
    const { ctx } = makeCtx(remote);
    const id = await pullNewerSchema(remote);

    const batch = await syncEntityBatch(canvasAdapter, ctx);

    expect(batch.actions).toEqual(["pulled"]);
    const rows = await testDb.select<{ doc: string }[]>(
      "SELECT doc FROM canvases WHERE id = ?",
      [id]
    );
    expect(JSON.parse(rows[0].doc)).toEqual({
      schemaVersion: NEWER,
      nodes: [{ id: "future-node" }],
      edges: [],
      strokes: [],
    });

    // Even after a local metadata write, no sync run uploads it.
    await updateCanvasRow(id, { pinned: true }, "local");
    const putsBefore = remote.pushed.filter((p) => p.entityId === id).length;
    const secondRun = makeCtx(remote);
    const second = await syncEntityBatch(canvasAdapter, secondRun.ctx);
    expect(second.actions).toEqual(["skipped"]);
    expect(remote.pushed.filter((p) => p.entityId === id).length).toBe(putsBefore);
    expect(secondRun.logs.some((l) => /newer format/.test(l.message))).toBe(true);
  });

  it("a conflict on a read-only canvas resolves as pull without asking", async () => {
    const remote = new InMemoryRemote();
    const { ctx } = makeCtx(remote);
    const id = await pullNewerSchema(remote);
    await syncEntityBatch(canvasAdapter, ctx);
    await updateCanvasRow(id, { title: "Local rename" }, "local");

    const refusingConflict = vi.fn(() => {
      throw new Error("must not ask for a read-only canvas");
    });
    const { ctx: conflictCtx, logs } = makeCtx(remote, { onConflict: refusingConflict });

    // Remote edits the same canvas elsewhere.
    const row = remote.getObject("canvas", id);
    expect(row).toBeDefined();
    const json = await decryptBufferToText(row!.data, PASS);
    const obj = await parseJsonAsync<{ canvas: { title: string } }>(json);
    obj.canvas.title = "Remote rename";
    const edited = await stringifySnapshotAsync(obj);
    await remote.seedLive("canvas", id, new Uint8Array(await encryptToBuffer(edited, PASS)), await remoteChecksumFor(edited));

    const seen = await seenFor(remote, [id]);
    const action = await syncEntity(canvasAdapter, id, conflictCtx, seen);

    expect(action).toBe("pulled");
    expect(refusingConflict).not.toHaveBeenCalled();
    expect(await readTitle(id)).toBe("Remote rename");
    expect(remote.pushed.filter((p) => p.entityId === id)).toHaveLength(0);
    expect(logs.some((l) => /newer format/.test(l.message))).toBe(true);
  });

  it("the editor opens a newer-schema canvas read-only and refuses replacement", async () => {
    const remote = new InMemoryRemote();
    const { ctx } = makeCtx(remote);
    const id = await pullNewerSchema(remote);
    await syncEntityBatch(canvasAdapter, ctx);
    const before = await testDb.select<Record<string, unknown>[]>(
      "SELECT * FROM canvases WHERE id = ?",
      [id]
    );

    const { useCanvasStore } = await import("@/features/canvas/store");
    await useCanvasStore.getState().loadCanvas(id);
    const state = useCanvasStore.getState();
    expect(state.loadState).toBe("error");
    expect(state.docLoadError?.code).toBe("unsupported-version");
    expect(state.editorReadOnly).toBe(true);
    expect(state.docWriteBlocked).toBe(true);

    // Replacement is not offered for newer schemas: the recovery refuses.
    await useCanvasStore.getState().replaceCorruptDocWithDefault();
    const after = await testDb.select<Record<string, unknown>[]>(
      "SELECT * FROM canvases WHERE id = ?",
      [id]
    );
    expect(after).toEqual(before);
    useCanvasStore.getState().closeCanvas();
  });

  it("read-only canvases still pull remote changes", async () => {
    const remote = new InMemoryRemote();
    const { ctx } = makeCtx(remote);
    const id = await pullNewerSchema(remote);
    await syncEntityBatch(canvasAdapter, ctx);

    const row = remote.getObject("canvas", id);
    const json = await decryptBufferToText(row!.data, PASS);
    const obj = await parseJsonAsync<{ canvas: { title: string } }>(json);
    obj.canvas.title = "Remote v2";
    const edited = await stringifySnapshotAsync(obj);
    await remote.seedLive("canvas", id, new Uint8Array(await encryptToBuffer(edited, PASS)), await remoteChecksumFor(edited));

    const batch = await syncEntityBatch(canvasAdapter, makeCtx(remote).ctx);
    expect(batch.actions).toEqual(["pulled"]);
    expect(await readTitle(id)).toBe("Remote v2");
  });
});

describe("entity sync — canvas 50 MB limit", () => {
  it("maps a content-size rejection to a clear Sync Log error and keeps syncing", async () => {
    const remote = new InMemoryRemote();
    const oversized = Object.assign(new Error("request failed"), {
      status: 400,
      data: { data: { content: { code: "validation_file_too_large" } } },
    });
    const realPush = remote.pushBlob.bind(remote);
    let failures = 0;
    remote.pushBlob = async (kind, entityId, data, checksum, remoteId) => {
      const rows = await testDb.select<{ title: string }[]>(
        "SELECT title FROM canvases WHERE id = ?",
        [entityId]
      );
      if (rows[0]?.title === "Huge") {
        failures += 1;
        throw oversized;
      }
      return realPush(kind, entityId, data, checksum, remoteId);
    };
    const { ctx, logs } = makeCtx(remote);
    const huge = await createCanvasRow({ title: "Huge" }, "local");
    const small = await createCanvasRow({ title: "Small" }, "local");
    await updateCanvasDocRow(
      huge.id,
      { ...createDefaultCanvasDoc(), nodes: [] },
      "local"
    );

    const batch = await syncEntityBatch(canvasAdapter, ctx);

    expect(failures).toBe(1);
    expect(batch.actions).toContain("skipped");
    expect(batch.actions).toContain("pushed");
    const errorEntry = logs.find((l) => l.level === "error");
    expect(errorEntry?.message).toContain("Huge");
    expect(errorEntry?.message).toContain("exceeds the sync server's 50 MB limit");
    // The other canvas still synced.
    expect(remote.getObject("canvas", small.id)?.deleted).toBe(false);
    expect(small.id).not.toBe(huge.id);
  });
});

describe("entity sync — deleting a note never edits canvases", () => {
  it("leaves every canvas row byte-identical", async () => {
    const { createNoteRow, deleteNoteRow } = await import("@/features/notes/write");
    const canvas = await createCanvasRow({ title: "Map" }, "local");
    await updateCanvasDocRow(
      canvas.id,
      {
        ...createDefaultCanvasDoc(),
        nodes: [
          { id: "ref-1", kind: "noteRef", noteId: "doomed-note", position: { x: 1, y: 2 } },
        ],
      },
      "local"
    );
    const note = await createNoteRow({ title: "Doomed" }, "local");
    // Point the canvas at the real note id, then snapshot every canvas row.
    await updateCanvasDocRow(
      canvas.id,
      {
        ...createDefaultCanvasDoc(),
        nodes: [{ id: "ref-1", kind: "noteRef", noteId: note.id, position: { x: 1, y: 2 } }],
      },
      "local"
    );
    const before = await testDb.select<Record<string, unknown>[]>(
      "SELECT * FROM canvases ORDER BY id"
    );

    await deleteNoteRow(note.id, "local");

    const after = await testDb.select<Record<string, unknown>[]>(
      "SELECT * FROM canvases ORDER BY id"
    );
    expect(after).toEqual(before);
  });
});
