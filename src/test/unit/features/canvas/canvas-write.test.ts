import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseAdapter } from "@/lib/platform/types";
import { createDefaultCanvasDoc } from "@/features/canvas/types";
import { createTestDatabase } from "@/test/support/db-test-context";
import type { Change } from "@/features/sync/change-feed";

let testDb: DatabaseAdapter;
const { mockGetDatabase } = vi.hoisted(() => ({ mockGetDatabase: vi.fn() }));

vi.mock("../../../../lib/db", () => ({ getDatabase: mockGetDatabase }));

const {
  createCanvasRow,
  updateCanvasDocRow,
  updateCanvasRow,
  reorderCanvasRows,
  deleteCanvasRow,
  removeCanvasRow,
  applyCanvasSnapshotData,
} = await import("@/features/canvas/write");
const { onChange, resetChangeFeedForTests } = await import("@/features/sync/change-feed");
const { getTombstone } = await import("@/features/sync/tombstones");

let changes: Change[];

beforeEach(async () => {
  testDb = await createTestDatabase();
  mockGetDatabase.mockReset();
  mockGetDatabase.mockResolvedValue(testDb);
  resetChangeFeedForTests();
  changes = [];
  onChange((change) => {
    changes.push(change);
  });
});

async function rowCount(): Promise<number> {
  const rows = await testDb.select<{ id: string }[]>("SELECT id FROM canvases");
  return rows.length;
}

describe("canvas write path", () => {
  it("create emits one local content Change", async () => {
    const canvas = await createCanvasRow({ title: "Map" }, "local");

    expect(canvas.title).toBe("Map");
    expect(canvas.doc).toEqual(createDefaultCanvasDoc());
    expect(await rowCount()).toBe(1);
    expect(changes).toEqual([{ entity: "canvas", id: canvas.id, origin: "local", kind: "content" }]);
  });

  it("doc save emits one local content Change and moves Last Edited", async () => {
    const canvas = await createCanvasRow({ title: "Map" }, "local");
    changes = [];
    const doc = { ...createDefaultCanvasDoc(), nodes: [] };
    const stored = await updateCanvasDocRow(canvas.id, doc, "local");

    expect(stored?.contentUpdatedAt).toBeGreaterThanOrEqual(canvas.contentUpdatedAt);
    expect(changes).toEqual([
      { entity: "canvas", id: canvas.id, origin: "local", kind: "content" },
    ]);
  });

  it("doc save stores content without the viewport", async () => {
    const canvas = await createCanvasRow({ title: "Map" }, "local");
    const doc = { ...createDefaultCanvasDoc(), viewport: { x: 9, y: 8, zoom: 3 } };
    await updateCanvasDocRow(canvas.id, doc, "local");

    const rows = await testDb.select<{ doc: string }[]>(
      "SELECT doc FROM canvases WHERE id = ?",
      [canvas.id]
    );
    expect((JSON.parse(rows[0].doc) as Record<string, unknown>).viewport).toBeUndefined();
  });

  it("title edit is a content Change, pin and order edits are metadata Changes", async () => {
    const canvas = await createCanvasRow({ title: "Map" }, "local");
    changes = [];

    await updateCanvasRow(canvas.id, { title: "Atlas" }, "local");
    expect(changes).toEqual([
      { entity: "canvas", id: canvas.id, origin: "local", kind: "content" },
    ]);

    changes = [];
    await updateCanvasRow(canvas.id, { pinned: true }, "local");
    expect(changes).toEqual([
      { entity: "canvas", id: canvas.id, origin: "local", kind: "metadata" },
    ]);

    changes = [];
    const before = (
      await testDb.select<{ content_updated_at: number }[]>(
        "SELECT content_updated_at FROM canvases WHERE id = ?",
        [canvas.id]
      )
    )[0].content_updated_at;
    await updateCanvasRow(canvas.id, { order: 7 }, "local");
    expect(changes).toEqual([
      { entity: "canvas", id: canvas.id, origin: "local", kind: "metadata" },
    ]);
    const after = (
      await testDb.select<{ content_updated_at: number }[]>(
        "SELECT content_updated_at FROM canvases WHERE id = ?",
        [canvas.id]
      )
    )[0].content_updated_at;
    expect(after).toBe(before);
  });

  it("reorder emits one metadata Change per persisted row", async () => {
    const a = await createCanvasRow({ title: "A" }, "local");
    const b = await createCanvasRow({ title: "B" }, "local");
    changes = [];

    await reorderCanvasRows(
      [
        { id: a.id, order: 1 },
        { id: b.id, order: 0 },
      ],
      "local"
    );

    expect(changes).toEqual([
      { entity: "canvas", id: a.id, origin: "local", kind: "metadata" },
      { entity: "canvas", id: b.id, origin: "local", kind: "metadata" },
    ]);
  });

  it("local delete records a tombstone and emits one Change", async () => {
    const canvas = await createCanvasRow({ title: "Doomed" }, "local");
    changes = [];

    await deleteCanvasRow(canvas.id, "local");

    expect(await rowCount()).toBe(0);
    expect(await getTombstone("canvas", canvas.id)).not.toBeNull();
    expect(changes).toEqual([
      { entity: "canvas", id: canvas.id, origin: "local", kind: "content" },
    ]);
  });

  it("remote removal records no tombstone and emits a remote Change", async () => {
    const canvas = await createCanvasRow({ title: "Gone elsewhere" }, "local");
    changes = [];

    await removeCanvasRow(canvas.id, "remote");

    expect(await rowCount()).toBe(0);
    expect(await getTombstone("canvas", canvas.id)).toBeNull();
    expect(changes).toEqual([
      { entity: "canvas", id: canvas.id, origin: "remote", kind: "content" },
    ]);
  });

  it("remote apply emits origin remote and keeps metadata-only Last Edited", async () => {
    const canvas = await createCanvasRow({ title: "Map" }, "local");
    const before = (
      await testDb.select<{ content_updated_at: number }[]>(
        "SELECT content_updated_at FROM canvases WHERE id = ?",
        [canvas.id]
      )
    )[0].content_updated_at;
    changes = [];

    const stored = await applyCanvasSnapshotData(
      {
        canvas: {
          id: canvas.id,
          title: "Map",
          pinned: true,
          order: canvas.order,
          doc: { schemaVersion: 3, nodes: [], edges: [], strokes: [] },
          createdAt: canvas.createdAt,
          updatedAt: canvas.updatedAt + 10,
          contentUpdatedAt: canvas.updatedAt + 10,
        },
      },
      "remote"
    );

    expect(stored.pinned).toBe(true);
    expect(stored.contentUpdatedAt).toBe(before);
    expect(changes).toEqual([
      { entity: "canvas", id: canvas.id, origin: "remote", kind: "metadata" },
    ]);
  });

  it("remote apply of a doc change is a content Change", async () => {
    const canvas = await createCanvasRow({ title: "Map" }, "local");
    changes = [];

    await applyCanvasSnapshotData(
      {
        canvas: {
          id: canvas.id,
          title: "Map",
          pinned: false,
          order: canvas.order,
          doc: {
            schemaVersion: 3,
            nodes: [
              {
                id: "n1",
                kind: "text",
                html: "<p>Remote</p>",
                position: { x: 0, y: 0 },
              },
            ],
            edges: [],
            strokes: [],
          },
          createdAt: canvas.createdAt,
          updatedAt: canvas.updatedAt + 10,
          contentUpdatedAt: canvas.updatedAt + 10,
        },
      },
      "remote"
    );

    expect(changes).toEqual([
      { entity: "canvas", id: canvas.id, origin: "remote", kind: "content" },
    ]);
  });
});
