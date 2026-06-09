import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DatabaseAdapter } from "../../../../lib/platform/types";
import { createTestDatabase } from "../../../support/db-test-context";

let testDb: DatabaseAdapter;

const { mockGetDatabase } = vi.hoisted(() => ({ mockGetDatabase: vi.fn() }));
vi.mock("../../../../lib/db", () => ({ getDatabase: mockGetDatabase }));

const { insertProjectAssets, upsertSeparatorAsset } = await import(
  "../../../../features/import/project-assets-repo"
);

describe("upsertSeparatorAsset", () => {
  beforeEach(async () => {
    testDb = await createTestDatabase();
    mockGetDatabase.mockResolvedValue(testDb);
    await testDb.execute(
      `INSERT INTO books (id, title, author_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      ["book-1", "Imported Book", "Author", 1, 1],
    );
  });

  it("reuses an existing asset with the same base64", async () => {
    await insertProjectAssets("book-1", [
      {
        id: "existing",
        filename: "sep.png",
        href: "assets/scene-break-existing-sep.png",
        mediaType: "image/png",
        role: "scene-break-separator",
        dataBase64: "AAAA",
      },
    ]);

    const result = await upsertSeparatorAsset("book-1", {
      dataBase64: "AAAA",
      mediaType: "image/png",
      filename: "sep.png",
    });

    expect(result.id).toBe("existing");
  });

  it("inserts a new asset when none matches", async () => {
    const result = await upsertSeparatorAsset("book-1", {
      dataBase64: "BBBB",
      mediaType: "image/png",
      filename: "sep.png",
    });

    expect(result).toMatchObject({
      filename: "sep.png",
      mediaType: "image/png",
      role: "scene-break-separator",
      dataBase64: "BBBB",
      sizeBytes: 4,
    });
    expect(result.href).toMatch(/^assets\/scene-break-.+-sep\.png$/);
  });
});
