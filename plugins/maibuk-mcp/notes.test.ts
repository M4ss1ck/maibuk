import { describe, expect, it } from "vitest";
import { connect, mcpRequest, noteWithBody, type McpAnswer } from "./test-support";

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
  };
}

describe("list_notes", () => {
  it("all notes sorted newest first with header", async () => {
    const notes = [
      makeNote("note-a", null, "Oldest", { updatedAt: 1000 }),
      makeNote("note-b", null, "Newest", { updatedAt: 3000 }),
      makeNote("note-c", null, "Middle", { updatedAt: 2000 }),
    ];
    const { host, key } = await connect({ library: { notes } as any });
    try {
      const answer = await callTool(host, key, "list_notes", {});
      const lines = textOf(answer).split("\n");
      expect(lines[0]).toBe("Notes 1-3 of 3");
      expect(lines[1]).toContain("Newest");
      expect(lines[2]).toContain("Middle");
      expect(lines[3]).toContain("Oldest");
    } finally {
      host.stop();
    }
  });

  it("line format with and without Tags", async () => {
    const notes = [
      makeNote("note-aaaa", null, "Alpha", { tags: ["x", "y"], wordCount: 5 }),
      makeNote("note-bbbb", null, "Beta", { tags: [], wordCount: 7 }),
    ];
    const { host, key } = await connect({ library: { notes } as any });
    try {
      const answer = await callTool(host, key, "list_notes", {});
      const text = textOf(answer);
      expect(text).toContain("Tags: x, y");
      const lines = text.split("\n");
      const betaLine = lines.find((l) => l.includes("Beta"))!;
      expect(betaLine).not.toContain("Tags:");
    } finally {
      host.stop();
    }
  });

  it("book filter by 8-char prefix", async () => {
    const books = [makeBook("bookprefix0000", 1000, { title: "Bk" })];
    const notes = [
      makeNote("note-inbook", "bookprefix0000", "InBook"),
      makeNote("note-other", null, "Other"),
    ];
    const { host, key } = await connect({ library: { books, notes } as any });
    try {
      const answer = await callTool(host, key, "list_notes", { book: "bookpref" });
      const text = textOf(answer);
      expect(text).toContain("InBook");
      expect(text).not.toContain("Other");
    } finally {
      host.stop();
    }
  });

  it("book Unfiled", async () => {
    const notes = [
      makeNote("note-unfiled", null, "Loose"),
      makeNote("note-filed", "bookprefix0000", "Filed"),
    ];
    const { host, key } = await connect({ library: { notes } as any });
    try {
      const answer = await callTool(host, key, "list_notes", { book: "Unfiled" });
      const text = textOf(answer);
      expect(text).toContain("Loose");
      expect(text).not.toContain("Filed");
    } finally {
      host.stop();
    }
  });

  it("book unfiled case-insensitive", async () => {
    const notes = [
      makeNote("note-unfiled", null, "Loose"),
      makeNote("note-filed", "bookprefix0000", "Filed"),
    ];
    const { host, key } = await connect({ library: { notes } as any });
    try {
      const answer = await callTool(host, key, "list_notes", { book: "unfiled" });
      const text = textOf(answer);
      expect(text).toContain("Loose");
      expect(text).not.toContain("Filed");
    } finally {
      host.stop();
    }
  });

  it("ambiguous book prefix error", async () => {
    const books = [
      makeBook("abcdefghi0-foo", 1000, { title: "Book0" }),
      makeBook("abcdefghi1-bar", 2000, { title: "Book1" }),
    ];
    const notes = [makeNote("note-a", "abcdefghi0-foo", "N")];
    const { host, key } = await connect({ library: { books, notes } as any });
    try {
      const answer = await callTool(host, key, "list_notes", { book: "abcdefghi" });
      expect(isError(answer)).toBe(true);
      const text = textOf(answer);
      expect(text).toContain("matches several Books");
    } finally {
      host.stop();
    }
  });

  it("unknown book error", async () => {
    const books = [makeBook("abcdefghi0-foo", 1000)];
    const notes = [makeNote("note-a", "abcdefghi0-foo", "N")];
    const { host, key } = await connect({ library: { books, notes } as any });
    try {
      const answer = await callTool(host, key, "list_notes", { book: "zzzzzzzz" });
      expect(isError(answer)).toBe(true);
      expect(textOf(answer)).toBe("No Book has the id zzzzzzzz; call list_books to see the Books.");
    } finally {
      host.stop();
    }
  });

  it("tag filter case-insensitive and trimmed", async () => {
    const notes = [
      makeNote("note-a", null, "Tagged", { tags: ["Foo"] }),
      makeNote("note-b", null, "Other", { tags: ["bar"] }),
    ];
    const { host, key } = await connect({ library: { notes } as any });
    try {
      const answer = await callTool(host, key, "list_notes", { tag: "  foo  " });
      const text = textOf(answer);
      expect(text).toContain("Tagged");
      expect(text).not.toContain("Other");
    } finally {
      host.stop();
    }
  });

  it("book and tag combined", async () => {
    const books = [makeBook("bookprefix0000", 1000)];
    const notes = [
      makeNote("note-a", "bookprefix0000", "Match", { tags: ["t"] }),
      makeNote("note-b", "bookprefix0000", "NoTag", { tags: ["other"] }),
      makeNote("note-c", null, "UnfiledTagged", { tags: ["t"] }),
    ];
    const { host, key } = await connect({ library: { books, notes } as any });
    try {
      const answer = await callTool(host, key, "list_notes", { book: "bookpref", tag: "t" });
      const text = textOf(answer);
      expect(text).toContain("Match");
      expect(text).not.toContain("NoTag");
      expect(text).not.toContain("UnfiledTagged");
    } finally {
      host.stop();
    }
  });

  it("paging 25 notes", async () => {
    const notes = Array.from({ length: 25 }, (_, i) =>
      makeNote(`note-${String(i).padStart(4, "0")}`, null, `Title ${i}`)
    );
    const { host, key } = await connect({ library: { notes } as any });
    try {
      const first = await callTool(host, key, "list_notes", {});
      const firstText = textOf(first);
      const firstLines = firstText.split("\n");
      expect(firstLines[0]).toBe("Notes 1-20 of 25");
      const moreLine = firstLines[firstLines.length - 1];
      const m = moreLine.match(/cursor "([^"]+)"/);
      expect(m).not.toBeNull();
      const cursor = m![1];

      const second = await callTool(host, key, "list_notes", { cursor });
      const secondLines = textOf(second).split("\n");
      expect(secondLines[0]).toBe("Notes 21-25 of 25");
      expect(textOf(second)).not.toContain("More:");
    } finally {
      host.stop();
    }
  });

  it("invalid cursor sentence", async () => {
    const notes = [makeNote("note-a", null, "A")];
    const { host, key } = await connect({ library: { notes } as any });
    try {
      const answer = await callTool(host, key, "list_notes", { cursor: btoa("999") });
      expect(isError(answer)).toBe(true);
      expect(textOf(answer)).toBe(
        "The cursor is not valid; call list_notes without a cursor to start again."
      );
    } finally {
      host.stop();
    }
  });

  it("empty -> No Notes match.", async () => {
    const { host, key } = await connect({ library: { notes: [] } as any });
    try {
      const answer = await callTool(host, key, "list_notes", {});
      expect(textOf(answer)).toBe("No Notes match.");
    } finally {
      host.stop();
    }
  });

  it("detail excerpts adds lines", async () => {
    const notes = [
      {
        ...makeNote("note-excerpt", null, "Ex"),
        content: { text: "  Hello   world  ", html: "<p>x</p>" },
      },
    ];
    const { host, key } = await connect({ library: { notes } as any });
    try {
      const answer = await callTool(host, key, "list_notes", { detail: "excerpts" });
      const lines = textOf(answer).split("\n");
      expect(lines[0]).toBe("Notes 1-1 of 1");
      expect(lines[2]).toBe("  Hello world");
    } finally {
      host.stop();
    }
  });

  it("detail excerpts none for empty text", async () => {
    const notes = [
      {
        ...makeNote("note-empty", null, "Empty"),
        content: { text: "   ", html: "<p></p>" },
      },
    ];
    const { host, key } = await connect({ library: { notes } as any });
    try {
      const answer = await callTool(host, key, "list_notes", { detail: "excerpts" });
      const lines = textOf(answer).split("\n");
      expect(lines).toHaveLength(2);
    } finally {
      host.stop();
    }
  });

  it("tutorial refusal", async () => {
    const { host, key } = await connect({ library: { notes: [] } as any });
    try {
      host.setLibraryAvailable(false);
      const answer = await callTool(host, key, "list_notes", {});
      expect(answer.status).toBe(503);
    } finally {
      host.stop();
    }
  });
});

describe("delete_note", () => {
  it("deletes a Book Note through the host's Delete path and returns its whole text and HTML", async () => {
    const books = [makeBook("bookalpha1", 1000, { title: "The Book" })];
    const body = Array.from({ length: 3000 }, (_, index) => `Line ${index}`).join("\n");
    const notes = [noteWithBody("notealpha1", "bookalpha1", "The Note", body, ["plot", "idea"])];
    const { host, key } = await connect({ library: { books, notes } as any });
    try {
      const answer = await callTool(host, key, "delete_note", { note: "notealpha1" });
      expect(isError(answer)).toBe(false);

      const [header, content, html] = answer.json.result.content;
      expect(header.text).toContain(
        "Deleted Note The Note through the normal Delete path, so a sync carries it the way it carries a Delete the author made. Its whole text follows, then its HTML; to restore it, call write_note with the html argument."
      );
      expect(header.text).toContain("Note notealph: The Note");
      expect(header.text).toContain("Book: bookalph  The Book");
      expect(header.text).toContain("Tags: plot, idea");
      // The whole text, never a window: the body is longer than a read window.
      expect(content.text).toBe(body);
      // The HTML restores formatting a plain-text write would lose.
      expect(html.text).toBe(`HTML:\n<p>${body}</p>`);

      // The test kit keeps the Library in memory and only its
      // `library.notes.delete` removes a row, so an empty list is the Delete
      // path and nothing else.
      const listed = await callTool(host, key, "list_notes", {});
      expect(textOf(listed)).toBe("No Notes match.");
      const reread = await callTool(host, key, "read_note", { note: "notealpha1" });
      expect(isError(reread)).toBe(true);
      expect(textOf(reread)).toBe(
        "No Note has the id notealpha1; call list_notes to see the Notes."
      );
      expect(host.checkpoints).toEqual([
        { bookId: "bookalpha1", label: "Before mcp-test edits", versionId: expect.any(String) },
      ]);
    } finally {
      host.stop();
    }
  });

  it("deletes an Unfiled Note without a Checkpoint", async () => {
    const books = [makeBook("bookalpha1", 1000, { title: "The Book" })];
    const notes = [noteWithBody("notealpha1", null, "Loose", "Body.")];
    const { host, key } = await connect({ library: { books, notes } as any });
    try {
      const answer = await callTool(host, key, "delete_note", { note: "notealpha1" });
      expect(isError(answer)).toBe(false);

      const [header, content, html] = answer.json.result.content;
      expect(header.text).toContain(
        "Deleted Note Loose through the normal Delete path, so a sync carries it the way it carries a Delete the author made. Its whole text follows, then its HTML; to restore it, call write_note with the html argument."
      );
      expect(header.text).toContain("Book: Unfiled");
      expect(header.text).toContain("Tags: none");
      expect(content.text).toBe("Body.");
      expect(html.text).toBe("HTML:\n<p>Body.</p>");
      const listed = await callTool(host, key, "list_notes", {});
      expect(textOf(listed)).toBe("No Notes match.");
      expect(host.checkpoints).toEqual([]);
    } finally {
      host.stop();
    }
  });

  it("refuses when the Checkpoint fails and leaves the Note", async () => {
    const books = [makeBook("bookalpha1", 1000, { title: "The Book" })];
    const notes = [noteWithBody("notealpha1", "bookalpha1", "The Note", "Body.")];
    const { host, key } = await connect({
      library: { books, notes } as any,
      checkpointError: "The Versions shelf is stuck.",
    });
    try {
      const answer = await callTool(host, key, "delete_note", { note: "notealpha1" });
      expect(isError(answer)).toBe(true);
      expect(textOf(answer)).toBe(
        "Could not take a Checkpoint of the Book before writing, so nothing changed; try again."
      );
      const listed = await callTool(host, key, "list_notes", {});
      expect(textOf(listed)).toContain("The Note");
      expect(host.checkpoints).toEqual([]);
    } finally {
      host.stop();
    }
  });

  it("refuses an unknown id without a Checkpoint", async () => {
    const books = [makeBook("bookalpha1", 1000, { title: "The Book" })];
    const notes = [noteWithBody("notealpha1", "bookalpha1", "The Note", "Body.")];
    const { host, key } = await connect({ library: { books, notes } as any });
    try {
      const answer = await callTool(host, key, "delete_note", { note: "zzzzzzzz" });
      expect(isError(answer)).toBe(true);
      expect(textOf(answer)).toBe("No Note has the id zzzzzzzz; call list_notes to see the Notes.");
      const listed = await callTool(host, key, "list_notes", {});
      expect(textOf(listed)).toContain("The Note");
      expect(host.checkpoints).toEqual([]);
    } finally {
      host.stop();
    }
  });
});
