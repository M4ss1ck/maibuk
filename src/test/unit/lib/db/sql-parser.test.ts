import { describe, expect, it } from "vitest";
import { parseSqlLineComments, parseSqlStatements } from "@/lib/db/sql-parser";

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

describe("parseSqlLineComments", () => {
  it("returns dump section headers without their dashes", () => {
    const sql = "-- Books\nINSERT INTO books VALUES ('a');\n\n-- Canvases\n\n-- Settings\n";

    expect(parseSqlLineComments(sql)).toEqual(["Books", "Canvases", "Settings"]);
  });

  it("ignores '--' inside single- and double-quoted text, even across lines", () => {
    const sql =
      "-- Notes\nINSERT INTO notes VALUES ('Part one\n-- Canvases\nPart two', \"x -- y\");\n-- Settings";

    expect(parseSqlLineComments(sql)).toEqual(["Notes", "Settings"]);
  });

  it("keeps a trailing comment on the same line as a statement", () => {
    expect(parseSqlLineComments("INSERT INTO books VALUES ('a'); -- note")).toEqual(["note"]);
  });

  it("returns nothing for a dump without comments", () => {
    expect(parseSqlLineComments("INSERT INTO books VALUES ('a');")).toEqual([]);
  });
});
