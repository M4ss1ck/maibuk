import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseAdapter } from "../../../../lib/platform/types";
import { createTestDatabase } from "../../../support/db-test-context";

let testDb: DatabaseAdapter;

const { mockGetDatabase } = vi.hoisted(() => ({ mockGetDatabase: vi.fn() }));
vi.mock("../../../../lib/db", () => ({ getDatabase: mockGetDatabase }));

const { insertProjectAssets, listProjectAssets } = await import(
  "../../../../features/import/project-assets-repo"
);

describe("project assets repository", () => {
  beforeEach(async () => {
    testDb = await createTestDatabase();
    mockGetDatabase.mockResolvedValue(testDb);
    await testDb.execute(
      `INSERT INTO books (id, title, author_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      ["book-1", "Imported Book", "Author", 1, 1]
    );
  });

  it("inserts and lists project assets by book id", async () => {
    await insertProjectAssets("book-1", [
      {
        id: "asset-1",
        filename: "cover.png",
        href: "EPUB/images/cover.png",
        mediaType: "image/png",
        role: "cover",
        dataBase64: "iVBORw0KGgo=",
        sizeBytes: 8,
        checksum: "sha256-cover",
      },
    ]);

    const assets = await listProjectAssets("book-1");

    expect(assets).toEqual([
      expect.objectContaining({
        id: "asset-1",
        bookId: "book-1",
        filename: "cover.png",
        href: "EPUB/images/cover.png",
        mediaType: "image/png",
        role: "cover",
        dataBase64: "iVBORw0KGgo=",
        textContent: null,
        sizeBytes: 8,
        checksum: "sha256-cover",
      }),
    ]);
  });

  it("stores CSS assets as text content", async () => {
    await insertProjectAssets("book-1", [
      {
        id: "asset-css",
        filename: "book.css",
        href: "EPUB/styles/book.css",
        mediaType: "text/css",
        textContent: "body { font-family: serif; }",
        sizeBytes: 29,
      },
    ]);

    const assets = await listProjectAssets("book-1");

    expect(assets[0]).toMatchObject({
      id: "asset-css",
      textContent: "body { font-family: serif; }",
      dataBase64: null,
    });
  });

  it("stores binary assets as base64", async () => {
    await insertProjectAssets("book-1", [
      {
        id: "asset-font",
        filename: "font.woff2",
        href: "EPUB/fonts/font.woff2",
        mediaType: "font/woff2",
        dataBase64: "AAECAw==",
        sizeBytes: 4,
      },
    ]);

    const assets = await listProjectAssets("book-1");

    expect(assets[0]).toMatchObject({
      id: "asset-font",
      dataBase64: "AAECAw==",
      textContent: null,
    });
  });
});
