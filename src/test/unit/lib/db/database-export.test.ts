import { describe, it, expect } from "vitest";
import { createTestDatabase } from "../../../support/db-test-context";

describe("DatabaseAdapter export/import round-trip", () => {
  it("round-trips book_versions rows", async () => {
    const db = await createTestDatabase();

    // Seed data
    await db.execute(`
      INSERT INTO books (id, title, author_name, created_at, updated_at)
      VALUES ('book-1', 'Test Book', 'Author', 1000, 1000)
    `);

    await db.execute(`
      INSERT INTO book_versions (id, book_id, name, snapshot, word_count, checksum, trigger_type, created_at)
      VALUES ('ver-1', 'book-1', 'Draft 1', '{"title":"Test"}', 1000, 'abc123', 'manual', 2000)
    `);

    // Export
    const exported = await db.exportData();
    const sqlDump = new TextDecoder().decode(exported);

    // Verify export contains book_versions
    expect(sqlDump).toContain('INSERT OR REPLACE INTO "book_versions"');
    expect(sqlDump).toContain('ver-1');

    // Create fresh DB and import
    const freshDb = await createTestDatabase();
    await freshDb.importData(sqlDump);

    // Verify rows
    const versions = await freshDb.select<Record<string, unknown>[]>(
      "SELECT * FROM book_versions WHERE id = ?",
      ["ver-1"]
    );
    expect(versions.length).toBe(1);
    expect(versions[0].id).toBe("ver-1");
    expect(versions[0].name).toBe("Draft 1");
    expect(versions[0].snapshot).toBe('{"title":"Test"}');
    expect(versions[0].word_count).toBe(1000);
    expect(versions[0].checksum).toBe("abc123");
  });

  it("round-trips sync tombstones", async () => {
    const db = await createTestDatabase();

    await db.execute(`
      INSERT INTO sync_tombstones
        (id, entity_type, entity_id, title, deleted_at, confirmed_at, pushed_at)
      VALUES ('book:book-1', 'book', 'book-1', 'Deleted Draft', 1000, NULL, NULL)
    `);

    const exported = await db.exportData();
    const sqlDump = new TextDecoder().decode(exported);

    expect(sqlDump).toContain('INSERT OR REPLACE INTO "sync_tombstones"');
    expect(sqlDump).toContain("Deleted Draft");

    const freshDb = await createTestDatabase();
    await freshDb.importData(sqlDump);

    const tombstones = await freshDb.select<Record<string, unknown>[]>(
      "SELECT * FROM sync_tombstones WHERE id = ?",
      ["book:book-1"]
    );
    expect(tombstones).toHaveLength(1);
    expect(tombstones[0].entity_type).toBe("book");
    expect(tombstones[0].entity_id).toBe("book-1");
  });
});
