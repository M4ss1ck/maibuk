import { describe, expect, it } from "vitest";
import {
  stringifySnapshot,
  parseJsonValue,
  normalizeNoteSnapshotJson,
  dumpHasDataSql,
  toOwnedBuffer,
  uint8ArrayToBase64,
  base64ToUint8Array,
} from "@/features/sync/sync-codec-handlers";

describe("stringifySnapshot / parseJsonValue", () => {
  it("round-trips plain snapshot objects", () => {
    const value = { book: { id: "b1", title: "T" }, chapters: [{ id: "c1" }] };
    expect(parseJsonValue(stringifySnapshot(value))).toEqual(value);
  });

  it("throws SyntaxError on invalid JSON", () => {
    expect(() => parseJsonValue("{not json")).toThrow(SyntaxError);
  });
});

describe("normalizeNoteSnapshotJson", () => {
  const fields = {
    id: "n1",
    bookId: null,
    title: "Note",
    content: "<p>hi</p>",
    language: "es",
    tags: null,
    pinned: false,
    order: 0,
    wordCount: 1,
    collapsedHeadings: '["h1"]',
    createdAt: 1,
    updatedAt: 2,
    contentUpdatedAt: 2,
  };

  it("drops contentUpdatedAt, keeps explicit language, nulls collapsedHeadings", () => {
    const out = JSON.parse(normalizeNoteSnapshotJson(JSON.stringify({ note: fields }))).note;
    expect(out.contentUpdatedAt).toBeUndefined();
    expect(out.language).toBe("es");
    expect(out.collapsedHeadings).toBeNull();
    expect(out.title).toBe("Note");
  });

  it("defaults a missing language to en", () => {
    const { language: _dropped, ...withoutLanguage } = fields;
    const out = JSON.parse(
      normalizeNoteSnapshotJson(JSON.stringify({ note: withoutLanguage }))
    ).note;
    expect(out.language).toBe("en");
  });

  it("byte-matches a legacy snapshot missing contentUpdatedAt", () => {
    const { contentUpdatedAt: _dropped, ...legacyFields } = fields;
    const current = normalizeNoteSnapshotJson(JSON.stringify({ note: fields }));
    const legacy = normalizeNoteSnapshotJson(JSON.stringify({ note: legacyFields }));
    expect(current).toBe(legacy);
  });
});

describe("dumpHasDataSql", () => {
  it("detects INSERT statements", () => {
    expect(dumpHasDataSql('INSERT INTO "books" ("id") VALUES (\'a\');')).toBe(true);
    expect(dumpHasDataSql("insert or replace into notes values (1);")).toBe(true);
  });

  it("ignores comments, CREATE statements, and semicolons inside strings", () => {
    expect(dumpHasDataSql("-- Maibuk Database Export\n-- nothing yet\n")).toBe(false);
    expect(dumpHasDataSql("CREATE TABLE books (id TEXT);")).toBe(false);
    expect(dumpHasDataSql("SELECT ';' FROM books;")).toBe(false);
    expect(dumpHasDataSql("")).toBe(false);
  });
});

describe("toOwnedBuffer / base64 helpers", () => {
  it("copies respecting byteOffset without detaching the source", () => {
    const backing = new Uint8Array([0, 1, 2, 3, 4]);
    const view = new Uint8Array(backing.buffer, 1, 3);
    const owned = toOwnedBuffer(view);
    expect(owned.byteLength).toBe(3);
    expect([...new Uint8Array(owned)]).toEqual([1, 2, 3]);
    expect(view.buffer.byteLength).toBe(5);
  });

  it("round-trips base64", () => {
    const data = new Uint8Array([0, 1, 250, 255]);
    expect(base64ToUint8Array(uint8ArrayToBase64(data))).toEqual(data);
  });
});
