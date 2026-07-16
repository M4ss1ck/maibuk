import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";

import { buildSearchRegExp, findMatches } from "@/components/editor/extensions/SearchReplace";

function makeEditor(content: string) {
  return new Editor({ extensions: [StarterKit], content });
}

const opts = (over: Partial<Parameters<typeof findMatches>[2]> = {}) => ({
  caseSensitive: false,
  wholeWord: false,
  regex: false,
  ...over,
});

describe("findMatches", () => {
  it("returns no matches for an empty term", () => {
    const editor = makeEditor("<p>hello world</p>");
    expect(findMatches(editor.state.doc, "", opts())).toHaveLength(0);
    editor.destroy();
  });

  it("finds all case-insensitive matches by default", () => {
    const editor = makeEditor("<p>The cat sat on the Cat</p>");
    const matches = findMatches(editor.state.doc, "cat", opts());
    expect(matches).toHaveLength(2);
    editor.destroy();
  });

  it("respects case sensitivity", () => {
    const editor = makeEditor("<p>The cat sat on the Cat</p>");
    const matches = findMatches(editor.state.doc, "Cat", opts({ caseSensitive: true }));
    expect(matches).toHaveLength(1);
    editor.destroy();
  });

  it("matches whole words only", () => {
    const editor = makeEditor("<p>cat category cat</p>");
    const matches = findMatches(editor.state.doc, "cat", opts({ wholeWord: true }));
    expect(matches).toHaveLength(2);
    editor.destroy();
  });

  it("supports regular expressions", () => {
    const editor = makeEditor("<p>a1 b2 c3</p>");
    const matches = findMatches(editor.state.doc, "[a-z]\\d", opts({ regex: true }));
    expect(matches).toHaveLength(3);
    editor.destroy();
  });

  it("treats the term literally when regex is off", () => {
    const editor = makeEditor("<p>price is $5 (a.b)</p>");
    expect(findMatches(editor.state.doc, "a.b", opts())).toHaveLength(1);
    expect(findMatches(editor.state.doc, "$5", opts())).toHaveLength(1);
    editor.destroy();
  });

  it("returns positions that map to the matched text", () => {
    const editor = makeEditor("<p>hello world</p>");
    const [match] = findMatches(editor.state.doc, "world", opts());
    expect(editor.state.doc.textBetween(match.from, match.to)).toBe("world");
    editor.destroy();
  });

  it("does not hang on zero-width regex matches", () => {
    const editor = makeEditor("<p>abc</p>");
    const matches = findMatches(editor.state.doc, "x*", opts({ regex: true }));
    expect(matches).toHaveLength(0);
    editor.destroy();
  });

  it("returns an empty array for an invalid regex", () => {
    const editor = makeEditor("<p>abc</p>");
    expect(findMatches(editor.state.doc, "[unclosed", opts({ regex: true }))).toHaveLength(0);
    editor.destroy();
  });
});

describe("buildSearchRegExp", () => {
  it("throws on an invalid pattern", () => {
    expect(() =>
      buildSearchRegExp("[unclosed", {
        caseSensitive: false,
        wholeWord: false,
        regex: true,
      })
    ).toThrow();
  });
});
