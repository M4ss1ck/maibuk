import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseAdapter } from "@/lib/platform/types";
import { createTestDatabase } from "@/test/support/db-test-context";

const { mockGetDatabase } = vi.hoisted(() => ({ mockGetDatabase: vi.fn() }));

vi.mock("@/lib/db", () => ({ getDatabase: mockGetDatabase }));

const { openPluginEntity, resolvePluginEntityRoute, setPluginNavigator } = await import(
  "@/features/plugins/navigation"
);

describe("Plugin entity navigation", () => {
  let testDb: DatabaseAdapter;

  beforeEach(async () => {
    testDb = await createTestDatabase();
    mockGetDatabase.mockResolvedValue(testDb);
    await testDb.execute(
      `INSERT INTO books (id, title, author_name, created_at, updated_at) VALUES ('b1', 'Dune', 'Frank', 1, 1)`
    );
    await testDb.execute(
      `INSERT INTO chapters (id, book_id, title, "order", word_count, created_at, updated_at)
       VALUES ('c1', 'b1', 'One', 0, 0, 1, 1)`
    );
    await testDb.execute(
      `INSERT INTO notes (id, title, "order", created_at, updated_at) VALUES ('n1', 'Note', 0, 1, 1)`
    );
    await testDb.execute(
      `INSERT INTO canvases (id, title, doc, "order", created_at, updated_at, content_updated_at)
       VALUES ('cv1', 'Board', '{}', 0, 1, 1, 1)`
    );
  });

  it("resolves each entity to its route, a Chapter through its Book", async () => {
    await expect(resolvePluginEntityRoute({ kind: "book", id: "b1" })).resolves.toEqual({
      to: "/book/b1",
    });
    await expect(resolvePluginEntityRoute({ kind: "chapter", id: "c1" })).resolves.toEqual({
      to: "/book/b1",
      state: { openChapterId: "c1" },
    });
    await expect(resolvePluginEntityRoute({ kind: "note", id: "n1" })).resolves.toEqual({
      to: "/notes/n1",
    });
    await expect(resolvePluginEntityRoute({ kind: "canvas", id: "cv1" })).resolves.toEqual({
      to: "/canvas/cv1",
    });
    await expect(resolvePluginEntityRoute({ kind: "note", id: "absent" })).resolves.toBeNull();
  });

  it("opens an entity through the registered navigator and carries a reveal range", async () => {
    const navigate = vi.fn();
    const unregister = setPluginNavigator((to, options) => navigate(to, options));
    try {
      await openPluginEntity({ kind: "chapter", id: "c1" }, { from: 3, to: 9 });
      expect(navigate).toHaveBeenCalledWith("/book/b1", {
        state: { openChapterId: "c1", reveal: { from: 3, to: 9 } },
      });
    } finally {
      unregister();
    }
  });

  it("is a no-op when no navigator is registered or the entity is gone", async () => {
    const navigate = vi.fn();
    const unregister = setPluginNavigator(navigate);
    try {
      await openPluginEntity({ kind: "book", id: "absent" });
      expect(navigate).not.toHaveBeenCalled();
    } finally {
      unregister();
    }
    // No navigator: never throws.
    await expect(openPluginEntity({ kind: "book", id: "b1" })).resolves.toBeUndefined();
  });
});
