import { describe, it, expect, vi } from "vitest";

const mockExportDatabase = vi.hoisted(() => vi.fn());

vi.mock("../../../../lib/db", () => ({
  exportDatabase: mockExportDatabase,
}));

const { generateSqlDump } = await import("@/features/backup/generate-sql-dump");

describe("generateSqlDump", () => {
  it("returns exportDatabase bytes directly without decoding", async () => {
    const sqlText = "INSERT INTO books (id) VALUES ('test');";
    const bytes = new TextEncoder().encode(sqlText);
    mockExportDatabase.mockResolvedValue(bytes);

    const result = await generateSqlDump();
    expect(result).toBe(bytes);
  });
});
