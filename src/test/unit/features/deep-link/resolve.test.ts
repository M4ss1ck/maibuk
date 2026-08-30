import { describe, expect, it, vi, beforeEach } from "vitest";
import type { DatabaseAdapter } from "@/lib/platform/types";
import { createTestDatabase } from "../../../support/db-test-context";

let testDb: DatabaseAdapter;
const { mockGetDatabase } = vi.hoisted(() => ({ mockGetDatabase: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDatabase: mockGetDatabase }));

// Import after mock
const { selectFirstValidUrl, resolveBatch } = await import("@/features/deep-link/resolve");
const { resolveParsedLink } = await import("@/features/links/resolve-target");

describe("deep-link resolve", () => {
  beforeEach(async () => {
    testDb = await createTestDatabase();
    mockGetDatabase.mockResolvedValue(testDb);
    // seed books/chapters/notes
    const now = Math.floor(Date.now() / 1000);
    await testDb.execute(
      `INSERT INTO books (id, title, author_name, created_at, updated_at) VALUES ('b1','Book One','Author',?,?)`,
      [now, now]
    );
    await testDb.execute(
      `INSERT INTO books (id, title, author_name, created_at, updated_at) VALUES ('b2','Book Two','Author',?,?)`,
      [now, now]
    );
    await testDb.execute(
      `INSERT INTO chapters (id, book_id, title, content, "order", created_at, updated_at) VALUES ('c1','b1','Ch One','<h1 id="h-1">Sec</h1><p>body</p>',0,?,?)`,
      [now, now]
    );
    await testDb.execute(
      `INSERT INTO chapters (id, book_id, title, content, "order", created_at, updated_at) VALUES ('c2','b1','Ch Two','<p>no heading</p>',1,?,?)`,
      [now, now]
    );
    await testDb.execute(
      `INSERT INTO notes (id, title, content, "order", created_at, updated_at) VALUES ('n1','Note One','<h1 id="h-note">Note Sec</h1>',0,?,?)`,
      [now, now]
    );
    await testDb.execute(
      `INSERT INTO notes (id, title, content, "order", created_at, updated_at) VALUES ('n2','Note Two','<p>plain</p>',1,?,?)`,
      [now, now]
    );
  });

  describe("selectFirstValidUrl", () => {
    it("scans in order and picks first valid", () => {
      expect(selectFirstValidUrl(["bad", "maibuk://note/n1", "maibuk://book/b1"])).toEqual({
        targetType: "note",
        targetId: "n1",
      });
    });

    it("returns null for all malformed/empty", () => {
      expect(selectFirstValidUrl(["bad", "maibuk://note//n1", ""])).toBeNull();
      expect(selectFirstValidUrl([])).toBeNull();
      expect(selectFirstValidUrl(null)).toBeNull();
    });

    it("stops at first valid even if later valid", () => {
      const first = selectFirstValidUrl(["maibuk://note/n1", "maibuk://book/b1"]);
      expect(first?.targetId).toBe("n1");
    });

    it("skips leading malformed but picks valid later", () => {
      expect(selectFirstValidUrl(["maibuk://note/n1/", "maibuk://book/b1"])).toEqual({
        targetType: "book",
        targetId: "b1",
      });
    });

    it("parses canonical chapter and heading forms", () => {
      expect(selectFirstValidUrl(["maibuk://chapter/c1"])).toEqual({
        targetType: "chapter",
        targetId: "c1",
      });
      expect(selectFirstValidUrl(["maibuk://heading/c1/h-1"])).toEqual({
        targetType: "heading",
        targetId: "c1",
        headingId: "h-1",
      });
      expect(selectFirstValidUrl(["maibuk://note-heading/n1/h-note"])).toEqual({
        targetType: "noteHeading",
        targetId: "n1",
        headingId: "h-note",
      });
    });

    it("rejects staged book/chapter forms", () => {
      expect(selectFirstValidUrl(["maibuk://book/b1/chapter/c1"])).toBeNull();
      expect(selectFirstValidUrl(["maibuk://book/b1/chapter/c1/heading/h-1"])).toBeNull();
      expect(selectFirstValidUrl(["maibuk://note/n1/heading/h-1"])).toBeNull();
    });
  });

  describe("resolveBatch - staleness does not continue to later URLs", () => {
    it("stale valid URL stops scanning, fallback applied", async () => {
      // n-missing is first valid but missing -> should fallback to /notes, not pick next valid book
      const outcome = await resolveBatch(["maibuk://note/missing", "maibuk://book/b1"]);
      expect(outcome).toEqual({
        to: "/notes",
        toastKey: "deepLink.resourceGone",
      });
    });

    it("malformed batch does not navigate", async () => {
      expect(await resolveBatch(["bad", "maibuk://note//n1"])).toBeNull();
      expect(await resolveBatch([])).toBeNull();
    });
  });

  describe("fallbacks", () => {
    it("missing note -> /notes + resourceGone", async () => {
      const o = await resolveBatch(["maibuk://note/missing"]);
      expect(o).toEqual({ to: "/notes", toastKey: "deepLink.resourceGone" });
    });

    it("missing book -> / + resourceGone", async () => {
      const o = await resolveBatch(["maibuk://book/missing"]);
      expect(o).toEqual({ to: "/", toastKey: "deepLink.resourceGone" });
    });

    it("missing chapter -> / + resourceGone", async () => {
      const o = await resolveBatch(["maibuk://chapter/missing"]);
      expect(o).toEqual({ to: "/", toastKey: "deepLink.resourceGone" });
    });

    it("existing note but missing heading -> note without scroll + headingGone", async () => {
      const o = await resolveBatch(["maibuk://note-heading/n1/h-missing"]);
      expect(o).toEqual({
        to: "/notes/n1",
        toastKey: "deepLink.headingGone",
      });
    });

    it("existing chapter but missing heading -> book with openChapterId no scroll + headingGone", async () => {
      const o = await resolveBatch(["maibuk://heading/c1/h-missing"]);
      expect(o).toEqual({
        to: "/book/b1",
        state: { openChapterId: "c1" },
        toastKey: "deepLink.headingGone",
      });
    });

    it("existing note heading valid -> note with scroll", async () => {
      const o = await resolveBatch(["maibuk://note-heading/n1/h-note"]);
      expect(o).toEqual({
        to: "/notes/n1",
        state: { scrollToHeadingId: "h-note" },
      });
    });

    it("heading with chapter missing heading -> fallback to chapter open", async () => {
      // c2 has no h-1
      const o = await resolveBatch(["maibuk://heading/c2/h-1"]);
      expect(o?.to).toBe("/book/b1");
      if (o && o.to) {
        expect(o.to).toBe("/book/b1");
        expect(o.state).toEqual({ openChapterId: "c2" });
        expect(o.toastKey).toBe("deepLink.headingGone");
      }
    });

    it("valid chapter heading -> book with openChapterId + scroll", async () => {
      const o = await resolveBatch(["maibuk://heading/c1/h-1"]);
      expect(o).toEqual({
        to: "/book/b1",
        state: { openChapterId: "c1", scrollToHeadingId: "h-1" },
      });
    });

    it("valid note -> /notes/:id", async () => {
      expect(await resolveBatch(["maibuk://note/n1"])).toEqual({
        to: "/notes/n1",
      });
    });

    it("valid book -> /book/:id", async () => {
      expect(await resolveBatch(["maibuk://book/b1"])).toEqual({
        to: "/book/b1",
      });
    });

    it("valid chapter -> /book/:bookId with openChapterId", async () => {
      expect(await resolveBatch(["maibuk://chapter/c1"])).toEqual({
        to: "/book/b1",
        state: { openChapterId: "c1" },
      });
    });

    it("encoded heading id round-trips", async () => {
      const tricky = "a/b c";
      const now = Math.floor(Date.now() / 1000);
      // c1 already has h-1, add a chapter with tricky heading
      await testDb.execute(
        `INSERT INTO chapters (id, book_id, title, content, "order", created_at, updated_at) VALUES ('c3','b1','Ch Three','<h1 id="${tricky}">T</h1>',2,?,?)`,
        [now, now]
      );
      const o = await resolveBatch([`maibuk://heading/c3/${encodeURIComponent(tricky)}`]);
      expect(o).toEqual({
        to: "/book/b1",
        state: { openChapterId: "c3", scrollToHeadingId: tricky },
      });
    });

    it("chapter without book ownership check still resolves via book_id row", async () => {
      // c1 belongs to b1, but URI no longer carries bookId, so no ownership rejection
      const o = await resolveBatch(["maibuk://chapter/c1"]);
      expect(o).toEqual({
        to: "/book/b1",
        state: { openChapterId: "c1" },
      });
    });
  });

  describe("lookup failure", () => {
    it("database error -> no navigation, genericError toast", async () => {
      mockGetDatabase.mockRejectedValue(new Error("db fail"));
      const o = await resolveBatch(["maibuk://note/n1"]);
      expect(o).toEqual({ to: null, toastKey: "deepLink.genericError" });
    });

    it("resolveParsedLink directly also returns error on db failure", async () => {
      mockGetDatabase.mockRejectedValue(new Error("boom"));
      const o = await resolveParsedLink({ targetType: "book", targetId: "b1" });
      expect(o).toEqual({ to: null, toastKey: "deepLink.genericError" });
    });
  });
});
