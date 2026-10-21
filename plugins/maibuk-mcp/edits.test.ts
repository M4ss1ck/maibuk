/**
 * `edit_chapter` through the Plugin test kit: what the Agent sees and what the
 * Library holds afterwards. Find-and-replace runs on the stored HTML as a plain
 * string, so the untouched markup is asserted byte for byte.
 */

import { describe, expect, it } from "vitest";
import type { PluginClient } from "@/plugin-sdk";
import { PluginApiError } from "@/plugin-sdk";
import { connect, mcpRequest, type McpAnswer } from "./test-support";
import { editChapter, type WriteGuard } from "./edits";

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

function lastEditedOf(text: string): string {
  const line = text.split("\n").find((entry) => entry.startsWith("Last Edited: "));
  if (line === undefined) throw new Error(`No Last Edited line in ${JSON.stringify(text)}`);
  return line;
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

function makeChapter(
  id: string,
  bookId: string,
  title: string,
  content: { text: string; html: string },
  updatedAt = Date.UTC(2026, 0, 1)
) {
  return {
    id,
    bookId,
    title,
    order: 1,
    parentId: null,
    chapterType: "chapter" as const,
    wordCount: 10,
    status: "draft" as const,
    updatedAt,
    content,
  };
}

describe("edit_chapter", () => {
  it("replaces one match, leaving every other byte of the markup alone", async () => {
    const books = [makeBook("bookalpha1", 1000, "The Book")];
    const chapters = [
      makeChapter(
        "chapteralpha",
        "bookalpha1",
        "The Chapter",
        {
          html: '<p class="lead">The <em>quick</em> brown fox &amp; the lazy dog.</p><p>Second <strong>line</strong> with &lt;tags&gt;.</p>',
          text: "The quick brown fox & the lazy dog.\n\nSecond line with <tags>.",
        },
        Date.UTC(2026, 0, 1)
      ),
    ];
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      const answer = await callTool(host, key, "edit_chapter", {
        chapter: "chapteralpha",
        find: "brown fox",
        replace: "red fox",
      });
      expect(isError(answer)).toBe(false);

      const lines = textOf(answer).split("\n");
      expect(lines[0]).toBe("Replaced 1 match in Chapter The Chapter.");
      expect(lines[1]).toMatch(/^Last Edited: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

      expect(chapters[0].content.html).toBe(
        '<p class="lead">The <em>quick</em> red fox &amp; the lazy dog.</p><p>Second <strong>line</strong> with &lt;tags&gt;.</p>'
      );

      // The Agent passes the reported value back later: it is the one a fresh
      // read reports.
      const reread = await callTool(host, key, "read_chapter", { chapter: "chapteralpha" });
      expect(lastEditedOf(textOf(reread))).toBe(lines[1]);
    } finally {
      host.stop();
    }
  });

  it("appends text as the host's paragraphs: blank lines split, single newlines break", async () => {
    const books = [makeBook("bookalpha1", 1000)];
    const chapters = [
      makeChapter("chapteralpha", "bookalpha1", "The Chapter", {
        html: "<p>First.</p>",
        text: "First.",
      }),
    ];
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      const answer = await callTool(host, key, "edit_chapter", {
        chapter: "chapteralpha",
        append: "A new scene & more\nsame paragraph\n\nSecond paragraph",
      });
      expect(isError(answer)).toBe(false);
      expect(textOf(answer).split("\n")[0]).toBe("Appended to Chapter The Chapter.");
      expect(chapters[0].content.html).toBe(
        "<p>First.</p><p>A new scene &amp; more<br>same paragraph</p><p>Second paragraph</p>"
      );
    } finally {
      host.stop();
    }
  });

  it("appends an HTML fragment as given", async () => {
    const books = [makeBook("bookalpha1", 1000)];
    const chapters = [
      makeChapter("chapteralpha", "bookalpha1", "The Chapter", {
        html: "<p>First.</p>",
        text: "First.",
      }),
    ];
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      const answer = await callTool(host, key, "edit_chapter", {
        chapter: "chapteralpha",
        append: "<h2>Scene</h2><p>Body</p>",
        format: "html",
      });
      expect(isError(answer)).toBe(false);
      expect(textOf(answer).split("\n")[0]).toBe("Appended to Chapter The Chapter.");
      expect(chapters[0].content.html).toBe("<p>First.</p><h2>Scene</h2><p>Body</p>");
    } finally {
      host.stop();
    }
  });

  it("no match tells the Agent to read the Chapter as HTML", async () => {
    const books = [makeBook("bookalpha1", 1000)];
    const chapters = [
      makeChapter("chapteralpha", "bookalpha1", "The Chapter", {
        html: "<p>The quick fox.</p>",
        text: "The quick fox.",
      }),
    ];
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      const answer = await callTool(host, key, "edit_chapter", {
        chapter: "chapteralpha",
        find: "slow",
        replace: "quick",
      });
      expect(isError(answer)).toBe(true);
      expect(textOf(answer)).toContain("read the Chapter as HTML");
      expect(textOf(answer)).toContain("format html");
      expect(chapters[0].content.html).toBe("<p>The quick fox.</p>");
    } finally {
      host.stop();
    }
  });

  it("a find that crosses markup fails and points at the HTML read", async () => {
    const books = [makeBook("bookalpha1", 1000)];
    const chapters = [
      makeChapter("chapteralpha", "bookalpha1", "The Chapter", {
        html: "<p>hello <em>world</em></p>",
        text: "hello world",
      }),
    ];
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      const answer = await callTool(host, key, "edit_chapter", {
        chapter: "chapteralpha",
        find: "hello world",
        replace: "goodbye world",
      });
      expect(isError(answer)).toBe(true);
      expect(textOf(answer)).toMatch(/cross/i);
      expect(textOf(answer)).toContain("read the Chapter as HTML");
      expect(chapters[0].content.html).toBe("<p>hello <em>world</em></p>");
    } finally {
      host.stop();
    }
  });

  it("more than one match says how many and asks for more surrounding text", async () => {
    const books = [makeBook("bookalpha1", 1000)];
    const chapters = [
      makeChapter("chapteralpha", "bookalpha1", "The Chapter", {
        html: "<p>fox and fox</p>",
        text: "fox and fox",
      }),
    ];
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      const answer = await callTool(host, key, "edit_chapter", {
        chapter: "chapteralpha",
        find: "fox",
        replace: "wolf",
      });
      expect(isError(answer)).toBe(true);
      expect(textOf(answer)).toContain("2");
      expect(textOf(answer)).toContain("surrounding");
      expect(chapters[0].content.html).toBe("<p>fox and fox</p>");
    } finally {
      host.stop();
    }
  });

  it("ignores a find that only occurs inside a tag", async () => {
    const books = [makeBook("bookalpha1", 1000)];
    const chapters = [
      makeChapter("chapteralpha", "bookalpha1", "The Chapter", {
        html: "<p>hello <em>world</em></p>",
        text: "hello world",
      }),
    ];
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      const answer = await callTool(host, key, "edit_chapter", {
        chapter: "chapteralpha",
        find: "em",
        replace: "strong",
      });
      expect(isError(answer)).toBe(true);
      expect(textOf(answer)).toContain("No match");
      expect(textOf(answer)).toContain("format html");
      expect(chapters[0].content.html).toBe("<p>hello <em>world</em></p>");
    } finally {
      host.stop();
    }
  });

  it("ignores a find that only occurs inside an attribute", async () => {
    const books = [makeBook("bookalpha1", 1000)];
    const chapters = [
      makeChapter("chapteralpha", "bookalpha1", "The Chapter", {
        html: '<p class="lead" title="a>b">hello</p>',
        text: "hello",
      }),
    ];
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      const answer = await callTool(host, key, "edit_chapter", {
        chapter: "chapteralpha",
        find: "class",
        replace: "style",
      });
      expect(isError(answer)).toBe(true);
      expect(textOf(answer)).toContain("No match");
      expect(chapters[0].content.html).toBe('<p class="lead" title="a>b">hello</p>');
    } finally {
      host.stop();
    }
  });

  it("ignores a find that only occurs inside an entity", async () => {
    const books = [makeBook("bookalpha1", 1000)];
    const chapters = [
      makeChapter("chapteralpha", "bookalpha1", "The Chapter", {
        html: "<p>salt &amp; pepper</p>",
        text: "salt & pepper",
      }),
    ];
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      const answer = await callTool(host, key, "edit_chapter", {
        chapter: "chapteralpha",
        find: "amp",
        replace: "ampersand",
      });
      expect(isError(answer)).toBe(true);
      expect(textOf(answer)).toContain("No match");
      expect(chapters[0].content.html).toBe("<p>salt &amp; pepper</p>");
    } finally {
      host.stop();
    }
  });

  it("replaces only the text occurrence when the find also sits in tags", async () => {
    const books = [makeBook("bookalpha1", 1000)];
    const chapters = [
      makeChapter("chapteralpha", "bookalpha1", "The Chapter", {
        html: "<p>hop</p>",
        text: "hop",
      }),
    ];
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      const answer = await callTool(host, key, "edit_chapter", {
        chapter: "chapteralpha",
        find: "p",
        replace: "P",
      });
      expect(isError(answer)).toBe(false);
      expect(textOf(answer).split("\n")[0]).toBe("Replaced 1 match in Chapter The Chapter.");
      expect(chapters[0].content.html).toBe("<p>hoP</p>");
    } finally {
      host.stop();
    }
  });

  it("replaces a text run that sits next to a tag", async () => {
    const books = [makeBook("bookalpha1", 1000)];
    const chapters = [
      makeChapter("chapteralpha", "bookalpha1", "The Chapter", {
        html: "<p>First <em>word</em></p>",
        text: "First word",
      }),
    ];
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      const answer = await callTool(host, key, "edit_chapter", {
        chapter: "chapteralpha",
        find: "First",
        replace: "Second",
      });
      expect(isError(answer)).toBe(false);
      expect(chapters[0].content.html).toBe("<p>Second <em>word</em></p>");
    } finally {
      host.stop();
    }
  });

  it("matches a text run that contains a whole entity", async () => {
    const books = [makeBook("bookalpha1", 1000)];
    const chapters = [
      makeChapter("chapteralpha", "bookalpha1", "The Chapter", {
        html: "<p>salt &amp; pepper</p>",
        text: "salt & pepper",
      }),
    ];
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      const answer = await callTool(host, key, "edit_chapter", {
        chapter: "chapteralpha",
        find: "salt & pepper",
        replace: "salt & sugar",
      });
      expect(isError(answer)).toBe(false);
      expect(chapters[0].content.html).toBe("<p>salt &amp; sugar</p>");
    } finally {
      host.stop();
    }
  });

  it("matches a find containing & and < against the escaped stored text", async () => {
    const books = [makeBook("bookalpha1", 1000)];
    const chapters = [
      makeChapter("chapteralpha", "bookalpha1", "The Chapter", {
        html: "<p>Tom &amp; Jerry &lt;3</p>",
        text: "Tom & Jerry <3",
      }),
    ];
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      const ampersand = await callTool(host, key, "edit_chapter", {
        chapter: "chapteralpha",
        find: "Tom & Jerry",
        replace: "Tom and Jerry",
      });
      expect(isError(ampersand)).toBe(false);
      expect(chapters[0].content.html).toBe("<p>Tom and Jerry &lt;3</p>");

      const angle = await callTool(host, key, "edit_chapter", {
        chapter: "chapteralpha",
        find: "<3",
        replace: "<4",
      });
      expect(isError(angle)).toBe(false);
      expect(chapters[0].content.html).toBe("<p>Tom and Jerry &lt;4</p>");
    } finally {
      host.stop();
    }
  });

  it("resolves a Chapter by an 8-character prefix", async () => {
    const books = [makeBook("bookalpha1", 1000)];
    const chapters = [
      makeChapter("chapteralpha", "bookalpha1", "The Chapter", {
        html: "<p>body</p>",
        text: "body",
      }),
    ];
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      const answer = await callTool(host, key, "edit_chapter", {
        chapter: "chaptera",
        find: "body",
        replace: "text",
      });
      expect(isError(answer)).toBe(false);
      expect(chapters[0].content.html).toBe("<p>text</p>");
    } finally {
      host.stop();
    }
  });

  it.each([
    ["find and replace with append", { find: "a", replace: "b", append: "c" }, /not both/],
    ["find without replace", { find: "a" }, /find and replace together/],
    ["replace without find", { replace: "b" }, /find and replace together/],
    ["neither mode", {}, /find and replace together, or append/],
  ])("refuses %s", async (_case, args, message) => {
    const books = [makeBook("bookalpha1", 1000)];
    const chapters = [
      makeChapter("chapteralpha", "bookalpha1", "The Chapter", {
        html: "<p>a</p>",
        text: "a",
      }),
    ];
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      const answer = await callTool(host, key, "edit_chapter", {
        chapter: "chapteralpha",
        ...args,
      });
      expect(isError(answer)).toBe(true);
      expect(textOf(answer)).toMatch(message);
      expect(chapters[0].content.html).toBe("<p>a</p>");
    } finally {
      host.stop();
    }
  });

  it("an unknown id names get_book", async () => {
    const books = [makeBook("bookalpha1", 1000)];
    const chapters = [
      makeChapter("chapteralpha", "bookalpha1", "The Chapter", {
        html: "<p>body</p>",
        text: "body",
      }),
    ];
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      const answer = await callTool(host, key, "edit_chapter", {
        chapter: "zzzzzzzz",
        append: "more",
      });
      expect(isError(answer)).toBe(true);
      expect(textOf(answer)).toBe(
        "No Chapter has the id zzzzzzzz; call get_book to see the Chapters."
      );
    } finally {
      host.stop();
    }
  });

  it("tutorial refusal", async () => {
    const books = [makeBook("bookalpha1", 1000)];
    const chapters = [
      makeChapter("chapteralpha", "bookalpha1", "The Chapter", {
        html: "<p>body</p>",
        text: "body",
      }),
    ];
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      host.setLibraryAvailable(false);
      const answer = await callTool(host, key, "edit_chapter", {
        chapter: "chapteralpha",
        append: "more",
      });
      expect(answer.status).toBe(503);
    } finally {
      host.stop();
    }
  });
});

describe("write_chapter", () => {
  it("accepted when expectedLastEdited equals the Last Edited read_chapter reported", async () => {
    const books = [makeBook("bookalpha1", 1000, "The Book")];
    const chapters = [
      makeChapter(
        "chapteralpha",
        "bookalpha1",
        "The Chapter",
        { html: "<p>old</p>", text: "old" },
        Date.UTC(2026, 0, 1)
      ),
    ];
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      const reread = await callTool(host, key, "read_chapter", { chapter: "chapteralpha" });
      const lastEdited = textOf(reread)
        .split("\n")
        .find((entry) => entry.startsWith("Last Edited: "))!
        .replace("Last Edited: ", "");
      const answer = await callTool(host, key, "write_chapter", {
        chapter: "chapteralpha",
        expectedLastEdited: lastEdited,
        html: "<p>new content</p>",
      });
      expect(isError(answer)).toBe(false);
      expect(textOf(answer).startsWith("Replaced the whole of Chapter")).toBe(true);
      expect(chapters[0].content.html).toBe("<p>new content</p>");
    } finally {
      host.stop();
    }
  });

  it("text content becomes paragraphs", async () => {
    const books = [makeBook("bookalpha1", 1000)];
    const chapters = [
      makeChapter(
        "chapteralpha",
        "bookalpha1",
        "The Chapter",
        { html: "<p>old</p>", text: "old" },
        Date.UTC(2026, 0, 1)
      ),
    ];
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      const reread = await callTool(host, key, "read_chapter", { chapter: "chapteralpha" });
      const lastEdited = textOf(reread)
        .split("\n")
        .find((entry) => entry.startsWith("Last Edited: "))!
        .replace("Last Edited: ", "");
      const answer = await callTool(host, key, "write_chapter", {
        chapter: "chapteralpha",
        expectedLastEdited: lastEdited,
        text: "One\n\nTwo",
      });
      expect(isError(answer)).toBe(false);
      expect(chapters[0].content.html).toBe("<p>One</p><p>Two</p>");
    } finally {
      host.stop();
    }
  });

  it("html content is stored (sanitized by the kit)", async () => {
    const books = [makeBook("bookalpha1", 1000)];
    const chapters = [
      makeChapter(
        "chapteralpha",
        "bookalpha1",
        "The Chapter",
        { html: "<p>old</p>", text: "old" },
        Date.UTC(2026, 0, 1)
      ),
    ];
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      const reread = await callTool(host, key, "read_chapter", { chapter: "chapteralpha" });
      const lastEdited = textOf(reread)
        .split("\n")
        .find((entry) => entry.startsWith("Last Edited: "))!
        .replace("Last Edited: ", "");
      const answer = await callTool(host, key, "write_chapter", {
        chapter: "chapteralpha",
        expectedLastEdited: lastEdited,
        html: "<p>Hello <strong>world</strong></p>",
      });
      expect(isError(answer)).toBe(false);
      expect(chapters[0].content.html).toBe("<p>Hello <strong>world</strong></p>");
    } finally {
      host.stop();
    }
  });

  it("stale write refused", async () => {
    const books = [makeBook("bookalpha1", 1000)];
    const chapters = [
      makeChapter(
        "chapteralpha",
        "bookalpha1",
        "The Chapter",
        { html: "<p>old</p>", text: "old" },
        Date.UTC(2026, 0, 1)
      ),
    ];
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      const answer = await callTool(host, key, "write_chapter", {
        chapter: "chapteralpha",
        expectedLastEdited: new Date(Date.UTC(2020, 0, 1)).toISOString(),
        html: "<p>new</p>",
      });
      expect(isError(answer)).toBe(true);
      expect(textOf(answer)).toContain("changed since you read it");
      expect(chapters[0].content.html).toBe("<p>old</p>");
    } finally {
      host.stop();
    }
  });

  it("write after an edit_chapter uses the Last Edited edit_chapter returned", async () => {
    const books = [makeBook("bookalpha1", 1000)];
    const chapters = [
      makeChapter(
        "chapteralpha",
        "bookalpha1",
        "The Chapter",
        { html: "<p>old</p>", text: "old" },
        Date.UTC(2026, 0, 1)
      ),
    ];
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      const initialIso = new Date(Date.UTC(2026, 0, 1)).toISOString();
      const editAnswer = await callTool(host, key, "edit_chapter", {
        chapter: "chapteralpha",
        append: "more",
      });
      expect(isError(editAnswer)).toBe(false);
      const newLastEdited = textOf(editAnswer)
        .split("\n")
        .find((entry) => entry.startsWith("Last Edited: "))!
        .replace("Last Edited: ", "");

      const stale = await callTool(host, key, "write_chapter", {
        chapter: "chapteralpha",
        expectedLastEdited: initialIso,
        html: "<p>new</p>",
      });
      expect(isError(stale)).toBe(true);
      expect(textOf(stale)).toContain("changed since you read it");

      const ok = await callTool(host, key, "write_chapter", {
        chapter: "chapteralpha",
        expectedLastEdited: newLastEdited,
        html: "<p>new</p>",
      });
      expect(isError(ok)).toBe(false);
    } finally {
      host.stop();
    }
  });

  it("both text and html -> error; neither -> error", async () => {
    const books = [makeBook("bookalpha1", 1000)];
    const chapters = [
      makeChapter(
        "chapteralpha",
        "bookalpha1",
        "The Chapter",
        { html: "<p>old</p>", text: "old" },
        Date.UTC(2026, 0, 1)
      ),
    ];
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      const both = await callTool(host, key, "write_chapter", {
        chapter: "chapteralpha",
        expectedLastEdited: "x",
        text: "a",
        html: "<p>a</p>",
      });
      expect(isError(both)).toBe(true);
      expect(textOf(both)).toContain("Give the new content as text or as html");

      const neither = await callTool(host, key, "write_chapter", {
        chapter: "chapteralpha",
        expectedLastEdited: "x",
      });
      expect(isError(neither)).toBe(true);
      expect(textOf(neither)).toContain("Give the new content as text or as html");
    } finally {
      host.stop();
    }
  });
});

describe("write_chapter create mode", () => {
  function makeCBook(id: string, title = `Title ${id}`) {
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
      updatedAt: 1000,
    };
  }

  function makeCChapter(
    id: string,
    bookId: string,
    order: number,
    title: string,
    content = { text: "Body.", html: "<p>Body.</p>" }
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
      updatedAt: Date.UTC(2026, 0, 1) + order,
      content,
    };
  }

  /** One Book with three Chapters, in order, as `get_book` prints them. */
  function threeChapterLibrary() {
    const books = [makeCBook("bookalpha1", "The Book")];
    const chapters = [
      makeCChapter("chapteralpha", "bookalpha1", 0, "Alpha"),
      makeCChapter("chapterbravo", "bookalpha1", 1, "Bravo"),
      makeCChapter("chaptercharl", "bookalpha1", 2, "Charlie"),
    ];
    return { books, chapters };
  }

  /** The Book's Chapter titles in stored order, as a fresh `get_book` reports them. */
  async function orderTitles(host: any, key: string): Promise<string[]> {
    const answer = await callTool(host, key, "get_book", { book: "bookalpha1" });
    return textOf(answer)
      .split("\n")
      .filter((line) => /^\d+\. /.test(line))
      .map((line) => line.split("  ")[1]);
  }

  async function bookText(host: any, key: string): Promise<string> {
    const answer = await callTool(host, key, "get_book", { book: "bookalpha1" });
    return textOf(answer);
  }

  /** The created id at the end of the success sentence. */
  function createdId(text: string): string {
    const match = /its id is ([A-Za-z0-9-]+)\./.exec(text);
    if (!match) throw new Error(`No created id in ${JSON.stringify(text)}`);
    return match[1];
  }

  it("appends when position is omitted", async () => {
    const { books, chapters } = threeChapterLibrary();
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      const answer = await callTool(host, key, "write_chapter", {
        book: "bookalpha1",
        title: "Delta",
      });
      expect(isError(answer)).toBe(false);
      const sid = createdId(textOf(answer));
      expect(textOf(answer)).toBe(
        `Created Chapter Delta as chapter 4 of 4 in Book The Book; its id is ${sid}.`
      );
      expect(await orderTitles(host, key)).toEqual(["Alpha", "Bravo", "Charlie", "Delta"]);
    } finally {
      host.stop();
    }
  });

  it("creates at position 1, first", async () => {
    const { books, chapters } = threeChapterLibrary();
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      const answer = await callTool(host, key, "write_chapter", {
        book: "bookalpha1",
        title: "Opening",
        position: 1,
      });
      expect(isError(answer)).toBe(false);
      expect(textOf(answer)).toContain(
        "Created Chapter Opening as chapter 1 of 4 in Book The Book;"
      );
      expect(await orderTitles(host, key)).toEqual(["Opening", "Alpha", "Bravo", "Charlie"]);
    } finally {
      host.stop();
    }
  });

  it("creates at a middle position", async () => {
    const { books, chapters } = threeChapterLibrary();
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      const answer = await callTool(host, key, "write_chapter", {
        book: "bookalpha1",
        title: "Middle",
        position: 2,
      });
      expect(isError(answer)).toBe(false);
      expect(textOf(answer)).toContain(
        "Created Chapter Middle as chapter 2 of 4 in Book The Book;"
      );
      expect(await orderTitles(host, key)).toEqual(["Alpha", "Middle", "Bravo", "Charlie"]);
    } finally {
      host.stop();
    }
  });

  it("creates at N+1, last", async () => {
    const { books, chapters } = threeChapterLibrary();
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      const answer = await callTool(host, key, "write_chapter", {
        book: "bookalpha1",
        title: "Finale",
        position: 4,
      });
      expect(isError(answer)).toBe(false);
      expect(textOf(answer)).toContain(
        "Created Chapter Finale as chapter 4 of 4 in Book The Book;"
      );
      expect(await orderTitles(host, key)).toEqual(["Alpha", "Bravo", "Charlie", "Finale"]);
    } finally {
      host.stop();
    }
  });

  it("creates with text as the paragraphs replace mode would make", async () => {
    const { books, chapters } = threeChapterLibrary();
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      const answer = await callTool(host, key, "write_chapter", {
        book: "bookalpha1",
        title: "Typed",
        text: "One\n\nTwo",
      });
      expect(isError(answer)).toBe(false);
      const reread = await callTool(host, key, "read_chapter", {
        chapter: createdId(textOf(answer)),
        format: "html",
      });
      expect(isError(reread)).toBe(false);
      expect(reread.json.result.content[1].text).toBe("<p>One</p><p>Two</p>");
    } finally {
      host.stop();
    }
  });

  it("creates with html as given", async () => {
    const { books, chapters } = threeChapterLibrary();
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      const answer = await callTool(host, key, "write_chapter", {
        book: "bookalpha1",
        title: "Marked",
        html: "<h2>Scene</h2><p>Body</p>",
      });
      expect(isError(answer)).toBe(false);
      const reread = await callTool(host, key, "read_chapter", {
        chapter: createdId(textOf(answer)),
        format: "html",
      });
      expect(isError(reread)).toBe(false);
      expect(reread.json.result.content[1].text).toBe("<h2>Scene</h2><p>Body</p>");
    } finally {
      host.stop();
    }
  });

  it("creates with no content as an empty Chapter", async () => {
    const { books, chapters } = threeChapterLibrary();
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      const answer = await callTool(host, key, "write_chapter", {
        book: "bookalpha1",
        title: "Empty",
      });
      expect(isError(answer)).toBe(false);
      const reread = await callTool(host, key, "read_chapter", {
        chapter: createdId(textOf(answer)),
      });
      expect(isError(reread)).toBe(false);
      expect(reread.json.result.content[1].text).toBe("");
    } finally {
      host.stop();
    }
  });

  it("the returned short id resolves with read_chapter", async () => {
    const { books, chapters } = threeChapterLibrary();
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      const answer = await callTool(host, key, "write_chapter", {
        book: "bookalpha1",
        title: "Found",
        text: "Hello.",
      });
      expect(isError(answer)).toBe(false);
      const reread = await callTool(host, key, "read_chapter", {
        chapter: createdId(textOf(answer)),
      });
      expect(isError(reread)).toBe(false);
      expect(reread.json.result.content[0].text).toContain("Chapter ");
      expect(reread.json.result.content[0].text).toContain("Found");
      expect(reread.json.result.content[1].text).toBe("Hello.");
    } finally {
      host.stop();
    }
  });

  it.each([
    [
      "both book and chapter",
      { chapter: "chapteralpha", book: "bookalpha1", title: "X" },
      "Give chapter to replace a Chapter's content, or book and title to create a new Chapter, not both.",
    ],
    [
      "neither book nor chapter",
      { title: "X" },
      "Give chapter to replace a Chapter's content, or book and title to create a new Chapter; you gave neither.",
    ],
    [
      "create with expectedLastEdited",
      { book: "bookalpha1", title: "X", expectedLastEdited: "2026-01-01T00:00:00.000Z" },
      "expectedLastEdited is only for replacing a Chapter's content",
    ],
    ["create without a title", { book: "bookalpha1" }, "Give a title of at least one character"],
    [
      "create with a blank title",
      { book: "bookalpha1", title: "   " },
      "Give a title of at least one character",
    ],
    [
      "create with a title over 500 characters",
      { book: "bookalpha1", title: "x".repeat(501) },
      "A title can be at most 500 characters",
    ],
    [
      "create with both text and html",
      { book: "bookalpha1", title: "X", text: "a", html: "<p>a</p>" },
      "Give the new content as text or as html, not both",
    ],
    [
      "create at position 0",
      { book: "bookalpha1", title: "X", position: 0 },
      "Position must be a whole number from 1 to 4; call get_book to see the Chapter order.",
    ],
    [
      "create past N+1",
      { book: "bookalpha1", title: "X", position: 5 },
      "Position must be a whole number from 1 to 4; call get_book to see the Chapter order.",
    ],
    [
      "create at a non-integer position",
      { book: "bookalpha1", title: "X", position: 2.5 },
      "Position must be a whole number from 1 to 4; call get_book to see the Chapter order.",
    ],
    [
      "replace without expectedLastEdited",
      { chapter: "chapteralpha", html: "<p>new</p>" },
      "Give expectedLastEdited from read_chapter; call read_chapter first to get Last Edited.",
    ],
    [
      "unknown book",
      { book: "zzzzzzzz", title: "X" },
      "No Book has the id zzzzzzzz; call list_books to see the Books.",
    ],
  ])("refuses %s, leaving the Library and Checkpoints alone", async (_case, args, message) => {
    const { books, chapters } = threeChapterLibrary();
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      const before = await bookText(host, key);
      const beforeRows = JSON.stringify(chapters);
      const answer = await callTool(host, key, "write_chapter", args);
      expect(isError(answer)).toBe(true);
      expect(textOf(answer)).toContain(message);
      expect(await bookText(host, key)).toBe(before);
      expect(JSON.stringify(chapters)).toBe(beforeRows);
      expect(host.checkpoints).toEqual([]);
    } finally {
      host.stop();
    }
  });

  it("first create checkpoints once; a following manage_chapter or write_chapter takes none", async () => {
    const { books, chapters } = threeChapterLibrary();
    const { host, key } = await connect({ library: { books, chapters } as any });
    try {
      await mcpRequest(host, key, initializeBody());
      const created = await mcpRequest(
        host,
        key,
        toolsCall("write_chapter", {
          book: "bookalpha1",
          title: "Delta",
        })
      );
      expect(created.json?.result?.isError).not.toBe(true);
      expect(host.checkpoints).toHaveLength(1);
      expect(host.checkpoints[0].bookId).toBe("bookalpha1");

      const newId = createdId(created.json.result.content[0].text);
      const managed = await mcpRequest(
        host,
        key,
        toolsCall("manage_chapter", { chapter: newId, title: "Renamed" }, 3)
      );
      expect(managed.json?.result?.isError).not.toBe(true);

      const reread = await mcpRequest(host, key, toolsCall("read_chapter", { chapter: newId }, 4));
      const lastEdited = (reread.json.result.content[0].text as string)
        .split("\n")
        .find((entry: string) => entry.startsWith("Last Edited: "))!
        .replace("Last Edited: ", "");
      const replaced = await mcpRequest(
        host,
        key,
        toolsCall(
          "write_chapter",
          { chapter: newId, expectedLastEdited: lastEdited, html: "<p>new</p>" },
          5
        )
      );
      expect(replaced.json?.result?.isError).not.toBe(true);
      expect(host.checkpoints).toHaveLength(1);
      expect(await orderTitles(host, key)).toEqual(["Alpha", "Bravo", "Charlie", "Renamed"]);
    } finally {
      host.stop();
    }
  });
});

function makeNote(
  id: string,
  bookId: string | null,
  title: string,
  content = { text: "Old body.", html: "<p>Old body.</p>" },
  updatedAt = Date.UTC(2026, 0, 1),
  tags: string[] = []
) {
  return {
    id,
    bookId,
    title,
    language: "en",
    tags,
    wordCount: 10,
    updatedAt,
    content,
  };
}

/** The created id at the end of a `write_note` create sentence. */
function createdNoteId(text: string): string {
  const match = /its id is ([A-Za-z0-9-]+)\./.exec(text);
  if (!match) throw new Error(`No created id in ${JSON.stringify(text)}`);
  return match[1];
}

describe("write_note", () => {
  /** Two Books and one Note in the first, as the Agent finds them. */
  function noteLibrary() {
    const books = [
      makeBook("bookalpha1", 1000, "The Book"),
      makeBook("bookbeta12", 1000, "Other Book"),
    ];
    const notes = [makeNote("notealpha1", "bookalpha1", "The Note")];
    return { books, notes };
  }

  it("creates a Note in a Book and reports its id and Last Edited", async () => {
    const books = [makeBook("bookalpha1", 1000, "The Book")];
    const { host, key } = await connect({ library: { books } as any });
    try {
      const answer = await callTool(host, key, "write_note", {
        book: "bookalpha1",
        title: "Ideas",
        text: "One\n\nTwo",
      });
      expect(isError(answer)).toBe(false);
      expect(textOf(answer).split("\n")[0]).toMatch(
        /^Created Note Ideas in Book The Book; its id is \S{8,}\.$/
      );
      expect(lastEditedOf(textOf(answer))).toMatch(
        /^Last Edited: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
      );

      const reread = await callTool(host, key, "read_note", {
        note: createdNoteId(textOf(answer)),
      });
      expect(isError(reread)).toBe(false);
      expect(reread.json.result.content[0].text).toContain("Book:");
      expect(reread.json.result.content[0].text).toContain("The Book");
      expect(reread.json.result.content[1].text).toBe("One\n\nTwo");
      expect(lastEditedOf(reread.json.result.content[0].text)).toBe(
        lastEditedOf(textOf(answer))
      );
    } finally {
      host.stop();
    }
  });

  it("creates an Unfiled Note when no Book is given", async () => {
    const books = [makeBook("bookalpha1", 1000, "The Book")];
    const { host, key } = await connect({ library: { books } as any });
    try {
      const answer = await callTool(host, key, "write_note", { title: "Loose" });
      expect(isError(answer)).toBe(false);
      expect(textOf(answer).split("\n")[0]).toMatch(
        /^Created Note Loose as an Unfiled Note; its id is \S{8,}\.$/
      );

      const reread = await callTool(host, key, "read_note", {
        note: createdNoteId(textOf(answer)),
      });
      expect(reread.json.result.content[0].text).toContain("Book: Unfiled");
    } finally {
      host.stop();
    }
  });

  it("creates an Unfiled Note when book is null", async () => {
    const books = [makeBook("bookalpha1", 1000, "The Book")];
    const { host, key } = await connect({ library: { books } as any });
    try {
      const answer = await callTool(host, key, "write_note", { book: null, title: "Loose" });
      expect(isError(answer)).toBe(false);
      const reread = await callTool(host, key, "read_note", {
        note: createdNoteId(textOf(answer)),
      });
      expect(reread.json.result.content[0].text).toContain("Book: Unfiled");
    } finally {
      host.stop();
    }
  });

  it("creates a Note with no title as an Untitled one", async () => {
    const books = [makeBook("bookalpha1", 1000, "The Book")];
    const { host, key } = await connect({ library: { books } as any });
    try {
      const answer = await callTool(host, key, "write_note", { book: "bookalpha1" });
      expect(isError(answer)).toBe(false);
      expect(textOf(answer).split("\n")[0]).toMatch(/^Created Note Untitled in Book The Book;/);

      const reread = await callTool(host, key, "read_note", {
        note: createdNoteId(textOf(answer)),
      });
      expect(reread.json.result.content[0].text).toContain(": Untitled");
      expect(reread.json.result.content[1].text).toBe("");
    } finally {
      host.stop();
    }
  });

  it("sets Tags on a created Note", async () => {
    const books = [makeBook("bookalpha1", 1000, "The Book")];
    const { host, key } = await connect({ library: { books } as any });
    try {
      const answer = await callTool(host, key, "write_note", {
        title: "Tagged",
        tags: [" alpha ", "Beta", "alpha"],
      });
      expect(isError(answer)).toBe(false);
      const reread = await callTool(host, key, "read_note", {
        note: createdNoteId(textOf(answer)),
      });
      expect(reread.json.result.content[0].text).toContain("Tags: alpha, Beta");
    } finally {
      host.stop();
    }
  });

  it("replaces the whole Note when expectedLastEdited matches", async () => {
    const { books, notes } = noteLibrary();
    const { host, key } = await connect({ library: { books, notes } as any });
    try {
      const reread = await callTool(host, key, "read_note", { note: "notealpha1" });
      const answer = await callTool(host, key, "write_note", {
        note: "notealpha1",
        expectedLastEdited: lastEditedOf(textOf(reread)).replace("Last Edited: ", ""),
        html: "<p>New body.</p>",
      });
      expect(isError(answer)).toBe(false);
      expect(textOf(answer).split("\n")[0]).toBe("Replaced the whole of Note The Note.");
      expect(notes[0].content.html).toBe("<p>New body.</p>");

      const after = await callTool(host, key, "read_note", { note: "notealpha1" });
      expect(lastEditedOf(textOf(after))).toBe(lastEditedOf(textOf(answer)));
    } finally {
      host.stop();
    }
  });

  it("refuses a stale expectedLastEdited and writes nothing", async () => {
    const { books, notes } = noteLibrary();
    const { host, key } = await connect({ library: { books, notes } as any });
    try {
      const answer = await callTool(host, key, "write_note", {
        note: "notealpha1",
        expectedLastEdited: new Date(Date.UTC(2020, 0, 1)).toISOString(),
        html: "<p>New body.</p>",
      });
      expect(isError(answer)).toBe(true);
      expect(textOf(answer)).toContain("changed since you read it");
      expect(textOf(answer)).toContain("read_note again");
      expect(notes[0].content.html).toBe("<p>Old body.</p>");
      expect(host.checkpoints).toEqual([]);
    } finally {
      host.stop();
    }
  });

  it("refuses a replace with no expectedLastEdited", async () => {
    const { books, notes } = noteLibrary();
    const { host, key } = await connect({ library: { books, notes } as any });
    try {
      const answer = await callTool(host, key, "write_note", {
        note: "notealpha1",
        html: "<p>New body.</p>",
      });
      expect(isError(answer)).toBe(true);
      expect(textOf(answer)).toBe(
        "Give expectedLastEdited from read_note; call read_note first to get Last Edited."
      );
      expect(notes[0].content.html).toBe("<p>Old body.</p>");
      expect(host.checkpoints).toEqual([]);
    } finally {
      host.stop();
    }
  });

  it("changes only the title when only title is given", async () => {
    const { books, notes } = noteLibrary();
    const { host, key } = await connect({ library: { books, notes } as any });
    try {
      const reread = await callTool(host, key, "read_note", { note: "notealpha1" });
      const answer = await callTool(host, key, "write_note", {
        note: "notealpha1",
        expectedLastEdited: lastEditedOf(textOf(reread)).replace("Last Edited: ", ""),
        title: "Renamed",
      });
      expect(isError(answer)).toBe(false);
      expect(notes[0].title).toBe("Renamed");
      expect(notes[0].content.html).toBe("<p>Old body.</p>");
      expect(textOf(answer).split("\n")[0]).toBe("Replaced the whole of Note Renamed.");
    } finally {
      host.stop();
    }
  });

  it("sets Tags on a whole replace", async () => {
    const { books, notes } = noteLibrary();
    const { host, key } = await connect({ library: { books, notes } as any });
    try {
      const reread = await callTool(host, key, "read_note", { note: "notealpha1" });
      const answer = await callTool(host, key, "write_note", {
        note: "notealpha1",
        expectedLastEdited: lastEditedOf(textOf(reread)).replace("Last Edited: ", ""),
        tags: ["plot", "plot", "idea"],
      });
      expect(isError(answer)).toBe(false);
      expect(notes[0].tags).toEqual(["plot", "idea"]);
    } finally {
      host.stop();
    }
  });

  it("moves a Note to another Book", async () => {
    const { books, notes } = noteLibrary();
    const { host, key } = await connect({ library: { books, notes } as any });
    try {
      const reread = await callTool(host, key, "read_note", { note: "notealpha1" });
      const answer = await callTool(host, key, "write_note", {
        note: "notealpha1",
        expectedLastEdited: lastEditedOf(textOf(reread)).replace("Last Edited: ", ""),
        book: "bookbeta12",
      });
      expect(isError(answer)).toBe(false);
      expect(notes[0].bookId).toBe("bookbeta12");
      expect(textOf(answer).split("\n")[0]).toBe(
        "Replaced the whole of Note The Note. It is now in Book Other Book."
      );
    } finally {
      host.stop();
    }
  });

  it("moves a Note to Unfiled when book is null", async () => {
    const { books, notes } = noteLibrary();
    const { host, key } = await connect({ library: { books, notes } as any });
    try {
      const reread = await callTool(host, key, "read_note", { note: "notealpha1" });
      const answer = await callTool(host, key, "write_note", {
        note: "notealpha1",
        expectedLastEdited: lastEditedOf(textOf(reread)).replace("Last Edited: ", ""),
        book: null,
      });
      expect(isError(answer)).toBe(false);
      expect(notes[0].bookId).toBeNull();
      expect(textOf(answer).split("\n")[0]).toBe(
        "Replaced the whole of Note The Note. It is now an Unfiled Note."
      );
    } finally {
      host.stop();
    }
  });

  it.each([
    ["both text and html", { text: "a", html: "<p>a</p>" }, /not both/],
    [
      "create with expectedLastEdited",
      { title: "X", expectedLastEdited: "2026-01-01T00:00:00.000Z" },
      /expectedLastEdited is only for replacing a Note/,
    ],
    [
      "replace with nothing to change",
      { note: "notealpha1", expectedLastEdited: "2026-01-01T00:00:00.000Z" },
      /Give text or html content, a title, Tags, or a Book/,
    ],
    [
      "unknown Book",
      { book: "zzzzzzzz", title: "X" },
      /No Book has the id zzzzzzzz; call list_books/,
    ],
    [
      "unknown Note",
      { note: "zzzzzzzz", expectedLastEdited: "2026-01-01T00:00:00.000Z", html: "<p>a</p>" },
      /No Note has the id zzzzzzzz; call list_notes/,
    ],
  ])("refuses %s, leaving the Library and Checkpoints alone", async (_case, args, message) => {
    const { books, notes } = noteLibrary();
    const { host, key } = await connect({ library: { books, notes } as any });
    try {
      const before = JSON.stringify(notes);
      const answer = await callTool(host, key, "write_note", args);
      expect(isError(answer)).toBe(true);
      expect(textOf(answer)).toMatch(message);
      expect(JSON.stringify(notes)).toBe(before);
      expect(host.checkpoints).toEqual([]);
    } finally {
      host.stop();
    }
  });
});

describe("edit_chapter read-only race", () => {
  const READ_ONLY_TEXT =
    "The author made this Plugin read-only, so it cannot change the Library; use the read tools.";

  /** A Plugin client the host refuses with permission-denied on the write. */
  function refusedClient() {
    const book = {
      id: "bookalpha1",
      title: "The Book",
      subtitle: null,
      authorName: "Author",
      genre: null,
      language: "en",
      wordCount: 100,
      targetWordCount: null,
      status: "draft" as const,
      updatedAt: 1000,
    };
    const summary = {
      id: "chapteralpha",
      bookId: "bookalpha1",
      title: "The Chapter",
      order: 1,
      parentId: null,
      chapterType: "chapter" as const,
      wordCount: 10,
      status: "draft" as const,
      updatedAt: Date.UTC(2026, 0, 1),
    };
    return {
      library: {
        books: { list: async () => [book] },
        chapters: {
          list: async () => [summary],
          get: async () => ({
            ...summary,
            content: { html: "<p>Alpha body.</p>", text: "Alpha body." },
          }),
          updateContent: async () => {
            throw new PluginApiError({
              code: "permission-denied",
              permission: "library:write",
              message: "Library write needs library:write.",
            });
          },
        },
      },
    } as unknown as PluginClient;
  }

  it("answers the read-only text when the host refuses the write mid-call", async () => {
    // The Plugin still thinks it can write (the Checkpoint guard passes), but
    // the host revoked library:write after the tool list was served.
    const guard: WriteGuard = { ensureCheckpoint: async () => null };
    const result = await editChapter(
      refusedClient(),
      { chapter: "chapteralpha", append: "More." },
      guard
    );
    expect(result).toEqual({
      content: [{ type: "text", text: READ_ONLY_TEXT }],
      isError: true,
    });
  });
});
