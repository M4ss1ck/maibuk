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

function headerOf(answer: McpAnswer): string {
  if (answer.json?.error) return `ERROR:${answer.json.error.message}`;
  return answer.json?.result?.content?.[0]?.text ?? "";
}

function windowOf(answer: McpAnswer): string {
  if (answer.json?.error) return `ERROR:${answer.json.error.message}`;
  return answer.json?.result?.content?.[1]?.text ?? "";
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

function makeChapter(
  id: string,
  bookId: string,
  order: number,
  title: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    id,
    bookId,
    title,
    order,
    parentId: null,
    chapterType: "chapter" as const,
    wordCount: overrides.wordCount ?? 10,
    status: "draft" as const,
    updatedAt: overrides.updatedAt ?? Date.UTC(2026, 0, 1),
    ...(overrides.content !== undefined ? { content: overrides.content } : {}),
  };
}

function makeNote(
  id: string,
  bookId: string | null,
  title: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    id,
    bookId,
    title,
    language: overrides.language ?? "en",
    tags: overrides.tags ?? [],
    wordCount: overrides.wordCount ?? 10,
    updatedAt: overrides.updatedAt ?? Date.UTC(2026, 0, 1),
    ...(overrides.content !== undefined ? { content: overrides.content } : {}),
  };
}

describe("read_chapter", () => {
  it("text default: exact header lines and the whole text", async () => {
    const updatedAt = Date.UTC(2026, 2, 3, 4, 5, 6, 789);
    const books = [makeBook("bookalpha1", updatedAt, { title: "The Book" })];
    const chapters = [
      makeChapter("chapteralpha", "bookalpha1", 1, "The Chapter", {
        wordCount: 2,
        updatedAt,
        content: { text: "Hello world", html: "<p>Hello world</p>" },
      }),
    ];
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      const answer = await callTool(host, key, "read_chapter", { chapter: "chapteralpha" });
      expect(isError(answer)).toBe(false);
      expect(headerOf(answer).split("\n")).toEqual([
        "Chapter chaptera: The Chapter",
        "Book: bookalph  The Book",
        "Words: 2",
        "Last Edited: 2026-03-03T04:05:06.789Z",
        "Format: text",
        "Characters 0-11 of 11",
        "End of Chapter.",
      ]);
      expect(windowOf(answer)).toBe("Hello world");
    } finally {
      host.stop();
    }
  });

  it("html format returns the html", async () => {
    const books = [makeBook("bookalpha1", 1000, { title: "The Book" })];
    const chapters = [
      makeChapter("chapteralpha", "bookalpha1", 1, "The Chapter", {
        content: { text: "Hello world", html: "<p>Hello world</p>" },
      }),
    ];
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      const answer = await callTool(host, key, "read_chapter", {
        chapter: "chapteralpha",
        format: "html",
      });
      expect(isError(answer)).toBe(false);
      const lines = headerOf(answer).split("\n");
      expect(lines).toContain("Format: html");
      expect(lines).toContain("Characters 0-18 of 18");
      expect(windowOf(answer)).toBe("<p>Hello world</p>");
    } finally {
      host.stop();
    }
  });

  it("45,000-char Chapter reads to the end across Next offsets", async () => {
    const text = "a".repeat(45000);
    const books = [makeBook("bookalpha1", 1000)];
    const chapters = [
      makeChapter("chapteralpha", "bookalpha1", 1, "Long", {
        content: { text, html: "<p>long</p>" },
      }),
    ];
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      const first = await callTool(host, key, "read_chapter", { chapter: "chapteralpha" });
      const firstLines = headerOf(first).split("\n");
      expect(firstLines).toContain("Characters 0-20000 of 45000");
      expect(firstLines).toContain("Next offset: 20000");

      const windows = [windowOf(first)];
      let offset = 20000;
      let last = first;
      for (;;) {
        const next = await callTool(host, key, "read_chapter", {
          chapter: "chapteralpha",
          offset,
        });
        expect(isError(next)).toBe(false);
        windows.push(windowOf(next));
        const nextLines = headerOf(next).split("\n");
        const endLine = nextLines[nextLines.length - 1];
        if (endLine === "End of Chapter.") {
          last = next;
          break;
        }
        const m = endLine.match(/^Next offset: (\d+)$/);
        expect(m).not.toBeNull();
        offset = Number(m![1]);
      }
      expect(headerOf(last).split("\n")).toContain("Characters 40000-45000 of 45000");
      expect(windows.join("")).toBe(text);
    } finally {
      host.stop();
    }
  });

  it("length 60000 on a 70,000-char Chapter returns 50,000 chars", async () => {
    const books = [makeBook("bookalpha1", 1000)];
    const chapters = [
      makeChapter("chapteralpha", "bookalpha1", 1, "Huge", {
        content: { text: "b".repeat(70000), html: "<p>huge</p>" },
      }),
    ];
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      const answer = await callTool(host, key, "read_chapter", {
        chapter: "chapteralpha",
        length: 60000,
      });
      expect(isError(answer)).toBe(false);
      expect(headerOf(answer).split("\n")).toContain("Characters 0-50000 of 70000");
      expect(headerOf(answer).split("\n")).toContain("Next offset: 50000");
      expect(windowOf(answer)).toHaveLength(50000);
    } finally {
      host.stop();
    }
  });

  it("offset == total is an empty window; offset past end is an error", async () => {
    const books = [makeBook("bookalpha1", 1000)];
    const chapters = [
      makeChapter("chapteralpha", "bookalpha1", 1, "Short", {
        content: { text: "abc", html: "<p>abc</p>" },
      }),
    ];
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      const atEnd = await callTool(host, key, "read_chapter", {
        chapter: "chapteralpha",
        offset: 3,
      });
      expect(isError(atEnd)).toBe(false);
      expect(headerOf(atEnd).split("\n")).toContain("Characters 3-3 of 3");
      expect(headerOf(atEnd).split("\n")).toContain("End of Chapter.");
      expect(windowOf(atEnd)).toBe("");

      const pastEnd = await callTool(host, key, "read_chapter", {
        chapter: "chapteralpha",
        offset: 4,
      });
      expect(isError(pastEnd)).toBe(true);
      expect(headerOf(pastEnd)).toBe(
        "The offset 4 is past the end of the Chapter (3 characters); call read_chapter with a smaller offset."
      );
    } finally {
      host.stop();
    }
  });

  it("a surrogate pair straddling position 20000 is not split", async () => {
    const text = `${"x".repeat(19999)}😀${"y".repeat(5000)}`;
    const books = [makeBook("bookalpha1", 1000)];
    const chapters = [
      makeChapter("chapteralpha", "bookalpha1", 1, "Emoji", {
        content: { text, html: "<p>emoji</p>" },
      }),
    ];
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      const first = await callTool(host, key, "read_chapter", { chapter: "chapteralpha" });
      expect(isError(first)).toBe(false);
      expect(headerOf(first).split("\n")).toContain(`Characters 0-19999 of ${text.length}`);
      expect(headerOf(first).split("\n")).toContain("Next offset: 19999");
      expect(windowOf(first)).toHaveLength(19999);

      const rest = await callTool(host, key, "read_chapter", {
        chapter: "chapteralpha",
        offset: 19999,
      });
      expect(isError(rest)).toBe(false);
      expect(windowOf(first) + windowOf(rest)).toBe(text);
    } finally {
      host.stop();
    }
  });

  it("resolves by 8-char prefix and full id", async () => {
    const books = [makeBook("bookalpha1", 1000, { title: "The Book" })];
    const chapters = [
      makeChapter("chapteralpha", "bookalpha1", 1, "The Chapter", {
        content: { text: "body", html: "<p>body</p>" },
      }),
    ];
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      const byPrefix = await callTool(host, key, "read_chapter", { chapter: "chaptera" });
      expect(isError(byPrefix)).toBe(false);
      expect(headerOf(byPrefix)).toContain("The Chapter");

      const byFull = await callTool(host, key, "read_chapter", { chapter: "chapteralpha" });
      expect(isError(byFull)).toBe(false);
      expect(headerOf(byFull)).toContain("The Chapter");
    } finally {
      host.stop();
    }
  });

  it("ambiguous prefix across two Books lists candidates with their Books", async () => {
    const books = [
      makeBook("bookaaaa0001", 1000, { title: "BookA" }),
      makeBook("bookbbbb0002", 2000, { title: "BookB" }),
    ];
    const chapters = [
      makeChapter("sharedch-0001", "bookaaaa0001", 1, "First", {
        content: { text: "one", html: "<p>one</p>" },
      }),
      makeChapter("sharedch-0002", "bookbbbb0002", 1, "Second", {
        content: { text: "two", html: "<p>two</p>" },
      }),
    ];
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      const answer = await callTool(host, key, "read_chapter", { chapter: "sharedch" });
      expect(isError(answer)).toBe(true);
      expect(headerOf(answer)).toContain("matches several Chapters");
      expect(headerOf(answer)).toContain("in BookA");
      expect(headerOf(answer)).toContain("in BookB");
    } finally {
      host.stop();
    }
  });

  it("unknown id names get_book", async () => {
    const books = [makeBook("bookalpha1", 1000)];
    const chapters = [
      makeChapter("chapteralpha", "bookalpha1", 1, "The Chapter", {
        content: { text: "body", html: "<p>body</p>" },
      }),
    ];
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      const answer = await callTool(host, key, "read_chapter", { chapter: "zzzzzzzz" });
      expect(isError(answer)).toBe(true);
      expect(headerOf(answer)).toBe(
        "No Chapter has the id zzzzzzzz; call get_book to see the Chapters."
      );
    } finally {
      host.stop();
    }
  });

  it("tutorial refusal", async () => {
    const books = [makeBook("bookalpha1", 1000)];
    const chapters = [
      makeChapter("chapteralpha", "bookalpha1", 1, "The Chapter", {
        content: { text: "body", html: "<p>body</p>" },
      }),
    ];
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      host.setLibraryAvailable(false);
      const answer = await callTool(host, key, "read_chapter", { chapter: "chapteralpha" });
      expect(answer.status).toBe(503);
    } finally {
      host.stop();
    }
  });
});

describe("read_note", () => {
  it("header with Book line, Tags line, Last Edited, and the window", async () => {
    const updatedAt = Date.UTC(2026, 4, 6, 7, 8, 9, 123);
    const books = [makeBook("bookalpha1", 1000, { title: "The Book" })];
    const notes = [
      makeNote("notealpha1", "bookalpha1", "The Note", {
        tags: ["a", "b"],
        wordCount: 3,
        updatedAt,
        content: { text: "Note body text", html: "<p>Note body text</p>" },
      }),
    ];
    const { host, key } = await connect({ library: { books, notes } as any });
    try {
      const answer = await callTool(host, key, "read_note", { note: "notealpha1" });
      expect(isError(answer)).toBe(false);
      expect(headerOf(answer).split("\n")).toEqual([
        "Note notealph: The Note",
        "Book: bookalph  The Book",
        "Tags: a, b",
        "Words: 3",
        "Last Edited: 2026-05-06T07:08:09.123Z",
        "Format: text",
        "Characters 0-14 of 14",
        "End of Note.",
      ]);
      expect(windowOf(answer)).toBe("Note body text");
    } finally {
      host.stop();
    }
  });

  it("Tags none and Unfiled Note", async () => {
    const notes = [
      makeNote("notealpha1", null, "Loose", {
        tags: [],
        content: { text: "loose body", html: "<p>loose body</p>" },
      }),
    ];
    const { host, key } = await connect({ library: { notes } as any });
    try {
      const answer = await callTool(host, key, "read_note", { note: "notealpha1" });
      expect(isError(answer)).toBe(false);
      const lines = headerOf(answer).split("\n");
      expect(lines).toContain("Book: Unfiled");
      expect(lines).toContain("Tags: none");
    } finally {
      host.stop();
    }
  });

  it("html format", async () => {
    const books = [makeBook("bookalpha1", 1000, { title: "The Book" })];
    const notes = [
      makeNote("notealpha1", "bookalpha1", "The Note", {
        content: { text: "plain", html: "<p>rich</p>" },
      }),
    ];
    const { host, key } = await connect({ library: { books, notes } as any });
    try {
      const answer = await callTool(host, key, "read_note", {
        note: "notealpha1",
        format: "html",
      });
      expect(isError(answer)).toBe(false);
      expect(headerOf(answer).split("\n")).toContain("Format: html");
      expect(windowOf(answer)).toBe("<p>rich</p>");
    } finally {
      host.stop();
    }
  });

  it("windowing with Next offset to the End of Note", async () => {
    const text = "n".repeat(25000);
    const notes = [
      makeNote("notealpha1", null, "Long", {
        content: { text, html: "<p>long</p>" },
      }),
    ];
    const { host, key } = await connect({ library: { notes } as any });
    try {
      const first = await callTool(host, key, "read_note", { note: "notealpha1" });
      expect(headerOf(first).split("\n")).toContain("Characters 0-20000 of 25000");
      expect(headerOf(first).split("\n")).toContain("Next offset: 20000");

      const second = await callTool(host, key, "read_note", {
        note: "notealpha1",
        offset: 20000,
      });
      expect(isError(second)).toBe(false);
      expect(headerOf(second).split("\n")).toContain("Characters 20000-25000 of 25000");
      expect(headerOf(second).split("\n")).toContain("End of Note.");
      expect(windowOf(first) + windowOf(second)).toBe(text);
    } finally {
      host.stop();
    }
  });

  it("offset past end is an error", async () => {
    const notes = [
      makeNote("notealpha1", null, "Short", {
        content: { text: "abc", html: "<p>abc</p>" },
      }),
    ];
    const { host, key } = await connect({ library: { notes } as any });
    try {
      const answer = await callTool(host, key, "read_note", { note: "notealpha1", offset: 4 });
      expect(isError(answer)).toBe(true);
      expect(headerOf(answer)).toBe(
        "The offset 4 is past the end of the Note (3 characters); call read_note with a smaller offset."
      );
    } finally {
      host.stop();
    }
  });

  it("ambiguous prefix error lists the list_notes lines", async () => {
    const notes = [
      makeNote("noteshar-01", null, "First", {
        tags: ["t"],
        content: { text: "one", html: "<p>one</p>" },
      }),
      makeNote("noteshar-02", null, "Second", {
        content: { text: "two", html: "<p>two</p>" },
      }),
    ];
    const { host, key } = await connect({ library: { notes } as any });
    try {
      const answer = await callTool(host, key, "read_note", { note: "noteshar" });
      expect(isError(answer)).toBe(true);
      expect(headerOf(answer)).toContain("matches several Notes");
      expect(headerOf(answer)).toContain("First");
      expect(headerOf(answer)).toContain("Second");
    } finally {
      host.stop();
    }
  });

  it("unknown id names list_notes", async () => {
    const notes = [
      makeNote("notealpha1", null, "The Note", {
        content: { text: "body", html: "<p>body</p>" },
      }),
    ];
    const { host, key } = await connect({ library: { notes } as any });
    try {
      const answer = await callTool(host, key, "read_note", { note: "zzzzzzzz" });
      expect(isError(answer)).toBe(true);
      expect(headerOf(answer)).toBe(
        "No Note has the id zzzzzzzz; call list_notes to see the Notes."
      );
    } finally {
      host.stop();
    }
  });

  it("tutorial refusal", async () => {
    const notes = [
      makeNote("notealpha1", null, "The Note", {
        content: { text: "body", html: "<p>body</p>" },
      }),
    ];
    const { host, key } = await connect({ library: { notes } as any });
    try {
      host.setLibraryAvailable(false);
      const answer = await callTool(host, key, "read_note", { note: "notealpha1" });
      expect(answer.status).toBe(503);
    } finally {
      host.stop();
    }
  });
});
