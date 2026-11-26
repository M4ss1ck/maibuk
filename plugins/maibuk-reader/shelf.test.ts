/**
 * The Shelf's pure rules (#653): format sniffing, the Fingerprint, ordering,
 * the upsert that keeps one Document from becoming two, removal, state changes,
 * reattaching a located file, and the Reader settings bounds.
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_READER_SETTINGS,
  DEFAULT_SHELF_VIEW,
  FINGERPRINT_WINDOW,
  SHELF_VIEW_KEY,
  clampSettings,
  clampShelfView,
  collectionName,
  defaultDescending,
  parseCollections,
  sameCollectionName,
  fingerprint,
  formatFromName,
  markState,
  parseShelf,
  positionKey,
  progressFraction,
  progressSummary,
  reattach,
  removeEntry,
  shelfStatus,
  sniffFormat,
  sortShelf,
  titleFromName,
  upsertByFingerprint,
  withProgress,
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

  // Hashing both 64 KB windows in one go could hold a slow device's Plugin
  // Worker past the host's one-second heartbeat.
  it("yields to the event loop between blocks, so the Worker still answers the heartbeat", async () => {
    const head = new Uint8Array(FINGERPRINT_WINDOW).fill(1);
    const tail = new Uint8Array(FINGERPRINT_WINDOW).fill(2);
    const expected = createHash("sha256").update(head).update(tail).digest("hex");
    let turns = 0;
    const tick = () => {
      turns += 1;
      if (turns < 100) setTimeout(tick, 0);
    };
    setTimeout(tick, 0);
    const print = await fingerprint(FINGERPRINT_WINDOW * 4, head, tail);
    expect(print).toBe(`${FINGERPRINT_WINDOW * 4}:${expected}`);
    expect(turns).toBeGreaterThanOrEqual(4);
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
      pdfLayout: "single",
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

  it("keeps a known PDF layout and falls back to one page at a time", () => {
    expect(clampSettings({ pdfLayout: "continuous" }).pdfLayout).toBe("continuous");
    expect(clampSettings({ pdfLayout: "spread" }).pdfLayout).toBe("single");
    expect(clampSettings({}).pdfLayout).toBe("single");
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

  it("keeps a stored addedAt and finishedAt", () => {
    const [entry] = parseShelf([
      {
        id: "one",
        grant: "g1",
        fingerprint: "f1",
        title: "Dune",
        format: "epub",
        lastReadAt: 2_000,
        addedAt: 500,
        finishedAt: 1_500,
        progress: null,
      },
    ]);
    expect(entry.addedAt).toBe(500);
    expect(entry.finishedAt).toBe(1_500);
  });

  it("falls back to lastReadAt for addedAt when the stored value is missing or not a number", () => {
    const base = { grant: "g1", fingerprint: "f1", title: "Dune", format: "epub", progress: null };
    const [missing, notNumber] = parseShelf([
      { ...base, id: "missing", lastReadAt: 2_000 },
      { ...base, id: "text", lastReadAt: 2_000, addedAt: "yesterday" },
    ]);
    expect(missing.addedAt).toBe(2_000);
    expect(notNumber.addedAt).toBe(2_000);
  });

  it("leaves finishedAt unset when none is stored", () => {
    const [entry] = parseShelf([
      {
        id: "one",
        grant: "g1",
        fingerprint: "f1",
        title: "Dune",
        format: "epub",
        lastReadAt: 2_000,
        progress: null,
      },
    ]);
    expect(entry.finishedAt).toBeUndefined();
  });
});

describe("progressFraction()", () => {
  it("is zero with no progress", () => {
    expect(progressFraction(null)).toBe(0);
  });

  it("prefers a page out of its count, clamped to 0..1", () => {
    expect(progressFraction({ page: 3, pageCount: 12, fraction: 0.9 })).toBe(0.25);
    expect(progressFraction({ page: 20, pageCount: 12 })).toBe(1);
  });

  it("falls back to a finite fraction, clamped to 0..1", () => {
    expect(progressFraction({ fraction: 0.5 })).toBe(0.5);
    expect(progressFraction({ fraction: -1 })).toBe(0);
    expect(progressFraction({ fraction: 3 })).toBe(1);
  });

  it("uses the fraction when the page count is zero", () => {
    expect(progressFraction({ page: 0, pageCount: 0, fraction: 0.5 })).toBe(0.5);
  });

  it("is zero when the progress has neither a page count nor a fraction", () => {
    expect(progressFraction({ page: 4 })).toBe(0);
  });
});

describe("parseShelf() openedAt", () => {
  it("keeps a stored openedAt and drops a malformed one", () => {
    const base = { id: "a", grant: "g", fingerprint: "f", title: "T", format: "pdf" };
    expect(parseShelf([{ ...base, openedAt: 7 }])[0].openedAt).toBe(7);
    expect(parseShelf([{ ...base, openedAt: "x" }])[0]).not.toHaveProperty("openedAt");
  });
});

describe("shelfStatus()", () => {
  it("is new when the Document was never opened", () => {
    expect(shelfStatus({ progress: null })).toBe("new");
  });

  it("is reading once opened, before any position is saved", () => {
    expect(shelfStatus({ progress: null, openedAt: 5 })).toBe("reading");
  });

  it("is reading below 99%", () => {
    expect(shelfStatus({ progress: { fraction: 0.5 } })).toBe("reading");
    expect(shelfStatus({ progress: { fraction: 0.989 } })).toBe("reading");
    expect(shelfStatus({ progress: { page: 3, pageCount: 12 } })).toBe("reading");
  });

  it("is finished at 99% or more, and on the last page", () => {
    expect(shelfStatus({ progress: { fraction: 0.99 } })).toBe("finished");
    expect(shelfStatus({ progress: { page: 12, pageCount: 12 } })).toBe("finished");
  });
});

describe("withProgress()", () => {
  const reading = shelfEntry({ id: "one", grant: "g1", lastReadAt: 1_000, addedAt: 500 });
  const last = { page: 12, pageCount: 12 };
  const middle = { page: 3, pageCount: 12 };

  it("stores the progress and stamps lastReadAt with now", () => {
    const next = withProgress(reading, middle, 5_000);
    expect(next.progress).toEqual(middle);
    expect(next.lastReadAt).toBe(5_000);
  });

  it("leaves finishedAt unset while the Document is not finished", () => {
    expect(withProgress(reading, middle, 5_000).finishedAt).toBeUndefined();
  });

  it("sets finishedAt the first time the author reaches the last page", () => {
    expect(withProgress(reading, last, 5_000).finishedAt).toBe(5_000);
  });

  it("keeps the first finishedAt when the Document finishes again", () => {
    const first = withProgress(reading, last, 5_000);
    expect(withProgress(first, last, 9_000).finishedAt).toBe(5_000);
  });

  it("keeps finishedAt after progress drops back below the threshold", () => {
    const first = withProgress(reading, last, 5_000);
    const back = withProgress(first, middle, 9_000);
    expect(back.progress).toEqual(middle);
    expect(back.lastReadAt).toBe(9_000);
    expect(back.finishedAt).toBe(5_000);
  });
});

describe("defaultDescending()", () => {
  it("sorts the newest, most read, and largest first for recent, progress, and added", () => {
    expect(defaultDescending("recent")).toBe(true);
    expect(defaultDescending("progress")).toBe(true);
    expect(defaultDescending("added")).toBe(true);
  });

  it("sorts A to Z first for title and author", () => {
    expect(defaultDescending("title")).toBe(false);
    expect(defaultDescending("author")).toBe(false);
  });
});

describe("clampShelfView()", () => {
  it("returns the default view for anything that is not a record", () => {
    expect(clampShelfView("nope")).toEqual(DEFAULT_SHELF_VIEW);
    expect(clampShelfView(null)).toEqual(DEFAULT_SHELF_VIEW);
    expect(clampShelfView(["list"])).toEqual(DEFAULT_SHELF_VIEW);
  });

  it("round-trips a full valid view", () => {
    const view = {
      layout: "list",
      coverSize: "large",
      sort: "title",
      descending: false,
      formats: ["pdf", "epub"],
      statuses: ["reading"],
      search: "dune",
      collection: "col-a",
    };
    expect(clampShelfView(view)).toEqual(view);
  });

  it("falls back to the default sort and its direction for an unknown sort", () => {
    expect(clampShelfView({ sort: "bogus" })).toMatchObject({ sort: "recent", descending: true });
    expect(clampShelfView({ sort: "bogus", descending: false })).toMatchObject({
      sort: "recent",
      descending: false,
    });
  });

  it("takes the direction from the sort when descending is not stored", () => {
    expect(clampShelfView({ sort: "title" }).descending).toBe(false);
    expect(clampShelfView({ sort: "added" }).descending).toBe(true);
  });

  it("keeps only valid formats, unique, in canonical order", () => {
    expect(clampShelfView({ formats: ["cbz", "docx", "pdf", "cbz", "epub"] }).formats).toEqual([
      "pdf",
      "epub",
      "cbz",
    ]);
  });

  it("reads formats as empty when the stored value is not an array", () => {
    expect(clampShelfView({ formats: "pdf" }).formats).toEqual([]);
  });

  it("keeps only valid statuses, unique, in the order new, reading, finished", () => {
    expect(
      clampShelfView({ statuses: ["finished", "new", "finished", "bogus", "reading"] }).statuses
    ).toEqual(["new", "reading", "finished"]);
  });

  it("cuts the search to 200 characters and reads a non-string search as empty", () => {
    expect(clampShelfView({ search: "x".repeat(250) }).search).toHaveLength(200);
    expect(clampShelfView({ search: 42 }).search).toBe("");
  });

  it("never returns the default view's arrays", () => {
    const view = clampShelfView({});
    expect(view.formats).not.toBe(DEFAULT_SHELF_VIEW.formats);
    expect(view.statuses).not.toBe(DEFAULT_SHELF_VIEW.statuses);
    view.formats.push("pdf");
    expect(DEFAULT_SHELF_VIEW.formats).toEqual([]);
  });
});

describe("shelf view key", () => {
  it("keeps the remembered view under one key", () => {
    expect(SHELF_VIEW_KEY).toBe("shelfView");
  });
});

describe("storage keys", () => {
  it("keeps one Position key per Document", () => {
    expect(positionKey("doc-1")).toBe("position:doc-1");
  });
});

describe("clampShelfView() collection", () => {
  it("defaults to every Document, with no Collection", () => {
    expect(DEFAULT_SHELF_VIEW.collection).toBeNull();
    expect(clampShelfView({}).collection).toBeNull();
    expect(clampShelfView(null).collection).toBeNull();
  });

  it("keeps a Collection id that is a string of 1 to 200 characters", () => {
    expect(clampShelfView({ collection: "col-a" }).collection).toBe("col-a");
    expect(clampShelfView({ collection: "c".repeat(200) }).collection).toHaveLength(200);
  });

  it("reads a non-string, empty, or 201-character Collection as null", () => {
    expect(clampShelfView({ collection: 42 }).collection).toBeNull();
    expect(clampShelfView({ collection: "" }).collection).toBeNull();
    expect(clampShelfView({ collection: "c".repeat(201) }).collection).toBeNull();
  });
});

describe("collectionName()", () => {
  it("trims the name", () => {
    expect(collectionName("  Summer reads \n")).toBe("Summer reads");
  });

  it("cuts the name to 100 characters, counting code points", () => {
    const cut = collectionName(`${"x".repeat(98)}😀😀`);
    expect(Array.from(cut)).toHaveLength(100);
    expect(cut.endsWith("😀")).toBe(true);
  });

  it("trims again after the cut", () => {
    expect(collectionName(`${"a".repeat(99)} b`)).toBe("a".repeat(99));
  });

  it("reads a blank name as empty", () => {
    expect(collectionName("   ")).toBe("");
  });
});

describe("sameCollectionName()", () => {
  it("matches names that differ only in case and surrounding spaces", () => {
    expect(sameCollectionName(" Dune ", "dune")).toBe(true);
  });

  it("does not match different names", () => {
    expect(sameCollectionName("Dune", "Dune Messiah")).toBe(false);
  });
});

describe("parseCollections()", () => {
  it("reads anything that is not an array as no Collections", () => {
    expect(parseCollections("nope")).toEqual([]);
    expect(parseCollections({ id: "col-a" })).toEqual([]);
    expect(parseCollections(null)).toEqual([]);
  });

  it("keeps the first record for a repeated id, in creation order", () => {
    expect(
      parseCollections([
        { id: "col-b", name: "Emma", documentIds: [] },
        { id: "col-a", name: "Dune", documentIds: [] },
        { id: "col-b", name: "Again", documentIds: ["doc-1"] },
      ])
    ).toEqual([
      { id: "col-b", name: "Emma", documentIds: [] },
      { id: "col-a", name: "Dune", documentIds: [] },
    ]);
  });

  it("stores the name normalized and keeps string documentIds once each, in order", () => {
    expect(
      parseCollections([
        { id: "col-a", name: "  Dune  ", documentIds: ["doc-2", 5, "doc-1", "doc-2"] },
      ])
    ).toEqual([{ id: "col-a", name: "Dune", documentIds: ["doc-2", "doc-1"] }]);
  });

  it("gives a missing documentIds as an empty list", () => {
    expect(parseCollections([{ id: "col-a", name: "Dune" }])).toEqual([
      { id: "col-a", name: "Dune", documentIds: [] },
    ]);
  });
});
