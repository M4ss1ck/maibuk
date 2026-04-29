import { describe, expect, it } from "vitest";
import { parseSqlStatements } from "../../../../lib/db/sql-parser";

describe("parseSqlStatements", () => {
  it("keeps semicolons inside quoted strings", () => {
    const sql =
      "INSERT INTO books VALUES ('hello;world');\nINSERT INTO chapters VALUES ('chapter');";

    expect(parseSqlStatements(sql)).toEqual([
      "INSERT INTO books VALUES ('hello;world')",
      "INSERT INTO chapters VALUES ('chapter')",
    ]);
  });

  it("handles doubled single quotes without splitting early", () => {
    const sql =
      "INSERT INTO books VALUES ('It''s fine; still text');\nINSERT INTO chapters VALUES ('done');";

    expect(parseSqlStatements(sql)).toEqual([
      "INSERT INTO books VALUES ('It''s fine; still text')",
      "INSERT INTO chapters VALUES ('done')",
    ]);
  });

  it("strips line comments outside strings", () => {
    const sql =
      "-- export header\nINSERT INTO books VALUES ('alpha'); -- trailing note\n-- another comment\nINSERT INTO chapters VALUES ('beta');";

    expect(parseSqlStatements(sql)).toEqual([
      "INSERT INTO books VALUES ('alpha')",
      "INSERT INTO chapters VALUES ('beta')",
    ]);
  });

  it("keeps the final statement without a trailing semicolon", () => {
    const sql = "INSERT INTO books VALUES ('alpha');\nINSERT INTO chapters VALUES ('beta')";

    expect(parseSqlStatements(sql)).toEqual([
      "INSERT INTO books VALUES ('alpha')",
      "INSERT INTO chapters VALUES ('beta')",
    ]);
  });

  it("does not treat backslashes as SQL string escaping rules", () => {
    const sql =
      "INSERT INTO books VALUES ('C:\\\\drafts;notes');\nINSERT INTO chapters VALUES ('tail');";

    expect(parseSqlStatements(sql)).toEqual([
      "INSERT INTO books VALUES ('C:\\\\drafts;notes')",
      "INSERT INTO chapters VALUES ('tail')",
    ]);
  });
});
