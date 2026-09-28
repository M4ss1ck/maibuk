import { describe, expect, it, vi } from "vitest";
import type { DatabaseAdapter } from "@/lib/platform/types";
import {
  COMPACT_MIN_FREE_BYTES,
  compactLibrary,
  readLibrarySize,
  shouldCompact,
} from "@/lib/db/compact";
import { createTestDatabase } from "@/test/support/db-test-context";

const PAGE = 4096;
const minFreePages = COMPACT_MIN_FREE_BYTES / PAGE;

describe("shouldCompact()", () => {
  it("compacts when free pages are both large and a big share of the file", () => {
    expect(shouldCompact({ pageSize: PAGE, pageCount: 700_590, freePages: 681_801 })).toBe(true);
  });

  it("leaves a file alone when the free space is small in bytes", () => {
    expect(shouldCompact({ pageSize: PAGE, pageCount: 100, freePages: 90 })).toBe(false);
  });

  it("leaves a big file alone when free pages are a small share of it", () => {
    expect(
      shouldCompact({ pageSize: PAGE, pageCount: minFreePages * 10, freePages: minFreePages })
    ).toBe(false);
  });

  it("leaves an empty file alone", () => {
    expect(shouldCompact({ pageSize: PAGE, pageCount: 0, freePages: 0 })).toBe(false);
  });
});

describe("compactLibrary()", () => {
  async function libraryWithFreedSpace(): Promise<DatabaseAdapter> {
    const db = await createTestDatabase();
    await db.execute(
      `INSERT INTO books (id, title, author_name, created_at, updated_at) VALUES ('b1', 'Kept', 'A', 1, 1)`
    );
    const body = "x".repeat(1024 * 1024);
    for (let i = 0; i < 48; i++) {
      await db.execute(
        `INSERT INTO book_versions (id, book_id, snapshot, checksum, created_at) VALUES (?, 'b1', ?, 'c', 1)`,
        [`v${i}`, body]
      );
    }
    await db.execute("DELETE FROM book_versions");
    return db;
  }

  it("rewrites a mostly free Library without its free pages and keeps its rows", async () => {
    const db = await libraryWithFreedSpace();
    const before = await readLibrarySize(db);
    expect(shouldCompact(before)).toBe(true);

    const result = await compactLibrary(db);

    expect(result?.before).toEqual(before);
    const after = await readLibrarySize(db);
    expect(after.freePages).toBe(0);
    expect(after.pageCount).toBeLessThan(before.pageCount / 10);
    expect(await db.select("SELECT title FROM books")).toEqual([{ title: "Kept" }]);
  });

  it("does nothing when there is little to reclaim", async () => {
    const db = await createTestDatabase();
    const execute = vi.spyOn(db, "execute");

    expect(await compactLibrary(db)).toBeNull();
    expect(execute).not.toHaveBeenCalledWith("VACUUM");
  });

  it("reports a failed VACUUM without throwing, so the Library still opens", async () => {
    const db = await libraryWithFreedSpace();
    vi.spyOn(db, "execute").mockRejectedValueOnce(new Error("database is locked"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(compactLibrary(db)).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(
      "[db] compacting the Library failed; it stays as it was",
      expect.any(Error)
    );
    warn.mockRestore();
  });
});
