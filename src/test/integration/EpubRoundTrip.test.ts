import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseAdapter } from "../../lib/platform/types";
import { createTestDatabase } from "../support/db-test-context";
import { buildMinimalEpubFixture } from "../support/epub-fixtures";
import { readEpub } from "../../features/import/epub-reader";
import { normalizeEpubProject } from "../../features/import/epub-normalizer";
import { insertBookMetadata, insertBookStyles, listBookMetadata, listBookStyles } from "../../features/import/epub-project-repo";
import { insertProjectAssets, listProjectAssets } from "../../features/import/project-assets-repo";
import { buildProjectEpubPackage } from "../../features/export/project-epub-generator";
import { buildBook, buildChapter } from "../support/fixtures";

let testDb: DatabaseAdapter;

const { mockGetDatabase } = vi.hoisted(() => ({ mockGetDatabase: vi.fn() }));
vi.mock("../../lib/db", () => ({ getDatabase: mockGetDatabase }));

describe("EPUB semantic round trip", () => {
  beforeEach(async () => {
    testDb = await createTestDatabase();
    mockGetDatabase.mockResolvedValue(testDb);
    await testDb.execute(
      `INSERT INTO books (id, title, author_name, language, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ["book-1", "Fixture Book", "Fixture Author", "en", 1, 1]
    );
  });

  it("preserves title, author, language, chapter order, CSS, and asset references", async () => {
    const parsed = readEpub(buildMinimalEpubFixture());
    const normalized = normalizeEpubProject(parsed);

    await insertBookMetadata("book-1", normalized.metadata);
    await insertBookStyles("book-1", normalized.styles);
    await insertProjectAssets("book-1", normalized.assets);

    const metadata = await listBookMetadata("book-1");
    const styles = await listBookStyles("book-1");
    const assets = await listProjectAssets("book-1");
    const book = buildBook({
      id: "book-1",
      title: normalized.bookInput.title,
      authorName: normalized.bookInput.authorName,
      language: normalized.bookInput.language ?? "en",
    });
    const chapters = normalized.chapters.map((chapter, index) =>
      buildChapter({
        id: `chapter-${index + 1}`,
        bookId: "book-1",
        title: chapter.title,
        content: `${chapter.content}<figure data-image=""><img src="maibuk-asset:asset-cover"></figure>`,
        order: chapter.spineIndex,
      })
    );

    const pkg = buildProjectEpubPackage({
      book,
      chapters,
      metadata,
      styles,
      assets,
      options: { includeImportedStyles: true, useMaibukStyles: true, generateMaibukToc: true },
    });

    expect(pkg.title).toBe("Fixture Book");
    expect(pkg.author).toBe("Fixture Author");
    expect(pkg.language).toBe("en");
    expect(pkg.toc.map((item) => item.title)).toEqual(["Chapter One"]);
    expect(pkg.css).toContain("body { font-family: serif; }");
    expect(pkg.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "asset-cover", filename: "cover.png" }),
      ])
    );
    expect(pkg.chapters[0].content).toContain("assets/cover.png");
  });
});
