import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseAdapter } from "@/lib/platform/types";
import { assignHeadingIds } from "@/features/links/heading-ids";
import { createTestDatabase } from "../../../support/db-test-context";

let testDb: DatabaseAdapter;
const { mockGetDatabase } = vi.hoisted(() => ({ mockGetDatabase: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDatabase: mockGetDatabase }));

const { clearLinkPreviewCache, extractHeadingPreview, extractSnippet, loadLinkPreview } =
  await import("@/features/links/link-preview");
const { emitChange } = await import("@/features/sync/change-feed");

const now = Math.floor(Date.now() / 1000);

async function seed(db: DatabaseAdapter) {
  await db.execute(
    `INSERT INTO books (id, title, author_name, description, cover_image_path, created_at, updated_at)
     VALUES ('b1', 'The Long Road', 'Ana Ruiz', 'A <em>journey</em> north.', 'data:image/png;base64,AAAA', ?, ?)`,
    [now, now]
  );
  await db.execute(
    `INSERT INTO books (id, title, author_name, created_at, updated_at) VALUES ('b2', 'Bare', 'Lu', ?, ?)`,
    [now, now]
  );
  await db.execute(
    `INSERT INTO chapters (id, book_id, title, content, "order", created_at, updated_at)
     VALUES ('c1', 'b1', 'Departure', '<p>They left at <strong>dawn</strong>.</p><h2 id="h-river">The river</h2><p>Cold water.</p>', 0, ?, ?)`,
    [now, now]
  );
  await db.execute(
    `INSERT INTO notes (id, title, content, "order", created_at, updated_at)
     VALUES ('n1', 'Ideas', '<p>Maybe a <em>storm</em>.</p><h1 id="h-cast">Cast</h1><p>Ana, Lu.</p>', 0, ?, ?)`,
    [now, now]
  );
}

describe("loadLinkPreview()", () => {
  beforeEach(async () => {
    clearLinkPreviewCache();
    testDb = await createTestDatabase();
    mockGetDatabase.mockResolvedValue(testDb);
    await seed(testDb);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("previews a Note by its title and opening text", async () => {
    expect(await loadLinkPreview("maibuk://note/n1")).toEqual({
      kind: "note",
      title: "Ideas",
      snippet: {
        html: "<p>Maybe a <em>storm</em>.</p><p><strong>Cast</strong></p><p>Ana, Lu.</p>",
        truncated: false,
      },
    });
  });

  it("previews a Chapter under its Book", async () => {
    expect(await loadLinkPreview("maibuk://chapter/c1")).toEqual({
      kind: "chapter",
      bookTitle: "The Long Road",
      chapterTitle: "Departure",
      snippet: {
        html: "<p>They left at <strong>dawn</strong>.</p><p><strong>The river</strong></p><p>Cold water.</p>",
        truncated: false,
      },
    });
  });

  it("previews a heading in a Chapter with the text under it", async () => {
    expect(await loadLinkPreview("maibuk://heading/c1/h-river")).toEqual({
      kind: "heading",
      bookTitle: "The Long Road",
      chapterTitle: "Departure",
      heading: {
        text: "The river",
        snippet: { html: "<p>Cold water.</p>", truncated: false },
      },
    });
  });

  it("previews a heading in a Note with the text under it", async () => {
    expect(await loadLinkPreview("maibuk://note-heading/n1/h-cast")).toEqual({
      kind: "noteHeading",
      noteTitle: "Ideas",
      heading: {
        text: "Cast",
        snippet: { html: "<p>Ana, Lu.</p>", truncated: false },
      },
    });
  });

  it("keeps the Chapter or Note breadcrumb when its heading is gone", async () => {
    expect(await loadLinkPreview("maibuk://heading/c1/h-gone")).toEqual({
      kind: "heading",
      bookTitle: "The Long Road",
      chapterTitle: "Departure",
      heading: null,
    });
    expect(await loadLinkPreview("maibuk://note-heading/n1/h-gone")).toEqual({
      kind: "noteHeading",
      noteTitle: "Ideas",
      heading: null,
    });
  });

  it("previews a Book by its title, author, description, and cover", async () => {
    expect(await loadLinkPreview("maibuk://book/b1")).toEqual({
      kind: "book",
      bookId: "b1",
      title: "The Long Road",
      author: "Ana Ruiz",
      description: "A journey north.",
      coverSrc: "data:image/png;base64,AAAA",
    });
    expect(await loadLinkPreview("maibuk://book/b2")).toEqual({
      kind: "book",
      bookId: "b2",
      title: "Bare",
      author: "Lu",
      description: null,
      coverSrc: null,
    });
  });

  it("says when the target no longer exists", async () => {
    for (const href of [
      "maibuk://note/gone",
      "maibuk://book/gone",
      "maibuk://chapter/gone",
      "maibuk://heading/gone/h-river",
      "maibuk://note-heading/gone/h-cast",
    ]) {
      expect(await loadLinkPreview(href)).toEqual({ kind: "missing" });
    }
  });

  it("says when the Library cannot be read", async () => {
    mockGetDatabase.mockRejectedValueOnce(new Error("locked"));
    expect(await loadLinkPreview("maibuk://note/n1")).toEqual({ kind: "error" });
  });

  it("shows a web address by its scheme without reading the Library", async () => {
    mockGetDatabase.mockClear();
    expect(await loadLinkPreview("https://www.example.com/a/b?c=1")).toEqual({
      kind: "web",
      scheme: "web",
      href: "https://www.example.com/a/b?c=1",
      host: "www.example.com",
    });
    expect(await loadLinkPreview("mailto:ana@example.com")).toEqual({
      kind: "web",
      scheme: "mail",
      href: "mailto:ana@example.com",
      host: null,
    });
    expect(await loadLinkPreview("tel:+5355555555")).toEqual({
      kind: "web",
      scheme: "other",
      href: "tel:+5355555555",
      host: null,
    });
    expect(await loadLinkPreview("maibuk://nonsense")).toEqual({
      kind: "web",
      scheme: "other",
      href: "maibuk://nonsense",
      host: null,
    });
    expect(mockGetDatabase).not.toHaveBeenCalled();
  });

  describe("cache", () => {
    async function renameNote(title: string) {
      await testDb.execute("UPDATE notes SET title = ? WHERE id = 'n1'", [title]);
    }

    it("reads the Library once for repeated previews of one Link", async () => {
      await loadLinkPreview("maibuk://note/n1");
      await renameNote("Renamed");
      expect(await loadLinkPreview("maibuk://note/n1")).toMatchObject({ title: "Ideas" });
    });

    it("reads again after any saved Change", async () => {
      await loadLinkPreview("maibuk://note/n1");
      await renameNote("Renamed");
      await emitChange({ entity: "book", id: "b2", origin: "remote", kind: "metadata" });
      expect(await loadLinkPreview("maibuk://note/n1")).toMatchObject({ title: "Renamed" });
    });

    it("reads again after the cache is cleared", async () => {
      await loadLinkPreview("maibuk://note/n1");
      await renameNote("Renamed");
      clearLinkPreviewCache();
      expect(await loadLinkPreview("maibuk://note/n1")).toMatchObject({ title: "Renamed" });
    });

    it("reads again once a preview is older than 30 seconds", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      await loadLinkPreview("maibuk://note/n1");
      await renameNote("Renamed");
      vi.setSystemTime(Date.now() + 29_000);
      expect(await loadLinkPreview("maibuk://note/n1")).toMatchObject({ title: "Ideas" });
      vi.setSystemTime(Date.now() + 2_000);
      expect(await loadLinkPreview("maibuk://note/n1")).toMatchObject({ title: "Renamed" });
    });

    it("never keeps a failed read", async () => {
      mockGetDatabase.mockRejectedValueOnce(new Error("locked"));
      expect(await loadLinkPreview("maibuk://note/n1")).toEqual({ kind: "error" });
      expect(await loadLinkPreview("maibuk://note/n1")).toMatchObject({ kind: "note" });
    });
  });
});

describe("extractSnippet()", () => {
  it("keeps the formatting of a short text from its start", () => {
    expect(extractSnippet("<p>Hello <strong>bold</strong> and <em>soft</em>.</p>")).toEqual({
      html: "<p>Hello <strong>bold</strong> and <em>soft</em>.</p>",
      truncated: false,
    });
  });

  it("cuts a long text on a word boundary inside its formatting", () => {
    expect(
      extractSnippet("<p>One two <em>three four</em> five</p><p>Next paragraph</p>", {
        maxChars: 15,
      })
    ).toEqual({ html: "<p>One two <em>three…</em></p>", truncated: true });
  });

  it("drops images and footnote markers, and keeps Links as text that cannot be followed", () => {
    const html =
      '<p>See <a href="maibuk://note/n1" class="editor-link">this</a>' +
      '<sup data-footnote="" data-footnote-id="f1" data-footnote-content="aside">*</sup> now.</p>' +
      '<figure data-image=""><img src="cover.png" alt="A cover"><figcaption>Caption</figcaption></figure>' +
      '<div data-scene-break="" class="scene-break" data-kind="image"><img src="flourish.png" alt=""></div>';
    expect(extractSnippet(html)).toEqual({
      html:
        '<p>See <span class="link-preview-link">this</span> now.</p>' +
        '<div data-scene-break="" class="scene-break"><span class="scene-break-symbols">* * *</span></div>',
      truncated: false,
    });
  });

  it("shows a heading inside the text as a bold line without its id", () => {
    expect(extractSnippet('<p>Intro</p><h2 id="h-1">Part <em>two</em></h2><p>Body</p>')).toEqual({
      html: "<p>Intro</p><p><strong>Part <em>two</em></strong></p><p>Body</p>",
      truncated: false,
    });
  });

  it("removes anything that could run", () => {
    expect(
      extractSnippet(
        '<p onclick="steal()">Safe<script>steal()</script><img src=x onerror="steal()"></p>'
      )
    ).toEqual({ html: "<p>Safe</p>", truncated: false });
  });

  describe("under a heading", () => {
    const html =
      '<p>Before</p><h2 id="h-a">A</h2><p>Under <em>A</em></p>' +
      '<h3 id="h-b">B</h3><p>Under B</p><h1 id="h-c">C</h1>';

    it("starts after the heading and stops at the next one", () => {
      expect(extractHeadingPreview(html, "h-a")).toEqual({
        text: "A",
        snippet: { html: "<p>Under <em>A</em></p>", truncated: false },
      });
      expect(extractHeadingPreview(html, "h-b")).toEqual({
        text: "B",
        snippet: { html: "<p>Under B</p>", truncated: false },
      });
    });

    it("is empty under a heading with nothing after it", () => {
      expect(extractHeadingPreview(html, "h-c")).toEqual({
        text: "C",
        snippet: { html: "", truncated: false },
      });
    });

    it("finds a heading stored without an id by the id the link picker gives it", () => {
      const idless = "<h2>Start</h2><p>One</p><h2>Start</h2><p>Two</p>";
      const second = assignHeadingIds(idless).headings[1].id;
      expect(extractHeadingPreview(idless, second)).toEqual({
        text: "Start",
        snippet: { html: "<p>Two</p>", truncated: false },
      });
    });

    it("is not fooled by another attribute ending in the same id", () => {
      const tricky = '<h2 data-id="h-x">Wrong</h2><p>No</p><h2 id="h-x">Right</h2><p>Yes</p>';
      expect(extractHeadingPreview(tricky, "h-x")).toEqual({
        text: "Right",
        snippet: { html: "<p>Yes</p>", truncated: false },
      });
    });

    it("is null when the heading is gone", () => {
      expect(extractHeadingPreview(html, "h-gone")).toBeNull();
    });
  });

  describe("in a long text", () => {
    const paragraph = (n: number) =>
      `<p>Paragraph ${n} <strong>with</strong> words &amp; marks.</p>`;
    const long = Array.from({ length: 3000 }, (_, n) => paragraph(n)).join("");

    it("reads a heading near the end", () => {
      const html = `${long}<h2 id="h-end">End</h2><p>Last words.</p>${long}`;
      expect(extractHeadingPreview(html, "h-end", { maxChars: 40 })).toEqual({
        text: "End",
        snippet: {
          html: "<p>Last words.</p><p>Paragraph 0 <strong>with</strong> words &amp;…</p>",
          truncated: true,
        },
      });
    });

    it("cuts the start of a long text with tags balanced", () => {
      expect(extractSnippet(long, { maxChars: 60 })).toEqual({
        html:
          "<p>Paragraph 0 <strong>with</strong> words &amp; marks.</p>" +
          "<p>Paragraph 1 <strong>with</strong> words &amp;…</p>",
        truncated: true,
      });
    });
  });
});
