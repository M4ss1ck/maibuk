// @vitest-environment jsdom
/**
 * The Reader Frame's Flowing engine (#941), unit-tested in jsdom: the pure text
 * and page-count kernels `createFlow` and Find share with the Frame. The
 * character offsets are the ones the Frame already counts, over the same
 * non-empty text nodes, asserted literally: an offset exactly on a node's end
 * stays in that node, one past it crosses to the next, and an offset past the
 * whole body collapses at the end of the last node. The page-count kernel is
 * the arithmetic `flowPageCount` applies to a measured column width, with
 * `FLOW_GAP` between columns. The DOM half (`createFlow`) stays at the Frame
 * bundle seam, proven by `frame.test.ts` and `frame-books.test.ts`.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { flowPageCountForWidth, rangeForCharOffset, textLength, textNodes } from "./flow";

/** Two paragraphs of known text, the body every offset test reads. */
let body: HTMLElement;

beforeAll(() => {
  body = document.createElement("div");
  body.innerHTML = "<p>Hello</p><p>World</p>";
});

/** The text nodes of the fixture body, in document order. */
function nodes(): Text[] {
  return textNodes(body);
}

describe("textNodes() and textLength()", () => {
  it("walks the non-empty text nodes under a body, in document order", () => {
    expect(nodes().map((node) => node.nodeValue)).toEqual(["Hello", "World"]);
  });

  it("counts the total length of a body's text", () => {
    expect(textLength(nodes())).toBe(10);
  });

  it("counts 0 when the body holds no text", () => {
    const empty = document.createElement("div");
    expect(textLength(textNodes(empty))).toBe(0);
  });
});

describe("rangeForCharOffset()", () => {
  it("collapses at the start of the body for offset 0", () => {
    const range = rangeForCharOffset(document, body, 0);
    expect(range?.collapsed).toBe(true);
    expect(range?.startContainer).toBe(nodes()[0]);
    expect(range?.startOffset).toBe(0);
  });

  it("lands mid-node at the character asked for", () => {
    const range = rangeForCharOffset(document, body, 3);
    expect(range?.startContainer).toBe(nodes()[0]);
    expect(range?.startOffset).toBe(3);
  });

  it("stays at the end of a node when the offset is exactly its length", () => {
    const range = rangeForCharOffset(document, body, 5);
    expect(range?.startContainer).toBe(nodes()[0]);
    expect(range?.startOffset).toBe(5);
  });

  it("crosses into the next text node one character past a boundary", () => {
    const range = rangeForCharOffset(document, body, 6);
    expect(range?.startContainer).toBe(nodes()[1]);
    expect(range?.startOffset).toBe(1);
  });

  it("lands at the end of the last node at the total length", () => {
    const range = rangeForCharOffset(document, body, 10);
    expect(range?.startContainer).toBe(nodes()[1]);
    expect(range?.startOffset).toBe(5);
  });

  it("clamps a negative offset to the start", () => {
    const range = rangeForCharOffset(document, body, -3);
    expect(range?.startContainer).toBe(nodes()[0]);
    expect(range?.startOffset).toBe(0);
  });

  it("collapses at the end of the last node for an offset past the text", () => {
    const range = rangeForCharOffset(document, body, 99);
    expect(range?.collapsed).toBe(true);
    expect(range?.startContainer).toBe(nodes()[1]);
    expect(range?.startOffset).toBe(5);
  });

  it("returns null when the body holds no text", () => {
    const empty = document.createElement("div");
    expect(rangeForCharOffset(document, empty, 0)).toBeNull();
  });
});

describe("flowPageCountForWidth()", () => {
  it("reports one page for a single column or an empty measurement", () => {
    expect(flowPageCountForWidth(300, 300, 40)).toBe(1);
    expect(flowPageCountForWidth(0, 300, 40)).toBe(1);
  });

  it("counts exactly fitting columns with the gap between them", () => {
    // Three 300 px columns and the two 40 px gutters between them.
    expect(flowPageCountForWidth(3 * 300 + 2 * 40, 300, 40)).toBe(3);
  });

  it("adds a page when the remainder passes half a stride", () => {
    // Three columns plus 200 px: (1180 + 40) / (300 + 40) = 3.588.
    expect(flowPageCountForWidth(1180, 300, 40)).toBe(4);
  });

  it("keeps the page when the remainder stays under half a stride", () => {
    // Three columns plus 100 px: (1080 + 40) / (300 + 40) = 3.294.
    expect(flowPageCountForWidth(1080, 300, 40)).toBe(3);
  });

  it("counts one page for a width just past the first column", () => {
    // One column plus one gutter: (340 + 40) / (300 + 40) = 1.117.
    expect(flowPageCountForWidth(340, 300, 40)).toBe(1);
  });

  it("uses the gap in the arithmetic, so the same width can count differently", () => {
    // 300 over a 200 px column is 1.5 and rounds up with no gap; with a 40 px
    // gap it is (300 + 40) / (200 + 40) = 1.417 and rounds down.
    expect(flowPageCountForWidth(300, 200, 0)).toBe(2);
    expect(flowPageCountForWidth(300, 200, 40)).toBe(1);
  });
});
