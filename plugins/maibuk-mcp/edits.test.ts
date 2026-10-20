/**
 * `edit_chapter` through the Plugin test kit: what the Agent sees and what the
 * Library holds afterwards. Find-and-replace runs on the stored HTML as a plain
 * string, so the untouched markup is asserted byte for byte.
 */

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
