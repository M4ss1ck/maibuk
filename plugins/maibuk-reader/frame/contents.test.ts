/**
 * The Reader Frame's Contents engine (#941), unit-tested in Node: the two pure
 * outline functions it exports. `flattenOutline` walks an outline depth-first
 * in draw order; `documentOutline` normalizes the TOC foliate hands the Frame.
 * The DOM half (`createContents`) stays at the Frame bundle seam, proven by
 * `frame.test.ts` and `frame-books.test.ts`.
 */

import { describe, expect, it } from "vitest";
import { documentOutline, flattenOutline, type OutlineItem } from "./contents";

/** A foliate-style outline: three levels, in the order the tree draws them. */
const NESTED: OutlineItem[] = [
  {
    title: "One",
    dest: "text/one.xhtml",
    items: [
      { title: "One A", dest: "text/one.xhtml#a", items: [] },
      {
        title: "One B",
        dest: "text/one.xhtml#b",
        items: [{ title: "One B i", dest: "text/one.xhtml#b1", items: [] }],
      },
    ],
  },
  { title: "Two", dest: "text/two.xhtml", items: [] },
];

describe("flattenOutline()", () => {
  it("flattens a nested outline depth-first, in draw order", () => {
    expect(flattenOutline(NESTED).map((entry) => entry.item.title)).toEqual([
      "One",
      "One A",
      "One B",
      "One B i",
      "Two",
    ]);
    expect(flattenOutline(NESTED).map((entry) => entry.item.dest)).toEqual([
      "text/one.xhtml",
      "text/one.xhtml#a",
      "text/one.xhtml#b",
      "text/one.xhtml#b1",
      "text/two.xhtml",
    ]);
  });

  it("yields nothing for an empty outline", () => {
    expect(flattenOutline([])).toEqual([]);
  });
});

describe("documentOutline()", () => {
  it("keeps each entry's label as the title, its href as the destination, and its nesting", () => {
    const toc = [
      { label: "Chapter One", href: "text/ch1.xhtml" },
      {
        label: "Chapter Two",
        href: "text/ch2.xhtml",
        subitems: [{ label: "Two, Part One", href: "text/ch2.xhtml#part1" }],
      },
    ];

    expect(documentOutline(toc)).toEqual([
      { title: "Chapter One", dest: "text/ch1.xhtml", items: [] },
      {
        title: "Chapter Two",
        dest: "text/ch2.xhtml",
        items: [{ title: "Two, Part One", dest: "text/ch2.xhtml#part1", items: [] }],
      },
    ]);
  });

  it("reads items when subitems is absent and prefers subitems when both are present", () => {
    const toc = [
      { label: "By items", href: "a", items: [{ label: "From items", href: "a1" }] },
      {
        label: "Both",
        href: "b",
        subitems: [{ label: "From subitems", href: "b1" }],
        items: [{ label: "Ignored", href: "b2" }],
      },
    ];

    expect(documentOutline(toc)).toEqual([
      { title: "By items", dest: "a", items: [{ title: "From items", dest: "a1", items: [] }] },
      { title: "Both", dest: "b", items: [{ title: "From subitems", dest: "b1", items: [] }] },
    ]);
  });

  it("turns a missing or non-string label into an empty title and passes an absent href through", () => {
    const toc = [{ href: "a" }, { label: 7, href: "b" }, { label: "No href" }];

    expect(documentOutline(toc)).toEqual([
      { title: "", dest: "a", items: [] },
      { title: "", dest: "b", items: [] },
      { title: "No href", dest: undefined, items: [] },
    ]);
  });

  it("yields an empty outline when the TOC is missing or not a list", () => {
    expect(documentOutline(undefined)).toEqual([]);
    expect(documentOutline("text/ch1.xhtml")).toEqual([]);
    expect(documentOutline({ label: "Not a list" })).toEqual([]);
    expect(documentOutline([])).toEqual([]);
  });
});
