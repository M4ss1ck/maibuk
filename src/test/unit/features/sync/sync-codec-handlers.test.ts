import { describe, expect, it } from "vitest";
import {
  stringifySnapshot,
  parseJsonValue,
  normalizeNoteSnapshotJson,
  normalizeBookSnapshotJson,
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

describe("normalizeBookSnapshotJson", () => {
  const book = {
    id: "book-1",
    title: "Title",
    subtitle: null,
    authorName: "Author",
    description: null,
    genre: null,
    language: "en",
    coverImagePath: null,
    coverData: null,
    wordCount: 3,
    targetWordCount: null,
    status: "draft",
    createdAt: 1,
    updatedAt: 10,
    lastOpenedAt: 20,
    lastChapterId: "ch-1",
  };
  const chapters = [{ id: "ch-1", content: "<p>Body</p>", updatedAt: 5 }];

  // Opening a book or switching chapters must not read as a local edit.
  it("ignores per-device navigation state", () => {
    const opened = JSON.stringify({
      book: { ...book, updatedAt: 99, lastOpenedAt: 99, lastChapterId: "ch-2" },
      chapters,
    });

    expect(normalizeBookSnapshotJson(opened)).toBe(
      normalizeBookSnapshotJson(JSON.stringify({ book, chapters }))
    );
  });

  it("still changes when book fields or chapters change", () => {
    const base = normalizeBookSnapshotJson(JSON.stringify({ book, chapters }));

    expect(
      normalizeBookSnapshotJson(JSON.stringify({ book: { ...book, title: "New" }, chapters }))
    ).not.toBe(base);
    expect(
      normalizeBookSnapshotJson(
        JSON.stringify({ book, chapters: [{ ...chapters[0], content: "<p>Edit</p>", updatedAt: 6 }] })
      )
    ).not.toBe(base);
  });
});
