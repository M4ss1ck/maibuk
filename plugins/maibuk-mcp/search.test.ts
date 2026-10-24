import { describe, expect, it } from "vitest";
import { connect, mcpRequest, type McpAnswer } from "./test-support";
import { markedExcerpt } from "./search";

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

function isToolError(answer: McpAnswer): boolean {
  return answer.json?.result?.isError === true && answer.json?.error === undefined;
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
  text: string,
  updatedAt = Date.UTC(2026, 0, 1)
) {
  return {
    id,
    bookId,
    title,
    order,
    parentId: null,
    chapterType: "chapter" as const,
    wordCount: 10,
    status: "draft" as const,
    updatedAt,
    content: { text, html: `<p>${text}</p>` },
  };
}

function makeNote(
  id: string,
  bookId: string | null,
  title: string,
  text: string,
  updatedAt = 1000
) {
  return {
    id,
    bookId,
    title,
    language: "en",
    tags: [],
    wordCount: 10,
    updatedAt,
    content: { text, html: `<p>${text}</p>` },
  };
}

function makeCanvas(id: string, bookId: string | null, title: string) {
  return { id, bookId, title, updatedAt: Date.UTC(2026, 0, 1) };
}

/** The first word of a search line: kind plus the reference the read tools take. */
function refOf(line: string): { kind: string; ref: string } {
  const [kind, ref] = line.split("  ")[0].split(" ");
  return { kind, ref };
}

describe("search_library", () => {
  it("compact output: one line per item with its reference, count, and marked snippet", async () => {
    const books = [makeBook("bookalpha1", 3000, { title: "Harbour Light" })];
    const chapters = [
      makeChapter("chapteralpha1", "bookalpha1", 1, "Arrival", "The harbour lights glowed.", 2000),
    ];
    const notes = [makeNote("notealpha1", "bookalpha1", "Research", "A pulled harbour note")];
    const { host, key } = await connect({ library: { books, chapters, notes } as any });
    try {
      const answer = await callTool(host, key, "search_library", { query: "harbour" });
      expect(isError(answer)).toBe(false);
      expect(textOf(answer)).toBe(
        [
          'Results 1-3 for "harbour"',
          "book bookalph  Harbour Light  1 match  «Harbour» Light",
          "chapter chaptera  Arrival  1 match  The «harbour» lights glowed.",
          "note notealph  Research  1 match  A pulled «harbour» note",
        ].join("\n")
      );
      expect(answer.json?.result?.structuredContent).toBeUndefined();
    } finally {
      host.stop();
    }
  });

  it("references feed the read tools: each hit reads back through its own tool", async () => {
    const books = [makeBook("bookalpha1", 1000, { title: "Atlas" })];
    const chapters = [
      makeChapter("chapteralpha1", "bookalpha1", 1, "Maps", "Cartography notes here.", 2000),
    ];
    const notes = [makeNote("notealpha1", "bookalpha1", "Margin", "Cartography margin.")];
    const canvases = [makeCanvas("canvasalpha1", null, "Cartography board")];
    const { host, key } = await connect({ library: { books, chapters, notes, canvases } as any });
    try {
      const found = await callTool(host, key, "search_library", { query: "cartography" });
      expect(isError(found)).toBe(false);
      const lines = textOf(found).split("\n").slice(1);
      expect(lines).toHaveLength(3);

      for (const line of lines) {
        const { kind, ref } = refOf(line);
        if (kind === "chapter") {
          const read = await callTool(host, key, "read_chapter", { chapter: ref });
          expect(isError(read)).toBe(false);
          expect(textOf(read)).toContain("Maps");
        } else if (kind === "note") {
          const read = await callTool(host, key, "read_note", { note: ref });
          expect(isError(read)).toBe(false);
          expect(textOf(read)).toContain("Margin");
        } else if (kind === "canvas") {
          expect(ref.startsWith("canvasal")).toBe(true);
        } else {
          throw new Error(`unexpected search line kind ${kind}`);
        }
      }

      const bookHits = await callTool(host, key, "search_library", { query: "Atlas" });
      expect(isError(bookHits)).toBe(false);
      const bookLines = textOf(bookHits).split("\n");
      expect(bookLines).toHaveLength(2);
      const read = await callTool(host, key, "get_book", { book: refOf(bookLines[1]).ref });
      expect(isError(read)).toBe(false);
      expect(textOf(read)).toContain("Atlas");
    } finally {
      host.stop();
    }
  });

  it("pages with a cursor without repeating a hit", async () => {
    const books = [makeBook("bookalpha1", 1000)];
    const notes = Array.from({ length: 5 }, (_, index) =>
      makeNote(`notealpha${index}`, null, `Note ${index}`, "common word")
    );
    const { host, key } = await connect({ library: { books, notes } as any });
    try {
      const seen = new Set<string>();
      let cursor: string | undefined;
      let pages = 0;
      for (;;) {
        const answer = await callTool(host, key, "search_library", {
          query: "common",
          kinds: ["note"],
          limit: 2,
          ...(cursor === undefined ? {} : { cursor }),
        });
        expect(isError(answer)).toBe(false);
        const lines = textOf(answer).split("\n");
        expect(lines[0].startsWith("Results 1-")).toBe(true);
        const body = lines.slice(1);
        const more = body[body.length - 1];
        const hits = more.startsWith("More:") ? body.slice(0, -1) : body;
        for (const line of hits) seen.add(refOf(line).ref);
        pages += 1;
        if (!more.startsWith("More:")) break;
        const match = more.match(/cursor "([^"]+)"/);
        expect(match).not.toBeNull();
        cursor = match![1];
      }
      expect(pages).toBe(3);
      expect(seen.size).toBe(5);
    } finally {
      host.stop();
    }
  });

  it("limit 51 clamps to the first 50 hits", async () => {
    const books = [makeBook("bookalpha1", 1000)];
    const notes = Array.from({ length: 60 }, (_, index) =>
      makeNote(`notealpha${String(index).padStart(4, "0")}`, null, `Note ${index}`, "common word")
    );
    const { host, key } = await connect({ library: { books, notes } as any });
    try {
      const answer = await callTool(host, key, "search_library", { query: "common", limit: 51 });
      expect(isError(answer)).toBe(false);
      const lines = textOf(answer).split("\n");
      expect(lines[0]).toBe('Results 1-50 for "common"');
      expect(lines[lines.length - 1]).toMatch(/^More:/);
    } finally {
      host.stop();
    }
  });

  it("a book filter keeps only that Book and never returns a Canvas", async () => {
    const books = [
      makeBook("bookalpha1", 1000, { title: "First", subtitle: "A shared harbour tale" }),
      makeBook("bookbeta12", 2000, { title: "Second" }),
    ];
    const chapters = [
      makeChapter("chapteralpha1", "bookalpha1", 1, "One", "shared harbour", 1000),
      makeChapter("chapterbeta1", "bookbeta12", 1, "Two", "shared harbour", 1000),
    ];
    const notes = [makeNote("notealpha1", null, "Unfiled", "shared harbour")];
    const canvases = [makeCanvas("canvasalpha1", null, "shared harbour board")];
    const { host, key } = await connect({ library: { books, chapters, notes, canvases } as any });
    try {
      const answer = await callTool(host, key, "search_library", {
        query: "shared",
        book: "bookalph",
      });
      expect(isError(answer)).toBe(false);
      const lines = textOf(answer).split("\n").slice(1);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line.startsWith("canvas")).toBe(false);
      }
      expect(lines.some((line) => line.startsWith("book "))).toBe(true);
      expect(lines.some((line) => line.startsWith("chapter "))).toBe(true);
    } finally {
      host.stop();
    }
  });

  it("kinds filter narrows to one kind", async () => {
    const books = [makeBook("bookalpha1", 1000, { title: "Harbour novel" })];
    const chapters = [
      makeChapter("chapteralpha1", "bookalpha1", 1, "Arrival", "The harbour.", 1000),
    ];
    const notes = [makeNote("notealpha1", null, "Harbour note", "About the harbour.")];
    const { host, key } = await connect({ library: { books, chapters, notes } as any });
    try {
      const answer = await callTool(host, key, "search_library", {
        query: "harbour",
        kinds: ["note"],
      });
      expect(isError(answer)).toBe(false);
      const lines = textOf(answer).split("\n");
      expect(lines.length).toBeGreaterThan(1);
      for (const line of lines.slice(1)) {
        expect(line.startsWith("note ")).toBe(true);
      }
    } finally {
      host.stop();
    }
  });

  it("applies Match case, Whole word, and Regex", async () => {
    const books = [makeBook("bookalpha1", 1000)];
    const chapters = [
      makeChapter("chapteralpha1", "bookalpha1", 1, "Case", "The cat sat on the Cat", 1000),
      makeChapter("chapterbeta1", "bookalpha1", 2, "Whole", "cat category cat", 1000),
      makeChapter("chaptergamma1", "bookalpha1", 3, "Pattern", "a1 b2 c3", 1000),
    ];
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      const sensitive = await callTool(host, key, "search_library", {
        query: "CAT",
        matchCase: true,
        kinds: ["chapter"],
      });
      expect(isError(sensitive)).toBe(false);
      expect(textOf(sensitive)).toBe('No matches for "CAT".');

      const insensitive = await callTool(host, key, "search_library", {
        query: "CAT",
        kinds: ["chapter"],
      });
      expect(isError(insensitive)).toBe(false);
      expect(textOf(insensitive)).toContain("  2 matches");

      const whole = await callTool(host, key, "search_library", {
        query: "cat",
        wholeWord: true,
        kinds: ["chapter"],
      });
      expect(isError(whole)).toBe(false);
      expect(textOf(whole)).toContain("Whole  2 matches");

      const pattern = await callTool(host, key, "search_library", {
        query: "[a-z]\\d",
        regex: true,
        kinds: ["chapter"],
      });
      expect(isError(pattern)).toBe(false);
      expect(textOf(pattern)).toContain("Pattern  3 matches");
    } finally {
      host.stop();
    }
  });

  it("an invalid Regex is a tool error, not a protocol error", async () => {
    const books = [makeBook("bookalpha1", 1000)];
    const { host, key } = await connect({ library: { books } as any });
    try {
      const answer = await callTool(host, key, "search_library", {
        query: "[unclosed",
        regex: true,
      });
      expect(answer.json?.error).toBeUndefined();
      expect(isToolError(answer)).toBe(true);
      expect(textOf(answer).length).toBeGreaterThan(0);
    } finally {
      host.stop();
    }
  });

  it("no matches answers with the query", async () => {
    const books = [makeBook("bookalpha1", 1000, { title: "Plain" })];
    const { host, key } = await connect({ library: { books } as any });
    try {
      const answer = await callTool(host, key, "search_library", { query: "zxqv" });
      expect(isError(answer)).toBe(false);
      expect(textOf(answer)).toBe('No matches for "zxqv".');
    } finally {
      host.stop();
    }
  });

  it("validation: blank query and unknown Book are tool errors", async () => {
    const books = [makeBook("bookalpha1", 1000)];
    const { host, key } = await connect({ library: { books } as any });
    try {
      const blank = await callTool(host, key, "search_library", { query: "   " });
      expect(isToolError(blank)).toBe(true);

      const unknown = await callTool(host, key, "search_library", {
        query: "x",
        book: "zzzzzzzz",
      });
      expect(isToolError(unknown)).toBe(true);
      expect(textOf(unknown)).toContain("list_books");

      const short = await callTool(host, key, "search_library", { query: "x", book: "abc" });
      expect(isToolError(short)).toBe(true);
    } finally {
      host.stop();
    }
  });

  it("validation: the schema refuses an empty query, empty kinds, and a bad limit", async () => {
    const books = [makeBook("bookalpha1", 1000)];
    const { host, key } = await connect({ library: { books } as any });
    try {
      for (const args of [
        { query: "" },
        { query: "x", kinds: [] },
        { query: "x", limit: 0 },
        { query: "x", kinds: ["poem"] },
      ]) {
        const answer = await callTool(host, key, "search_library", args);
        expect(isToolError(answer)).toBe(true);
        expect(textOf(answer)).toContain("Invalid arguments");
      }
    } finally {
      host.stop();
    }
  });

  it("tutorial refusal: an unavailable Library refuses at the endpoint", async () => {
    const books = [makeBook("bookalpha1", 1000)];
    const { host, key } = await connect({ library: { books } as any });
    try {
      host.setLibraryAvailable(false);
      const answer = await callTool(host, key, "search_library", { query: "x" });
      expect(answer.status).toBe(503);
    } finally {
      host.stop();
    }
  });
});

describe("markedExcerpt", () => {
  it("wraps every match in «»", () => {
    expect(
      markedExcerpt({ text: "The harbour lights glowed.", highlights: [{ from: 4, to: 11 }] })
    ).toBe("The «harbour» lights glowed.");
  });

  it("skips ranges outside the text instead of breaking the line", () => {
    expect(
      markedExcerpt({
        text: "short",
        highlights: [
          { from: -2, to: 2 },
          { from: 1, to: 99 },
          { from: 3, to: 2 },
          { from: 0, to: 5 },
        ],
      })
    ).toBe("«short»");
  });

  it("collapses whitespace and cuts long snippets like every other excerpt", () => {
    expect(
      markedExcerpt({ text: `  Once   upon\n\ta   time  `, highlights: [{ from: 2, to: 6 }] })
    ).toBe("«Once» upon a time");
    const long = markedExcerpt({ text: "a".repeat(200), highlights: [{ from: 0, to: 1 }] });
    expect(long).toBe(`«a»${"a".repeat(147)}…`);
  });
});
