import { describe, it, expect } from "vitest";
import { normaliseToUpsert } from "../../../../lib/db";

describe("normaliseToUpsert()", () => {
  it("converts INSERT INTO to INSERT OR REPLACE INTO", () => {
    const input = 'INSERT INTO "books" ("id", "title") VALUES (\'1\', \'Test\');';
    expect(normaliseToUpsert(input)).toBe(
      'INSERT OR REPLACE INTO "books" ("id", "title") VALUES (\'1\', \'Test\');'
    );
  });

  it("preserves existing INSERT OR REPLACE INTO", () => {
    const input = 'INSERT OR REPLACE INTO "books" ("id") VALUES (\'1\');';
    expect(normaliseToUpsert(input)).toBe('INSERT OR REPLACE INTO "books" ("id") VALUES (\'1\');');
  });

  it("handles INSERT OR IGNORE INTO by converting to INSERT OR REPLACE INTO", () => {
    const input = 'INSERT OR IGNORE INTO "settings" ("key") VALUES (\'theme\');';
    expect(normaliseToUpsert(input)).toBe(
      'INSERT OR REPLACE INTO "settings" ("key") VALUES (\'theme\');'
    );
  });

  it("is case-insensitive", () => {
    const input = 'insert into "chapters" ("id") values (\'1\');';
    expect(normaliseToUpsert(input)).toBe(
      'INSERT OR REPLACE INTO "chapters" ("id") values (\'1\');'
    );
  });

  it("passes through non-INSERT statements unchanged", () => {
    const comment = "-- Maibuk Database Export";
    expect(normaliseToUpsert(comment)).toBe(comment);

    const create = "CREATE TABLE IF NOT EXISTS books (id TEXT PRIMARY KEY);";
    expect(normaliseToUpsert(create)).toBe(create);

    const del = "DELETE FROM chapters;";
    expect(normaliseToUpsert(del)).toBe(del);
  });

  it("passes through empty strings", () => {
    expect(normaliseToUpsert("")).toBe("");
  });
});
