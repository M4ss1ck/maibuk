import { describe, expect, it } from "vitest";
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

async function callTool(host: any, key: string, name: string, args: unknown) {
  await mcpRequest(host, key, initializeBody());
  return mcpRequest(host, key, toolsCall(name, args));
}

function textOf(answer: McpAnswer): string {
  if (answer.json?.error) return `ERROR:${answer.json.error.message}`;
  return answer.json?.result?.content?.[0]?.text ?? "";
}

function isError(answer: McpAnswer): boolean {
  return answer.json?.result?.isError === true || answer.json?.error !== undefined;
}

function makeBook(id: string, updatedAt: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: overrides.title ?? `Title ${id}`,
    subtitle: overrides.subtitle ?? null,
    authorName: overrides.authorName ?? "Author",
    genre: null,
    language: "en",
    wordCount: overrides.wordCount ?? 100,
    targetWordCount: null,
    status: overrides.status ?? "draft",
    updatedAt,
  };
}

function makeChapter(id: string, bookId: string, order: number, title: string, wordCount: number) {
  return {
    id,
    bookId,
    title,
    order,
    parentId: null,
    chapterType: "chapter" as const,
    wordCount,
    status: "draft" as const,
    updatedAt: Date.UTC(2026, 0, 1),
  };
}

function makeNote(id: string, bookId: string, title: string) {
  return {
    id,
    bookId,
    title,
    language: "en",
    tags: [],
    wordCount: 10,
    updatedAt: Date.UTC(2026, 0, 1),
  };
}

describe("list_books", () => {
  it("default page: 25 books -> first page 20 and More cursor, then rest", async () => {
    const books = Array.from({ length: 25 }, (_, i) =>
      makeBook(`book-${String(i).padStart(4, "0")}`, Date.UTC(2026, 0, 1))
    );
    const { host, key } = await connect({ library: { books } as any });
    try {
      const first = await callTool(host, key, "list_books", {});
      const firstText = textOf(first);
      const firstLines = firstText.split("\n");
      expect(firstLines[0]).toBe("Books 1-20 of 25");
      expect(firstLines).toHaveLength(22); // header + 20 + more
      const moreLine = firstLines[firstLines.length - 1];
      const m = moreLine.match(/cursor "([^"]+)"/);
      expect(m).not.toBeNull();
      const cursor = m![1];

      const second = await callTool(host, key, "list_books", { cursor });
      const secondText = textOf(second);
      const secondLines = secondText.split("\n");
      expect(secondLines[0]).toBe("Books 21-25 of 25");
      expect(secondLines).toHaveLength(6); // header + 5
      expect(secondText).not.toContain("More:");
    } finally {
      host.stop();
    }
  });

  it("limit 50 cap: 60 books, limit 50 -> 50 lines; limit 51 refused", async () => {
    const books = Array.from({ length: 60 }, (_, i) =>
      makeBook(`book-${String(i).padStart(4, "0")}`, Date.UTC(2026, 0, 1))
    );
    const { host, key } = await connect({ library: { books } as any });
    try {
      const ok = await callTool(host, key, "list_books", { limit: 50 });
      const lines = textOf(ok).split("\n");
      expect(lines[0]).toBe("Books 1-50 of 60");
      expect(lines.filter((l) => /\d+ words/.test(l))).toHaveLength(50);

      const bad = await callTool(host, key, "list_books", { limit: 51 });
      expect(isError(bad)).toBe(true);
    } finally {
      host.stop();
    }
  });

  it("orders by updatedAt descending", async () => {
    const books = [
      makeBook("book-a", 1000, { title: "Oldest" }),
      makeBook("book-b", 3000, { title: "Newest" }),
      makeBook("book-c", 2000, { title: "Middle" }),
    ];
    const { host, key } = await connect({ library: { books } as any });
    try {
      const answer = await callTool(host, key, "list_books", {});
      const lines = textOf(answer).split("\n");
      expect(lines[1]).toContain("Newest");
      expect(lines[2]).toContain("Middle");
      expect(lines[3]).toContain("Oldest");
    } finally {
      host.stop();
    }
  });

  it("status filter: only matching books and their total", async () => {
    const books = [
      makeBook("book-a", 1000, { status: "completed", title: "Done1" }),
      makeBook("book-b", 2000, { status: "draft", title: "Draft1" }),
      makeBook("book-c", 3000, { status: "completed", title: "Done2" }),
    ];
    const { host, key } = await connect({ library: { books } as any });
    try {
      const answer = await callTool(host, key, "list_books", { status: "completed" });
      const text = textOf(answer);
      expect(text.split("\n")[0]).toBe("Books 1-2 of 2");
      expect(text).toContain("Done1");
      expect(text).toContain("Done2");
      expect(text).not.toContain("Draft1");
    } finally {
      host.stop();
    }
  });

  it("empty -> No Books match.", async () => {
    const { host, key } = await connect({ library: { books: [] } as any });
    try {
      const answer = await callTool(host, key, "list_books", {});
      expect(textOf(answer)).toBe("No Books match.");
    } finally {
      host.stop();
    }
  });

  it("bad cursor -> error sentence", async () => {
    const books = [makeBook("book-a", 1000)];
    const { host, key } = await connect({ library: { books } as any });
    try {
      const answer = await callTool(host, key, "list_books", { cursor: btoa("999") });
      expect(isError(answer)).toBe(true);
      expect(textOf(answer)).toBe(
        "The cursor is not valid; call list_books without a cursor to start again."
      );
    } finally {
      host.stop();
    }
  });

  it("short ids", async () => {
    const books = [
      makeBook("abcdefghi0-foo", 1000),
      makeBook("abcdefghi1-bar", 2000),
      makeBook("zbcdefgh-baz", 3000),
    ];
    const { host, key } = await connect({ library: { books } as any });
    try {
      const answer = await callTool(host, key, "list_books", {});
      const text = textOf(answer);
      expect(text).toContain("abcdefghi0  ");
      expect(text).toContain("abcdefghi1  ");
      expect(text).toContain("zbcdefgh  ");
    } finally {
      host.stop();
    }
  });
});

describe("get_book", () => {
  it("resolves by 8+ char prefix and by full id", async () => {
    const books = [makeBook("abcdefghi0-foo", 1000, { title: "MyBook" })];
    const { host, key } = await connect({ library: { books } as any });
    try {
      const byPrefix = await callTool(host, key, "get_book", { book: "abcdefghi0" });
      expect(isError(byPrefix)).toBe(false);
      expect(textOf(byPrefix)).toContain("MyBook");

      const byFull = await callTool(host, key, "get_book", { book: "abcdefghi0-foo" });
      expect(isError(byFull)).toBe(false);
      expect(textOf(byFull)).toContain("MyBook");
    } finally {
      host.stop();
    }
  });

  it("ambiguous prefix -> isError with candidate lines", async () => {
    const books = [
      makeBook("abcdefghi0-foo", 1000, { title: "Book0" }),
      makeBook("abcdefghi1-bar", 2000, { title: "Book1" }),
    ];
    const { host, key } = await connect({ library: { books } as any });
    try {
      const answer = await callTool(host, key, "get_book", { book: "abcdefghi" });
      expect(isError(answer)).toBe(true);
      const text = textOf(answer);
      expect(text).toContain("matches several Books");
      expect(text).toContain("Book0");
      expect(text).toContain("Book1");
    } finally {
      host.stop();
    }
  });

  it("under 8 chars -> error", async () => {
    const books = [makeBook("abcdefghi0-foo", 1000)];
    const { host, key } = await connect({ library: { books } as any });
    try {
      const answer = await callTool(host, key, "get_book", { book: "abcdefg" });
      expect(isError(answer)).toBe(true);
    } finally {
      host.stop();
    }
  });

  it("unknown -> error", async () => {
    const books = [makeBook("abcdefghi0-foo", 1000)];
    const { host, key } = await connect({ library: { books } as any });
    try {
      const answer = await callTool(host, key, "get_book", { book: "zzzzzzzz" });
      expect(isError(answer)).toBe(true);
      expect(textOf(answer)).toBe("No Book has the id zzzzzzzz; call list_books to see the Books.");
    } finally {
      host.stop();
    }
  });

  it("output: chapters in order, note titles, last edited date", async () => {
    const updatedAt = Date.UTC(2026, 5, 15);
    const books = [
      makeBook("abcdefghi0-foo", updatedAt, {
        title: "MyBook",
        subtitle: "Sub",
        authorName: "Auth",
        status: "in-progress",
        wordCount: 42,
      }),
    ];
    const chapters = [
      makeChapter("ch2", "abcdefghi0-foo", 2, "Second", 7),
      makeChapter("ch1", "abcdefghi0-foo", 1, "First", 5),
    ];
    const notes = [
      makeNote("note1", "abcdefghi0-foo", "Note One"),
      makeNote("note2", "abcdefghi0-foo", "Note Two"),
    ];
    const { host, key } = await connect({ library: { books, chapters, notes } as any });
    try {
      const answer = await callTool(host, key, "get_book", { book: "abcdefghi0-foo" });
      const text = textOf(answer);
      expect(text).toContain("Book ");
      expect(text).toContain("MyBook");
      expect(text).toContain("Subtitle: Sub");
      expect(text).toContain("Author: Auth");
      expect(text).toContain("Status: in-progress");
      expect(text).toContain("Words: 42");
      expect(text).toContain("Last Edited: 2026-06-15");
      expect(text).toContain("Chapters (2):");
      expect(text).toContain("1.");
      expect(text).toContain("First");
      expect(text).toContain("5 words");
      expect(text).toContain("2.");
      expect(text).toContain("Second");
      expect(text).toContain("7 words");
      expect(text).toContain("Notes (2):");
      expect(text).toContain("Note One");
      expect(text).toContain("Note Two");
    } finally {
      host.stop();
    }
  });

  it("tutorial: setLibraryAvailable(false) refuses tools/call", async () => {
    const { host, key } = await connect({ library: { books: [] } as any });
    try {
      host.setLibraryAvailable(false);
      const answer = await callTool(host, key, "list_books", {});
      expect(answer.status).toBe(503);
    } finally {
      host.stop();
    }
  });
});
