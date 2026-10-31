import { describe, expect, it } from "vitest";
import {
  bookFieldBlocks,
  canvasBlocks,
  chapterContentBlocks,
  noteContentBlocks,
} from "@/features/search/extract";

describe("chapterContentBlocks()", () => {
  it("returns one row per editor block", () => {
    expect(chapterContentBlocks("<p>First paragraph</p><p>Second paragraph</p>")).toEqual([
      { field: "content", blockIndex: 0, text: "First paragraph" },
      { field: "content", blockIndex: 1, text: "Second paragraph" },
    ]);
  });

  it("keeps a hard break inside its block so a match can cross it", () => {
    const blocks = chapterContentBlocks("<p>line one<br>line two</p>");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toContain("line one");
    expect(blocks[0].text).toContain("line two");
  });

  it("keeps headings and list items in separate blocks", () => {
    const blocks = chapterContentBlocks("<h2>A heading</h2><ul><li>One</li><li>Two</li></ul>");
    expect(blocks.map((block) => block.text.split("\n")[0])).toEqual(["A heading", "One", "Two"]);
  });

  it("skips empty blocks and returns nothing for null or blank content", () => {
    expect(chapterContentBlocks(null)).toEqual([]);
    expect(chapterContentBlocks("")).toEqual([]);
    expect(chapterContentBlocks("<p></p><p></p>")).toEqual([]);
  });
});

describe("noteContentBlocks()", () => {
  it("extracts Note editor HTML the same way as a Chapter", () => {
    expect(noteContentBlocks("<p>Note line</p><p>Another</p>")).toEqual([
      { field: "content", blockIndex: 0, text: "Note line" },
      { field: "content", blockIndex: 1, text: "Another" },
    ]);
  });
});

describe("canvasBlocks()", () => {
  it("indexes text nodes and ignores note references and edges", () => {
    const blocks = canvasBlocks({
      schemaVersion: 1,
      nodes: [
        { id: "n1", kind: "text", html: "<p>Card one</p><p>Card one b</p>" },
        { id: "n2", kind: "noteRef", noteId: "note-1" },
        { id: "n3", kind: "text", html: "<p>Card two</p>" },
      ],
      edges: [{ id: "e1", source: "n1", target: "n3", label: "Edge label" }],
    });
    expect(blocks).toEqual([
      { field: "card", blockIndex: 0, text: "Card one" },
      { field: "card", blockIndex: 1, text: "Card one b" },
      { field: "card", blockIndex: 2, text: "Card two" },
    ]);
  });

  it("returns nothing for a malformed doc", () => {
    expect(canvasBlocks(null)).toEqual([]);
    expect(canvasBlocks("not a doc")).toEqual([]);
    expect(canvasBlocks({ nodes: "nope" })).toEqual([]);
  });
});

describe("bookFieldBlocks()", () => {
  it("indexes title, subtitle, and description only", () => {
    expect(
      bookFieldBlocks({
        title: "The Title",
        subtitle: "A Subtitle",
        description: "First line\nSecond line",
      })
    ).toEqual([
      { field: "title", blockIndex: 0, text: "The Title" },
      { field: "subtitle", blockIndex: 0, text: "A Subtitle" },
      { field: "description", blockIndex: 0, text: "First line" },
      { field: "description", blockIndex: 1, text: "Second line" },
    ]);
  });

  it("omits empty fields", () => {
    expect(bookFieldBlocks({ title: "", subtitle: null, description: undefined })).toEqual([]);
  });
});
