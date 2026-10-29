/**
 * The Shelf's pure rules (#653): format sniffing, the Fingerprint, ordering,
 * the upsert that keeps one Document from becoming two, removal, state changes,
 * reattaching a located file, and the Reader settings bounds.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_READER_SETTINGS,
  clampSettings,
  fingerprint,
  formatFromName,
  markState,
  parseShelf,
  positionKey,
  progressSummary,
  reattach,
  relativeTimestamp,
  removeEntry,
  sniffFormat,
  sortShelf,
  titleFromName,
  upsertByFingerprint,
  type ShelfEntry,
} from "./shelf";
import { shelfEntry } from "./test-support";

const encoder = new TextEncoder();

/** A Palm database header with `BOOKMOBI` at the offset a MOBI or AZW3 carries it. */
function bookMobiBytes(): Uint8Array {
  const bytes = new Uint8Array(120);
  bytes.set(encoder.encode("BOOKMOBI"), 60);
  return bytes;
}

/**
 * Removes `crypto.subtle` and returns the undo. The Plugin Worker has a `crypto`
 * without it (a `blob:` Worker is not a secure context); jsdom keeps `subtle` as
 * a getter on the prototype, so removing the own property alone would leave it
 * reachable.
 */
function withoutSubtle(): () => void {
  const crypto = globalThis.crypto as unknown as Record<string, unknown>;
  const prototype = Object.getPrototypeOf(crypto) as Record<string, unknown>;
  const own = Object.getOwnPropertyDescriptor(crypto, "subtle");
  const inherited = Object.getOwnPropertyDescriptor(prototype, "subtle");
  delete crypto.subtle;
  delete prototype.subtle;
  return () => {
    if (own !== undefined) Object.defineProperty(crypto, "subtle", own);
    if (inherited !== undefined) Object.defineProperty(prototype, "subtle", inherited);
  };
}

describe("formatFromName()", () => {
  it("reads every supported extension, case-insensitively, and treats azw as azw3", () => {
    expect(formatFromName("Dune.pdf")).toBe("pdf");
    expect(formatFromName("Dune.EPUB")).toBe("epub");
    expect(formatFromName("Dune.mobi")).toBe("mobi");
    expect(formatFromName("Dune.azw3")).toBe("azw3");
    expect(formatFromName("Dune.azw")).toBe("azw3");
    expect(formatFromName("Dune.fb2")).toBe("fb2");
    expect(formatFromName("Dune.cbz")).toBe("cbz");
  });

  it("returns null for an extension Reader does not open", () => {
    expect(formatFromName("notes.txt")).toBeNull();
    expect(formatFromName("README")).toBeNull();
    expect(formatFromName("trailing.")).toBeNull();
  });
});

describe("titleFromName()", () => {
  it("drops the extension and any folder path", () => {
    expect(titleFromName("Dune Messiah.epub")).toBe("Dune Messiah");
    expect(titleFromName("/books/Dune.pdf")).toBe("Dune");
    expect(titleFromName("no-extension")).toBe("no-extension");
  });
});

describe("sniffFormat()", () => {
  it("recognizes a PDF by its magic bytes whatever the name says", () => {
    expect(sniffFormat(encoder.encode("%PDF-1.7\n"), "Dune.epub")).toBe("pdf");
  });

  it("splits a zip into EPUB and CBZ by name, and refuses any other zip", () => {
    const zip = encoder.encode("PK\x03\x04");
    expect(sniffFormat(zip, "Dune.epub")).toBe("epub");
    expect(sniffFormat(zip, "Dune.cbz")).toBe("cbz");
    expect(sniffFormat(zip, "Dune.pdf")).toBeNull();
  });

  it("reads BOOKMOBI at offset 60 as MOBI or AZW3 by name", () => {
    expect(sniffFormat(bookMobiBytes(), "Dune.azw3")).toBe("azw3");
    expect(sniffFormat(bookMobiBytes(), "Dune.mobi")).toBe("mobi");
    expect(sniffFormat(bookMobiBytes(), "Dune.bin")).toBe("mobi");
  });

  it("recognizes FB2 by its XML prologue or FictionBook root", () => {
    expect(sniffFormat(encoder.encode('<?xml version="1.0"?><FictionBook>'), "book.fb2")).toBe(
      "fb2"
    );
    expect(sniffFormat(encoder.encode("<FictionBook><body/></FictionBook>"), "book.fb2")).toBe(
      "fb2"
    );
  });

  it("falls back to the name when no magic bytes match", () => {
    expect(sniffFormat(encoder.encode("plain"), "Dune.cbz")).toBe("cbz");
    expect(sniffFormat(encoder.encode("plain"), "Dune.txt")).toBeNull();
  });
});

describe("fingerprint()", () => {
  it("is the size, a colon, then a hex SHA-256 over head and tail", async () => {
    const head = encoder.encode("head");
    const tail = encoder.encode("tail");
    const print = await fingerprint(8, head, tail);
    expect(print).toMatch(/^8:[0-9a-f]{64}$/);
  });

  it("is stable for the same bytes and changes when either end changes", async () => {
    const head = encoder.encode("head");
    const tail = encoder.encode("tail");
    const first = await fingerprint(8, head, tail);
    const again = await fingerprint(8, head, tail);
    const changedHead = await fingerprint(8, encoder.encode("HEAD"), tail);
    const changedTail = await fingerprint(8, head, encoder.encode("TAIL"));
    expect(again).toBe(first);
    expect(changedHead).not.toBe(first);
    expect(changedTail).not.toBe(first);
  });

  it("includes the size, so the same bytes with a different size differ", async () => {
    const head = encoder.encode("head");
    const tail = encoder.encode("tail");
    expect(await fingerprint(9, head, tail)).not.toBe(await fingerprint(8, head, tail));
  });

  it("still fingerprints where crypto.subtle is undefined, as in the Plugin Worker", async () => {
    const head = encoder.encode("head");
    const tail = encoder.encode("tail");
    const expected = await fingerprint(8, head, tail);

    const restore = withoutSubtle();
    try {
      expect(globalThis.crypto.subtle).toBeUndefined();
      expect(await fingerprint(8, head, tail)).toBe(expected);
    } finally {
      restore();
    }
    expect(globalThis.crypto.subtle).toBeDefined();
  });
});

describe("sortShelf()", () => {
  it("puts the most recently read Document first", () => {
    const shelf = [
      shelfEntry({ id: "old", grant: "g1", lastReadAt: 100 }),
      shelfEntry({ id: "new", grant: "g2", lastReadAt: 300 }),
      shelfEntry({ id: "middle", grant: "g3", lastReadAt: 200 }),
    ];
    expect(sortShelf(shelf).map((entry) => entry.id)).toEqual(["new", "middle", "old"]);
  });

  it("does not mutate its input", () => {
    const shelf = [
      shelfEntry({ id: "old", grant: "g1", lastReadAt: 100 }),
      shelfEntry({ id: "new", grant: "g2", lastReadAt: 300 }),
    ];
    sortShelf(shelf);
    expect(shelf.map((entry) => entry.id)).toEqual(["old", "new"]);
  });
});

describe("upsertByFingerprint()", () => {
  it("adds a new Fingerprint as its own Document", () => {
    const shelf = [shelfEntry({ id: "one", grant: "g1", fingerprint: "f1", lastReadAt: 100 })];
    const next = upsertByFingerprint(
      shelf,
      shelfEntry({ id: "two", grant: "g2", fingerprint: "f2", lastReadAt: 200 })
    );
    expect(next.map((entry) => entry.id)).toEqual(["two", "one"]);
  });

  it("refreshes the grant and state of an existing Document, keeping id, position, and progress", () => {
    const shelf = [
      shelfEntry({
        id: "one",
        grant: "old-grant",
        fingerprint: "f1",
        state: "missing",
        reason: "gone",
        progress: { page: 34, pageCount: 210 },
        lastReadAt: 100,
      }),
    ];
    const next = upsertByFingerprint(
      shelf,
      shelfEntry({
        id: "two",
        grant: "new-grant",
        fingerprint: "f1",
        state: "ok",
        title: "Other title",
        lastReadAt: 900,
      })
    );
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      id: "one",
      grant: "new-grant",
      state: "ok",
      title: "Dune",
      progress: { page: 34, pageCount: 210 },
    });
    expect(next[0].reason).toBeUndefined();
  });
});

describe("removeEntry()", () => {
  it("forgets one Document and leaves the rest", () => {
    const shelf = [shelfEntry({ id: "one", grant: "g1" }), shelfEntry({ id: "two", grant: "g2" })];
    expect(removeEntry(shelf, "one").map((entry) => entry.id)).toEqual(["two"]);
  });
});

describe("markState()", () => {
  it("marks one Document and keeps a reason only while it is not ok", () => {
    const shelf = [shelfEntry({ id: "one", grant: "g1" })];
    const missing = markState(shelf, "one", "missing", "gone");
    expect(missing[0]).toMatchObject({ state: "missing", reason: "gone" });
    const fixed = markState(missing, "one", "ok");
    expect(fixed[0].state).toBe("ok");
    expect(fixed[0].reason).toBeUndefined();
  });
});

describe("reattach()", () => {
  const shelf = [
    shelfEntry({
      id: "one",
      grant: "old-grant",
      fingerprint: "f1",
      state: "missing",
      reason: "gone",
      progress: { page: 42, pageCount: 210 },
    }),
  ];

  it("reattaches a matching file and keeps the Document's id and Reading Position", () => {
    const result = reattach(shelf, "one", "f1", "new-grant");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry).toMatchObject({
      id: "one",
      grant: "new-grant",
      state: "ok",
      progress: { page: 42, pageCount: 210 },
    });
    expect(result.entry.reason).toBeUndefined();
    expect(result.shelf).toHaveLength(1);
  });

  it("refuses a different file and leaves the Shelf untouched", () => {
    expect(reattach(shelf, "one", "other", "new-grant")).toEqual({
      ok: false,
      reason: "fingerprint-mismatch",
    });
  });

  it("refuses an unknown Document", () => {
    expect(reattach(shelf, "missing", "f1", "new-grant")).toEqual({
      ok: false,
      reason: "not-found",
    });
  });
});

describe("clampSettings()", () => {
  it("defaults a fresh Plugin", () => {
    expect(clampSettings(null)).toEqual(DEFAULT_READER_SETTINGS);
    expect(DEFAULT_READER_SETTINGS).toEqual({
      fontSize: 100,
      lineWidth: "medium",
      pdfFit: "width",
    });
  });

  it("clamps the font size to 60..200 in steps of 10", () => {
    expect(clampSettings({ fontSize: 10 }).fontSize).toBe(60);
    expect(clampSettings({ fontSize: 1000 }).fontSize).toBe(200);
    expect(clampSettings({ fontSize: 137 }).fontSize).toBe(140);
    expect(clampSettings({ fontSize: "garbage" }).fontSize).toBe(100);
  });

  it("falls back for an unknown line width or PDF fit", () => {
    const settings = clampSettings({ lineWidth: "huge", pdfFit: "diagonal" });
    expect(settings.lineWidth).toBe("medium");
    expect(settings.pdfFit).toBe("width");
    expect(clampSettings({ lineWidth: "wide", pdfFit: "page" })).toMatchObject({
      lineWidth: "wide",
      pdfFit: "page",
    });
  });
});

describe("progressSummary()", () => {
  it("prefers a page out of its count, then a whole percentage", () => {
    expect(progressSummary({ page: 34, pageCount: 210, fraction: 0.2 })).toEqual({
      kind: "page",
      page: 34,
      pageCount: 210,
    });
    expect(progressSummary({ fraction: 0.423 })).toEqual({ kind: "percent", percent: 42 });
    expect(progressSummary({})).toBeNull();
    expect(progressSummary(null)).toBeNull();
  });
});

describe("relativeTimestamp()", () => {
  const now = Date.UTC(2026, 0, 20, 12);

  it("names a relative time in the language it is given", () => {
    expect(relativeTimestamp("en", now, now)).toBe("now");
    expect(relativeTimestamp("es", now, now)).toBe("ahora");
    expect(relativeTimestamp("en", now - 3 * 24 * 60 * 60 * 1000, now)).toBe("3 days ago");
    expect(relativeTimestamp("es", now - 3 * 24 * 60 * 60 * 1000, now)).toBe("hace 3 días");
  });
});

describe("parseShelf()", () => {
  it("reads a stored Shelf and drops rows Reader cannot draw", () => {
    const valid: ShelfEntry = shelfEntry({ id: "one", grant: "g1", format: "epub" });
    const parsed = parseShelf([valid, { id: "bad" }, "nope", null]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ id: "one", format: "epub" });
  });

  it("reads nothing from a malformed value", () => {
    expect(parseShelf("not a shelf")).toEqual([]);
    expect(parseShelf(null)).toEqual([]);
  });
});

describe("storage keys", () => {
  it("keeps one Position key per Document", () => {
    expect(positionKey("doc-1")).toBe("position:doc-1");
  });
});
