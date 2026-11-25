/**
 * The Reader Frame's Reading Position engine (#941), unit-tested in Node: the
 * two pure fraction helpers it exports and the message `createPosition` builds
 * for each view. The fractions are the ones the Frame reports today, asserted
 * literally: a section's fraction is `pageIndex / pages` (not
 * `pageIndex / (pages - 1)`), a Document's fraction is the section index plus
 * that page fraction over the section count, clamped to 0..1, and anything
 * missing (no Flowing layout, no Document, a section of one page or none)
 * reports 0. The debounce and the timer stay at the Frame bundle seam, proven
 * by `frame.test.ts` and `frame-books.test.ts`.
 */

import { describe, expect, it } from "vitest";
import {
  createPosition,
  flowFraction,
  flowPageFraction,
  type FramePositionDeps,
  type FlowPositionGeometry,
} from "./position";

/** A Flowing layout: `pages` columns into section `index`, showing `pageIndex`. */
function flowGeometry(index: number, pageIndex: number, pages: number): FlowPositionGeometry {
  return { index, pageIndex, pages };
}

/** The accessors `createPosition` reads, in a fixed view, for message tests. */
function deps(overrides: Partial<FramePositionDeps> = {}): FramePositionDeps {
  return {
    post: () => {},
    debounceMs: 1000,
    hasDocument: () => true,
    flowing: () => false,
    flow: () => null,
    flowCfi: () => null,
    sections: () => null,
    pageIndex: () => 0,
    zoom: () => "width",
    pdfPageCount: () => null,
    ...overrides,
  };
}

describe("flowPageFraction()", () => {
  it("reports the first page of a section as 0", () => {
    expect(flowPageFraction(flowGeometry(0, 0, 10))).toBe(0);
  });

  it("divides the page index by the page count", () => {
    expect(flowPageFraction(flowGeometry(0, 4, 10))).toBe(0.4);
  });

  it("never reaches 1 on the last page, because the count is the divisor", () => {
    expect(flowPageFraction(flowGeometry(0, 9, 10))).toBe(0.9);
  });

  it("reports 0 for a single-page section", () => {
    expect(flowPageFraction(flowGeometry(0, 0, 1))).toBe(0);
  });

  it("reports 0 when the layout is missing or has no pages", () => {
    expect(flowPageFraction(null)).toBe(0);
    expect(flowPageFraction(undefined)).toBe(0);
    expect(flowPageFraction(flowGeometry(0, 0, 0))).toBe(0);
  });
});

describe("flowFraction()", () => {
  it("reports the start of the first section as 0", () => {
    expect(flowFraction(flowGeometry(0, 0, 10), 10)).toBe(0);
  });

  it("adds the page fraction to the section index over the section count", () => {
    // (4 + 5/10) / 10
    expect(flowFraction(flowGeometry(4, 5, 10), 10)).toBe(0.45);
  });

  it("reports the last page of the last section as section fraction, not 1", () => {
    // (9 + 9/10) / 10
    expect(flowFraction(flowGeometry(9, 9, 10), 10)).toBeCloseTo(0.99, 10);
  });

  it("reports 0 for a one-section Document on its first page", () => {
    expect(flowFraction(flowGeometry(0, 0, 5), 1)).toBe(0);
  });

  it("treats a Document with no sections as one, so the first page reports 0", () => {
    expect(flowFraction(flowGeometry(0, 0, 3), 0)).toBe(0);
  });

  it("clamps a fraction beyond either end into 0..1", () => {
    expect(flowFraction(flowGeometry(5, 0, 1), 2)).toBe(1);
    expect(flowFraction(flowGeometry(-1, 0, 1), 2)).toBe(0);
  });

  it("reports 0 when the layout or the Document is missing", () => {
    expect(flowFraction(null, 10)).toBe(0);
    expect(flowFraction(undefined, 10)).toBe(0);
    expect(flowFraction(flowGeometry(0, 0, 10), null)).toBe(0);
    expect(flowFraction(flowGeometry(0, 0, 10), undefined)).toBe(0);
  });
});

describe("createPosition().message()", () => {
  it("reports a Flowing Document by CFI and whole-Document fraction", () => {
    const message = createPosition(
      deps({
        flowing: () => true,
        flow: () => flowGeometry(2, 1, 4),
        flowCfi: () => "epubcfi(/6/8!/4/2)",
        sections: () => 10,
      })
    ).message();
    expect(message).toEqual({
      kind: "position",
      position: { kind: "cfi", cfi: "epubcfi(/6/8!/4/2)" },
      // (2 + 1/4) / 10
      progress: { fraction: 0.225 },
    });
  });

  it("reports a Flowing Document without a CFI by section and page fraction", () => {
    const message = createPosition(
      deps({
        flowing: () => true,
        flow: () => flowGeometry(2, 1, 4),
        sections: () => 10,
      })
    ).message();
    expect(message).toEqual({
      kind: "position",
      position: { kind: "section", index: 2, fraction: 0.25 },
      progress: { fraction: 0.225 },
    });
  });

  it("reports a PDF page, its zoom, and the page count", () => {
    const message = createPosition(
      deps({
        pageIndex: () => 3,
        zoom: () => "width",
        pdfPageCount: () => 12,
      })
    ).message();
    expect(message).toEqual({
      kind: "position",
      position: { kind: "page", page: 3, zoom: "width" },
      progress: { page: 4, pageCount: 12 },
    });
  });

  it("rounds a numeric zoom to three decimals", () => {
    const message = createPosition(
      deps({
        pageIndex: () => 0,
        zoom: () => 1.23456,
        pdfPageCount: () => 2,
      })
    ).message();
    expect(message.position).toEqual({ kind: "page", page: 0, zoom: 1.235 });
  });

  it("reports a fixed-layout Document's section count", () => {
    const message = createPosition(
      deps({
        pageIndex: () => 2,
        zoom: () => "page",
        sections: () => 8,
      })
    ).message();
    expect(message.progress).toEqual({ page: 3, pageCount: 8 });
  });

  it("reports a page count of 0 when no Document is open", () => {
    const message = createPosition(deps({ pageIndex: () => 0 })).message();
    expect(message.progress).toEqual({ page: 1, pageCount: 0 });
  });
});
