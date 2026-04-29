import { describe, it, expect, vi } from "vitest";

const mockExportDatabase = vi.hoisted(() => vi.fn());

vi.mock("../../../../lib/db", () => ({
  exportDatabase: mockExportDatabase,
}));

const { generateSqlDump } = await import("../../../../features/backup/generate-sql-dump");

describe("generateSqlDump", () => {
  it("returns decoded string from exportDatabase", async () => {
    const sqlText = "INSERT INTO books (id) VALUES ('test');";
    mockExportDatabase.mockResolvedValue(new TextEncoder().encode(sqlText));

    const result = await generateSqlDump();
    expect(result).toBe(sqlText);
  });
});
