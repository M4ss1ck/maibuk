// src/test/unit/features/links/link-resolver.test.ts
import { describe, expect, it } from "vitest";
import { resolveLink, type ResolverData } from "@/features/links/link-resolver";

const data: ResolverData = {
  notes: [{ id: "n1", title: "My Note" }],
  books: [{ id: "b1", title: "My Book" }],
  chapters: [{ id: "c1", bookId: "b1", title: "Chapter One" }],
  headings: [{ id: "h-1", chapterId: "c1", text: "A Section" }],
};

describe("resolveLink", () => {
  it("resolves by URI id", () => {
    expect(resolveLink("maibuk://note/n1", undefined, data)).toMatchObject({
      type: "note",
      id: "n1",
      title: "My Note",
      exists: true,
    });
    expect(resolveLink("maibuk://heading/c1/h-1", undefined, data)).toMatchObject({
      type: "heading",
      id: "c1",
      headingId: "h-1",
      bookId: "b1",
      exists: true,
    });
    expect(resolveLink("maibuk://chapter/c1", undefined, data)).toMatchObject({
      type: "chapter",
      id: "c1",
      bookId: "b1",
      exists: true,
    });
    expect(resolveLink("maibuk://note-heading/n1/h-1", undefined, data)).toBeNull(); // no such heading stored, but parses
  });

  it("falls back to label when URI id is gone", () => {
    const resolved = resolveLink("maibuk://note/missing", "My Note", data);
    expect(resolved).toMatchObject({ type: "note", id: "n1", exists: true });
  });

  it("resolves a raw title in priority order notes->books->chapters->headings", () => {
    expect(resolveLink("My Book", undefined, data)).toMatchObject({
      type: "book",
      id: "b1",
    });
    expect(resolveLink("A Section", undefined, data)).toMatchObject({
      type: "heading",
      id: "c1",
      headingId: "h-1",
    });
  });

  it("returns null when nothing matches", () => {
    expect(resolveLink("maibuk://note/missing", "Ghost", data)).toBeNull();
    expect(resolveLink("Nonexistent", undefined, data)).toBeNull();
  });

  it("rejects old staged book/chapter URIs as malformed (parse returns null)", () => {
    // These were the staged shapes that broke stored links; they must now be rejected
    expect(resolveLink("maibuk://book/other/chapter/c1", undefined, data)).toBeNull();
    expect(resolveLink("maibuk://book/b1/chapter/c1", undefined, data)).toBeNull();
    expect(resolveLink("maibuk://book/b1/chapter/c1/heading/h-1", undefined, data)).toBeNull();
    expect(resolveLink("maibuk://note/n1/heading/h-1", undefined, data)).toBeNull();
  });

  it("resolves encoded heading ids", () => {
    const tricky = "a/b c";
    const encoded = encodeURIComponent(tricky);
    // Add a heading with tricky id to data
    const data2: ResolverData = {
      ...data,
      headings: [...data.headings, { id: tricky, chapterId: "c1", text: "Tricky" }],
    };
    expect(resolveLink(`maibuk://heading/c1/${encoded}`, undefined, data2)).toMatchObject({
      type: "heading",
      id: "c1",
      headingId: tricky,
    });
  });
});
