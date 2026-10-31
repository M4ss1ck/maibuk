import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseAdapter } from "@/lib/platform/types";
import { createTestDatabase } from "@/test/support/db-test-context";
import {
  isEntityChange,
  onChange,
  resetChangeFeedForTests,
  type Change,
} from "@/features/sync/change-feed";
import {
  registerPendingEditsFlush,
  resetPendingEditsForTests,
} from "@/features/sync/pending-edits";
import { PluginApiError } from "@/plugin-sdk/protocol";

const { mockGetDatabase } = vi.hoisted(() => ({ mockGetDatabase: vi.fn() }));

vi.mock("@/lib/db", () => ({ getDatabase: mockGetDatabase }));

const {
  createPluginNote,
  fragmentToHtml,
  getPluginChapter,
  getPluginNote,
  updatePluginChapterContent,
  updatePluginNote,
} = await import("@/features/plugins/library");

describe("Plugin Library writes", () => {
  let testDb: DatabaseAdapter;
  let changes: Change[];

  async function chapterContent(id: string): Promise<string | null> {
    const rows = await testDb.select<{ content: string | null }[]>(
      "SELECT content FROM chapters WHERE id = ?",
      [id]
    );
    return rows.length > 0 ? rows[0].content : null;
  }

  async function noteRow(id: string): Promise<{
    book_id: string | null;
    title: string;
    content: string;
    tags: string[];
    word_count: number;
  } | null> {
    const rows = await testDb.select<
      {
        book_id: string | null;
        title: string;
        content: string;
        tags: string;
        word_count: number;
      }[]
    >("SELECT book_id, title, content, tags, word_count FROM notes WHERE id = ?", [id]);
    if (rows.length === 0) return null;
    return { ...rows[0], tags: JSON.parse(rows[0].tags) as string[] };
  }

  beforeEach(async () => {
    testDb = await createTestDatabase();
    mockGetDatabase.mockReset();
    mockGetDatabase.mockResolvedValue(testDb);
    resetChangeFeedForTests();
    resetPendingEditsForTests();
    changes = [];
    onChange((signal) => {
      if (isEntityChange(signal)) changes.push(signal);
    });
    await testDb.execute(
      `INSERT INTO books (id, title, subtitle, author_name, language, word_count, created_at, updated_at)
       VALUES ('b1', 'Dune', NULL, 'Frank', 'en', 10, 100, 1000)`
    );
    await testDb.execute(
      `INSERT INTO chapters (id, book_id, title, content, "order", parent_id, word_count, created_at, updated_at)
       VALUES ('c1', 'b1', 'One', '<p>Old</p>', 0, NULL, 2, 100, 2000)`
    );
    await testDb.execute(
      `INSERT INTO notes (id, book_id, title, content, tags, language, word_count, "order", created_at, updated_at)
       VALUES ('n1', 'b1', 'Note', '<p>Body</p>', '[]', 'en', 1, 0, 100, 3000)`
    );
  });

  afterEach(() => {
    resetChangeFeedForTests();
    resetPendingEditsForTests();
  });

  it("writes sanitized HTML and emits a local Change for the Chapter's Book", async () => {
    await updatePluginChapterContent("c1", {
      html: '<p>ok</p><script>alert(1)</script><span onclick="x()">world</span>',
    });

    const stored = await chapterContent("c1");
    expect(stored).toContain("<p>ok</p>");
    expect(stored).toContain("world");
    expect(stored).not.toContain("<script");
    expect(stored).not.toContain("onclick");
    // A Chapter reports its containing Book as its Change entity.
    expect(changes).toEqual([{ entity: "book", id: "b1", origin: "local", kind: "content" }]);
  });

  it("escapes a text fragment into paragraphs and leaves a script as text", async () => {
    await updatePluginChapterContent("c1", { text: "One & <two>\n<script>" });

    expect(await chapterContent("c1")).toBe("<p>One &amp; &lt;two&gt;<br>&lt;script&gt;</p>");
  });

  it("writes empty content for an empty text fragment", async () => {
    await updatePluginChapterContent("c1", { text: "" });

    expect(await chapterContent("c1")).toBe("");
    expect(fragmentToHtml({ text: "" })).toBe("");
  });

  it("refuses and writes nothing when a pending-edits Flush fails", async () => {
    const off = registerPendingEditsFlush(() => Promise.reject(new Error("disk full")));
    try {
      await expect(updatePluginChapterContent("c1", { text: "New" })).rejects.toMatchObject({
        name: "PluginApiError",
        code: "library-unavailable",
      });
    } finally {
      off();
    }
    expect(await chapterContent("c1")).toBe("<p>Old</p>");
    expect(changes).toEqual([]);
  });

  it("runs a resolving pending-edits Flush before the write", async () => {
    let contentAtFlush: string | null = null;
    const off = registerPendingEditsFlush(async () => {
      contentAtFlush = await chapterContent("c1");
    });
    try {
      await updatePluginChapterContent("c1", { text: "New" });
    } finally {
      off();
    }
    // The Flush saw the pre-write row, so it ran before the write landed.
    expect(contentAtFlush).toBe("<p>Old</p>");
    expect(await chapterContent("c1")).toBe("<p>New</p>");
  });

  it("creates a Book Note and returns a noteId whose row holds sanitized content", async () => {
    const { noteId } = await createPluginNote({
      title: "Fresh",
      bookId: "b1",
      content: { html: "<p>ok</p><script>alert(1)</script>" },
    });

    const row = await noteRow(noteId);
    expect(row?.book_id).toBe("b1");
    expect(row?.title).toBe("Fresh");
    expect(row?.content).toContain("<p>ok</p>");
    expect(row?.content).not.toContain("<script");
  });

  it("creates an Unfiled Note when no bookId is given", async () => {
    const { noteId } = await createPluginNote({ title: "Loose" });

    expect((await noteRow(noteId))?.book_id).toBeNull();
  });

  it("creates a Note with normalized Tags in the one write", async () => {
    const { noteId } = await createPluginNote({
      title: "Tagged",
      bookId: "b1",
      tags: [" a ", "b", "a", "  "],
    });

    const row = await noteRow(noteId);
    expect(row?.tags).toEqual(["a", "b"]);
    // Tags land with the create, not through a second update call.
    expect(changes).toEqual([{ entity: "note", id: noteId, origin: "local", kind: "content" }]);
  });

  it("updates only a Note's title", async () => {
    await updatePluginNote({ noteId: "n1", title: "Renamed" });

    const row = await noteRow("n1");
    expect(row?.title).toBe("Renamed");
    expect(row?.content).toBe("<p>Body</p>");
  });

  it("updates only a Note's content, sanitized", async () => {
    await updatePluginNote({
      noteId: "n1",
      content: { html: "<p>New</p><script>alert(1)</script>" },
    });

    const row = await noteRow("n1");
    expect(row?.title).toBe("Note");
    expect(row?.content).toContain("<p>New</p>");
    expect(row?.content).not.toContain("<script");
  });

  it("refuses to update a Note that does not exist", async () => {
    await expect(updatePluginNote({ noteId: "ghost", title: "x" })).rejects.toBeInstanceOf(
      PluginApiError
    );
    expect(changes).toEqual([]);
  });

  it("refuses to update a Chapter that does not exist", async () => {
    await expect(updatePluginChapterContent("ghost", { text: "x" })).rejects.toBeInstanceOf(
      PluginApiError
    );
    expect(changes).toEqual([]);
  });

  it("writes when expectedUpdatedAt matches the Chapter as read", async () => {
    const read = await getPluginChapter("c1");

    await updatePluginChapterContent("c1", { text: "New" }, read?.updatedAt);

    expect(await chapterContent("c1")).toBe("<p>New</p>");
    expect(changes).toEqual([{ entity: "book", id: "b1", origin: "local", kind: "content" }]);
  });

  it("refuses with conflict when updated_at differs from the read and writes nothing", async () => {
    const read = await getPluginChapter("c1");
    // The content is untouched: only the Chapter's clock moved since the read.
    await testDb.execute("UPDATE chapters SET updated_at = ? WHERE id = 'c1'", [2001]);

    await expect(
      updatePluginChapterContent("c1", { text: "New" }, read?.updatedAt)
    ).rejects.toMatchObject({
      name: "PluginApiError",
      code: "conflict",
      message: "Chapter c1 changed since it was read",
    });

    expect(await chapterContent("c1")).toBe("<p>Old</p>");
    expect(changes).toEqual([]);
  });

  it("refuses with conflict when the flush landed typing in the same second", async () => {
    const read = await getPluginChapter("c1");
    // The Flush saves the author's typing but `updated_at` stays put, as it does
    // when the read and the flush fall in one Unix second. Only the stored
    // content reveals the change.
    const off = registerPendingEditsFlush(() =>
      testDb.execute("UPDATE chapters SET content = ? WHERE id = 'c1'", ["<p>Typed</p>"])
    );
    try {
      await expect(
        updatePluginChapterContent("c1", { text: "New" }, read?.updatedAt)
      ).rejects.toMatchObject({
        name: "PluginApiError",
        code: "conflict",
        message: "Chapter c1 changed since it was read",
      });
    } finally {
      off();
    }

    expect(await chapterContent("c1")).toBe("<p>Typed</p>");
    expect(changes).toEqual([]);
  });

  it("refuses a Tutorial Library id without writing", async () => {
    await expect(
      updatePluginChapterContent("tutorial-chapter", { text: "x" })
    ).rejects.toMatchObject({
      name: "PluginApiError",
      code: "library-unavailable",
    });
    await expect(createPluginNote({ title: "x", bookId: "tutorial-book" })).rejects.toMatchObject({
      name: "PluginApiError",
      code: "library-unavailable",
    });

    expect(await chapterContent("tutorial-chapter")).toBeNull();
    expect(changes).toEqual([]);
  });

  it("counts a created Note's words from the content it writes", async () => {
    const { noteId } = await createPluginNote({
      title: "Counted",
      content: { text: "one two three" },
    });

    expect((await noteRow(noteId))?.word_count).toBe(3);
  });

  it("recounts a Note's words when a Plugin writes new content", async () => {
    await updatePluginNote({ noteId: "n1", content: { text: "one two three four" } });

    expect((await noteRow("n1"))?.word_count).toBe(4);
  });

  it("leaves a Note's word count untouched on a title-only update", async () => {
    await updatePluginNote({ noteId: "n1", title: "Renamed" });

    const row = await noteRow("n1");
    expect(row?.title).toBe("Renamed");
    expect(row?.word_count).toBe(1);
  });

  it("writes when expectedUpdatedAt matches the Note as read", async () => {
    const read = await getPluginNote("n1");

    await updatePluginNote({
      noteId: "n1",
      content: { text: "New" },
      expectedUpdatedAt: read?.updatedAt,
    });

    expect((await noteRow("n1"))?.content).toBe("<p>New</p>");
    expect(changes).toEqual([{ entity: "note", id: "n1", origin: "local", kind: "content" }]);
  });

  it("refuses a Note with a stale expectedUpdatedAt and writes nothing", async () => {
    const read = await getPluginNote("n1");
    // The content is untouched: only the Note's clock moved since the read.
    await testDb.execute("UPDATE notes SET updated_at = ? WHERE id = 'n1'", [3001]);

    await expect(
      updatePluginNote({
        noteId: "n1",
        content: { text: "New" },
        expectedUpdatedAt: read?.updatedAt,
      })
    ).rejects.toMatchObject({
      name: "PluginApiError",
      code: "conflict",
      message: "Note n1 changed since it was read",
    });

    expect((await noteRow("n1"))?.content).toBe("<p>Body</p>");
    expect(changes).toEqual([]);
  });

  it("refuses with conflict when the flush landed Note typing in the same second", async () => {
    const read = await getPluginNote("n1");
    // The Flush saves the author's typing but `updated_at` stays put, as it does
    // when the read and the flush fall in one Unix second. Only the stored
    // content reveals the change.
    const off = registerPendingEditsFlush(() =>
      testDb.execute("UPDATE notes SET content = ? WHERE id = 'n1'", ["<p>Typed</p>"])
    );
    try {
      await expect(
        updatePluginNote({
          noteId: "n1",
          content: { text: "New" },
          expectedUpdatedAt: read?.updatedAt,
        })
      ).rejects.toMatchObject({
        name: "PluginApiError",
        code: "conflict",
        message: "Note n1 changed since it was read",
      });
    } finally {
      off();
    }

    expect((await noteRow("n1"))?.content).toBe("<p>Typed</p>");
    expect(changes).toEqual([]);
  });

  it("leaves an unguarded Note write free to replace what is stored", async () => {
    // No expectedUpdatedAt: the write is not optimistic, the same rule as a Chapter.
    await updatePluginNote({ noteId: "n1", content: { text: "New" } });

    expect((await noteRow("n1"))?.content).toBe("<p>New</p>");
  });
});
