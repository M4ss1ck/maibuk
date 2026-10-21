/**
 * `manage_chapter` through the Plugin test kit: what the Agent sees and what the
 * Library holds afterwards. The tool changes one Chapter's title, Chapter Type,
 * or Chapter Status, moves it, or deletes it, so every test asserts the row the
 * write produced and the Checkpoint the write took.
 */

import { describe, expect, it, vi } from "vitest";
import { BOOK_STATUSES } from "@/features/books/types";
import { CHAPTER_STATUSES, CHAPTER_TYPES } from "@/features/chapters/types";
import {
  BOOK_STATUSES as MIRRORED_BOOK_STATUSES,
  CHAPTER_STATUSES as MIRRORED_CHAPTER_STATUSES,
  CHAPTER_TYPES as MIRRORED_CHAPTER_TYPES,
} from "./structure";
import { connect, mcpRequest, type McpAnswer } from "./test-support";

function initializeBody(id: unknown = 1) {
  return {
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "mcp-test", version: "0.0.0" },
    },
  };
}

function toolsCall(name: string, args: unknown, id: unknown = 2) {
  return { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } };
}

async function callTool(host: any, key: string, name: string, args: unknown, id = 2) {
  await mcpRequest(host, key, initializeBody());
  return mcpRequest(host, key, toolsCall(name, args, id));
}

function textOf(answer: McpAnswer): string {
  if (answer.json?.error) return `ERROR:${answer.json.error.message}`;
  return answer.json?.result?.content?.[0]?.text ?? "";
}

function isError(answer: McpAnswer): boolean {
  return answer.json?.result?.isError === true || answer.json?.error !== undefined;
}

function makeBook(id: string, updatedAt: number, title = `Title ${id}`) {
  return {
    id,
    title,
    subtitle: null,
    authorName: "Author",
    genre: null,
    language: "en",
    wordCount: 100,
    targetWordCount: null,
    status: "draft" as const,
    updatedAt,
  };
}

function makeChapter(id: string, bookId: string, order: number, title = `Chapter ${id}`) {
  return {
    id,
    bookId,
    title,
    order,
    parentId: null,
    chapterType: "chapter" as const,
    wordCount: 10,
    status: "draft" as const,
    updatedAt: Date.UTC(2026, 0, 1) + order,
    content: { text: "Body.", html: "<p>Body.</p>" },
  };
}

/** One Book with three Chapters, in order, as `get_book` prints them. */
function threeChapterLibrary() {
  const books = [makeBook("bookalpha1", 1000, "The Book")];
  const chapters = [
    makeChapter("chapteralpha", "bookalpha1", 0, "Alpha"),
    makeChapter("chapterbravo", "bookalpha1", 1, "Bravo"),
    makeChapter("chaptercharl", "bookalpha1", 2, "Charlie"),
  ];
  return { books, chapters };
}

/** The Book's Chapters in stored order, as a fresh read reports them. */
async function orderInLibrary(host: any, key: string): Promise<string[]> {
  const answer = await callTool(host, key, "get_book", { book: "bookalpha1" }, 9);
  return textOf(answer)
    .split("\n")
    .filter((line) => /^\d+\. /.test(line))
    .map((line) => line.split(" ")[1]);
}

/** The 8-character id prefix `get_book` prints for a Chapter id. */
function short(id: string): string {
  return id.slice(0, 8);
}

describe("manage_chapter", () => {
  it("mirrors the host's Chapter Types and Chapter Statuses", () => {
    expect([...MIRRORED_CHAPTER_TYPES]).toEqual([...CHAPTER_TYPES]);
    expect([...MIRRORED_CHAPTER_STATUSES]).toEqual([...CHAPTER_STATUSES]);
  });

  it("sets a Chapter's title", async () => {
    const { books, chapters } = threeChapterLibrary();
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      const answer = await callTool(host, key, "manage_chapter", {
        chapter: "chapteralpha",
        title: "The Opening",
      });
      expect(isError(answer)).toBe(false);
      expect(textOf(answer)).toBe("Chapter The Opening is now chapter 1 of 3.");
      expect(chapters[0].title).toBe("The Opening");
    } finally {
      host.stop();
    }
  });

  it("sets a Chapter's Chapter Type", async () => {
    const { books, chapters } = threeChapterLibrary();
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      const answer = await callTool(host, key, "manage_chapter", {
        chapter: "chapterbravo",
        chapterType: "prologue",
      });
      expect(isError(answer)).toBe(false);
      expect(chapters[1].chapterType).toBe("prologue");
    } finally {
      host.stop();
    }
  });

  it("sets a Chapter's Chapter Status", async () => {
    const { books, chapters } = threeChapterLibrary();
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      const answer = await callTool(host, key, "manage_chapter", {
        chapter: "chaptercharl",
        status: "final",
      });
      expect(isError(answer)).toBe(false);
      expect(chapters[2].status).toBe("final");
    } finally {
      host.stop();
    }
  });

  it("applies a title and a position in one call, the update before the move", async () => {
    const { books, chapters } = threeChapterLibrary();
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      const answer = await callTool(host, key, "manage_chapter", {
        chapter: "chapteralpha",
        title: "The Opening",
        position: 3,
      });
      expect(isError(answer)).toBe(false);
      expect(chapters[0].title).toBe("The Opening");
      expect(textOf(answer)).toBe("Chapter The Opening is now chapter 3 of 3.");
      expect(await orderInLibrary(host, key)).toEqual(
        ["chapterbravo", "chaptercharl", "chapteralpha"].map(short)
      );
    } finally {
      host.stop();
    }
  });

  it.each([
    [
      "moves the first Chapter to last",
      "chapteralpha",
      3,
      ["chapterbravo", "chaptercharl", "chapteralpha"],
    ],
    [
      "moves the last Chapter to first",
      "chaptercharl",
      1,
      ["chaptercharl", "chapteralpha", "chapterbravo"],
    ],
    ["moves a middle Chapter", "chapterbravo", 3, ["chapteralpha", "chaptercharl", "chapterbravo"]],
  ])("%s", async (_case, chapterId, position, expected) => {
    const { books, chapters } = threeChapterLibrary();
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      const answer = await callTool(host, key, "manage_chapter", { chapter: chapterId, position });
      expect(isError(answer)).toBe(false);
      expect(await orderInLibrary(host, key)).toEqual(expected.map(short));
      // The stored order is 0-based and contiguous, like the host's rows.
      expect([...chapters].sort((a, b) => a.order - b.order).map((entry) => entry.id)).toEqual(
        expected
      );
      expect([...chapters].map((entry) => entry.order).sort((a, b) => a - b)).toEqual([0, 1, 2]);
    } finally {
      host.stop();
    }
  });

  it("deletes a Chapter through the host's Delete path", async () => {
    const { books, chapters } = threeChapterLibrary();
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      const answer = await callTool(host, key, "manage_chapter", {
        chapter: "chapterbravo",
        delete: true,
      });
      expect(isError(answer)).toBe(false);
      expect(textOf(answer)).toBe(
        "Deleted Chapter Bravo; the Checkpoint taken before this Connection's first write still holds it."
      );
      expect(await orderInLibrary(host, key)).toEqual(["chapteralpha", "chaptercharl"].map(short));
      expect(host.checkpoints).toHaveLength(1);
    } finally {
      host.stop();
    }
  });

  it("takes one Checkpoint for the Connection's first write to a Book, and none on the second", async () => {
    const { books, chapters } = threeChapterLibrary();
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      const first = await callTool(
        host,
        key,
        "manage_chapter",
        { chapter: "chapteralpha", status: "revised" },
        2
      );
      expect(isError(first)).toBe(false);
      expect(host.checkpoints).toEqual([
        { bookId: "bookalpha1", label: "Before mcp-test edits", versionId: expect.any(String) },
      ]);

      const second = await callTool(
        host,
        key,
        "manage_chapter",
        { chapter: "chapterbravo", title: "Second" },
        3
      );
      expect(isError(second)).toBe(false);
      expect(host.checkpoints).toHaveLength(1);
    } finally {
      host.stop();
    }
  });

  it.each([
    [
      "an unknown Chapter Type",
      { chapterType: "appendix" },
      /Chapter Types are chapter, prologue, epilogue, part, frontmatter, backmatter/,
    ],
    [
      "an unknown Chapter Status",
      { status: "published" },
      /Chapter Statuses are draft, revised, final/,
    ],
    ["position 0", { position: 0 }, /whole number from 1 to 3/],
    ["position past the end", { position: 4 }, /whole number from 1 to 3/],
    ["a non-integer position", { position: 1.5 }, /whole number from 1 to 3/],
    ["delete with another field", { delete: true, title: "Gone" }, /delete and no other field/i],
    ["no field at all", {}, /Give title, chapterType, status, or position/],
    ["an empty title", { title: "   " }, /title of at least one character/],
  ])("refuses %s, changing nothing and taking no Checkpoint", async (_case, args, message) => {
    const { books, chapters } = threeChapterLibrary();
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      const before = chapters.map((chapter) => ({
        id: chapter.id,
        title: chapter.title,
        order: chapter.order,
        chapterType: chapter.chapterType,
        status: chapter.status,
      }));

      const answer = await callTool(host, key, "manage_chapter", {
        chapter: "chapteralpha",
        ...args,
      });

      expect(isError(answer)).toBe(true);
      expect(textOf(answer)).toMatch(message);
      expect(
        chapters.map((chapter) => ({
          id: chapter.id,
          title: chapter.title,
          order: chapter.order,
          chapterType: chapter.chapterType,
          status: chapter.status,
        }))
      ).toEqual(before);
      expect(host.checkpoints).toEqual([]);
    } finally {
      host.stop();
    }
  });
});

/** One Book with no Chapters, the fields `update_book` changes. */
function oneBookLibrary() {
  const books = [makeBook("bookalpha1", 1000, "The Book")];
  return { books, chapters: [] };
}

/** The Book fields `update_book` may change, as the Library holds them. */
function bookState(book: any) {
  return {
    title: book.title,
    authorName: book.authorName,
    genre: book.genre,
    status: book.status,
    targetWordCount: book.targetWordCount,
  };
}

describe("update_book", () => {
  it("mirrors the host's Book Statuses", () => {
    expect([...MIRRORED_BOOK_STATUSES]).toEqual([...BOOK_STATUSES]);
  });

  it("sets a Book's title", async () => {
    const { books, chapters } = oneBookLibrary();
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      const answer = await callTool(host, key, "update_book", {
        book: "bookalpha1",
        title: "New Title",
      });
      expect(isError(answer)).toBe(false);
      expect(textOf(answer)).toBe("Updated Book New Title: title.");
      expect(books[0].title).toBe("New Title");
    } finally {
      host.stop();
    }
  });

  it("sets a Book's Author Name", async () => {
    const { books, chapters } = oneBookLibrary();
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      const answer = await callTool(host, key, "update_book", {
        book: "bookalpha1",
        authorName: "New Author",
      });
      expect(isError(answer)).toBe(false);
      expect(textOf(answer)).toBe("Updated Book The Book: Author Name.");
      expect(books[0].authorName).toBe("New Author");
    } finally {
      host.stop();
    }
  });

  it("sets a Book's Genre", async () => {
    const books = [{ ...makeBook("bookalpha1", 1000, "The Book"), genre: "old genre" }];
    const { host, key } = await connect({ library: { books, chapters: [] } as any });
    try {
      const answer = await callTool(host, key, "update_book", {
        book: "bookalpha1",
        genre: "sci-fi",
      });
      expect(isError(answer)).toBe(false);
      expect(textOf(answer)).toBe("Updated Book The Book: Genre.");
      expect(books[0].genre).toBe("sci-fi");
    } finally {
      host.stop();
    }
  });

  it("sets a Book's Book Status", async () => {
    const { books, chapters } = oneBookLibrary();
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      const answer = await callTool(host, key, "update_book", {
        book: "bookalpha1",
        status: "completed",
      });
      expect(isError(answer)).toBe(false);
      expect(textOf(answer)).toBe("Updated Book The Book: Book Status.");
      expect(books[0].status).toBe("completed");
    } finally {
      host.stop();
    }
  });

  it("sets a Book's Target Word Count", async () => {
    const { books, chapters } = oneBookLibrary();
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      const answer = await callTool(host, key, "update_book", {
        book: "bookalpha1",
        targetWordCount: 500,
      });
      expect(isError(answer)).toBe(false);
      expect(textOf(answer)).toBe("Updated Book The Book: Target Word Count.");
      expect(books[0].targetWordCount).toBe(500);
    } finally {
      host.stop();
    }
  });

  it("clears the Genre with an empty string", async () => {
    const books = [{ ...makeBook("bookalpha1", 1000, "The Book"), genre: "sci-fi" }];
    const { host, key } = await connect({ library: { books, chapters: [] } as any });
    try {
      const answer = await callTool(host, key, "update_book", {
        book: "bookalpha1",
        genre: "",
      });
      expect(isError(answer)).toBe(false);
      expect(textOf(answer)).toBe("Updated Book The Book: Genre.");
      expect(books[0].genre).toBeNull();
    } finally {
      host.stop();
    }
  });

  it("clears the Target Word Count with null", async () => {
    const books = [{ ...makeBook("bookalpha1", 1000, "The Book"), targetWordCount: 500 }];
    const { host, key } = await connect({ library: { books, chapters: [] } as any });
    try {
      const answer = await callTool(host, key, "update_book", {
        book: "bookalpha1",
        targetWordCount: null,
      });
      expect(isError(answer)).toBe(false);
      expect(textOf(answer)).toBe("Updated Book The Book: Target Word Count.");
      expect(books[0].targetWordCount).toBeNull();
    } finally {
      host.stop();
    }
  });

  it("refuses an unknown Book ref without taking a Checkpoint", async () => {
    const { books, chapters } = oneBookLibrary();
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      const before = bookState(books[0]);
      const answer = await callTool(host, key, "update_book", {
        book: "unknownbook",
        title: "New Title",
      });
      expect(isError(answer)).toBe(true);
      expect(textOf(answer)).toBe(
        "No Book has the id unknownbook; call list_books to see the Books."
      );
      expect(bookState(books[0])).toEqual(before);
      expect(host.checkpoints).toEqual([]);
    } finally {
      host.stop();
    }
  });

  it("takes one Checkpoint for the Connection's first write to a Book, and none on the second", async () => {
    const { books, chapters } = oneBookLibrary();
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      const first = await callTool(
        host,
        key,
        "update_book",
        { book: "bookalpha1", title: "First" },
        2
      );
      expect(isError(first)).toBe(false);
      expect(host.checkpoints).toEqual([
        { bookId: "bookalpha1", label: "Before mcp-test edits", versionId: expect.any(String) },
      ]);

      const second = await callTool(
        host,
        key,
        "update_book",
        { book: "bookalpha1", status: "completed" },
        3
      );
      expect(isError(second)).toBe(false);
      expect(host.checkpoints).toHaveLength(1);
    } finally {
      host.stop();
    }
  });

  it("is absent in read-only mode", async () => {
    const { books, chapters } = oneBookLibrary();
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      await mcpRequest(host, key, initializeBody());
      const listed = await mcpRequest(host, key, {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/list",
        params: {},
      });
      expect(listed.json.result.tools.map((tool: any) => tool.name)).toContain("update_book");

      host.setGranted(["serve", "library:read"]);
      await vi.waitFor(async () => {
        const readonly = await mcpRequest(host, key, {
          jsonrpc: "2.0",
          id: 4,
          method: "tools/list",
          params: {},
        });
        expect(readonly.json.result.tools.map((tool: any) => tool.name)).not.toContain(
          "update_book"
        );
      });

      const refused = await mcpRequest(
        host,
        key,
        toolsCall("update_book", { book: "bookalpha1", title: "New Title" }, 5)
      );
      expect(refused.json).toEqual({
        jsonrpc: "2.0",
        id: 5,
        error: { code: -32602, message: "Tool update_book not found" },
      });
      expect(books[0].title).toBe("The Book");
      expect(host.checkpoints).toEqual([]);
    } finally {
      host.stop();
    }
  });

  it.each([
    [
      "no field at all",
      {},
      /Give title, authorName, genre, status, or targetWordCount to change the Book\./,
    ],
    [
      "an empty title",
      { title: "   " },
      /Give a title of at least one character; call get_book to see the Book's current title\./,
    ],
    [
      "an unknown Book Status",
      { status: "published" },
      /The Book Statuses are draft, in-progress, completed, archived; call update_book with one of them\./,
    ],
    [
      "a targetWordCount of 0",
      { targetWordCount: 0 },
      /Give targetWordCount as a whole number of words of at least 1, or null to clear it\./,
    ],
    [
      "a fractional targetWordCount",
      { targetWordCount: 1.5 },
      /Give targetWordCount as a whole number of words of at least 1, or null to clear it\./,
    ],
    [
      "a negative targetWordCount",
      { targetWordCount: -5 },
      /Give targetWordCount as a whole number of words of at least 1, or null to clear it\./,
    ],
    [
      "a 501-character title",
      { title: "a".repeat(501) },
      /A title can be at most 500 characters; call update_book with a shorter one\./,
    ],
    [
      "a 501-character Author Name",
      { authorName: "a".repeat(501) },
      /Author Name can be at most 500 characters; call update_book with a shorter one\./,
    ],
    [
      "a 201-character Genre",
      { genre: "a".repeat(201) },
      /Genre can be at most 200 characters; call update_book with a shorter one\./,
    ],
  ])("refuses %s, changing nothing and taking no Checkpoint", async (_case, args, message) => {
    const { books, chapters } = oneBookLibrary();
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      const before = bookState(books[0]);

      const answer = await callTool(host, key, "update_book", {
        book: "bookalpha1",
        ...args,
      });

      expect(isError(answer)).toBe(true);
      expect(textOf(answer)).toMatch(message);
      expect(bookState(books[0])).toEqual(before);
      expect(host.checkpoints).toEqual([]);
    } finally {
      host.stop();
    }
  });
});
