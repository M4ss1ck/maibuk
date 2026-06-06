import { describe, expect, it } from "vitest";
import { buildWikilinkCandidates } from "../../../../features/links/wikilink-targets";

const data = {
  notes: [{ id: "n1", title: "Alpha Note" }],
  books: [{ id: "b1", title: "Alpha Book" }],
  chapters: [{ id: "c1", bookId: "b1", title: "Beta Chapter" }],
  headings: [{ chapterId: "c1", id: "h-1", text: "Alpha Section" }],
};

describe("buildWikilinkCandidates", () => {
  it("orders notes, books, chapters, headings and filters by query", () => {
    const result = buildWikilinkCandidates("alpha", data);
    expect(result.map((c) => c.kind)).toEqual([
      "note",
      "book",
      "heading",
      "createNote",
    ]);
    expect(result[0]).toMatchObject({
      kind: "note",
      id: "n1",
      label: "Alpha Note",
    });
  });

  it("always appends a createNote entry using the raw query", () => {
    const result = buildWikilinkCandidates("Totally New", data);
    expect(result[result.length - 1]).toEqual({ kind: "createNote", label: "Totally New" });
  });

  it("returns no createNote entry for an empty query", () => {
    const result = buildWikilinkCandidates("", data);
    expect(result.some((c) => c.kind === "createNote")).toBe(false);
  });
});
