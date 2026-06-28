import { describe, expect, it } from "vitest";
import {
  isPointInRect,
  rectsIntersect,
  segmentsIntersect,
  segmentIntersectsRect,
  rectangleFromPoints,
} from "../../../../../features/canvas/drawing/DrawingCaptureOverlay";

describe("rectangle geometry helpers", () => {
  describe("rectangleFromPoints", () => {
    it("builds a normalized rectangle from two opposing corners", () => {
      const rect = rectangleFromPoints({ x: 10, y: 10 }, { x: 30, y: 50 });
      expect(rect).toEqual({ x: 10, y: 10, width: 20, height: 40 });
    });

    it("swaps coordinates when the second point is above and to the left", () => {
      const rect = rectangleFromPoints({ x: 30, y: 50 }, { x: 10, y: 10 });
      expect(rect).toEqual({ x: 10, y: 10, width: 20, height: 40 });
    });
  });

  describe("isPointInRect", () => {
    it("returns true for a point inside the rectangle", () => {
      expect(isPointInRect({ x: 15, y: 15 }, { x: 10, y: 10, width: 20, height: 20 })).toBe(true);
    });

    it("returns false for a point outside the rectangle", () => {
      expect(isPointInRect({ x: 5, y: 15 }, { x: 10, y: 10, width: 20, height: 20 })).toBe(false);
    });
  });

  describe("rectsIntersect", () => {
    it("returns true for overlapping rectangles", () => {
      expect(
        rectsIntersect(
          { x: 0, y: 0, width: 10, height: 10 },
          { x: 5, y: 5, width: 10, height: 10 },
        ),
      ).toBe(true);
    });

    it("returns false for disjoint rectangles", () => {
      expect(
        rectsIntersect(
          { x: 0, y: 0, width: 10, height: 10 },
          { x: 20, y: 20, width: 10, height: 10 },
        ),
      ).toBe(false);
    });
  });

  describe("segmentsIntersect", () => {
    it("returns true for crossing segments", () => {
      expect(
        segmentsIntersect(
          { x: 0, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 },
          { x: 10, y: 0 },
        ),
      ).toBe(true);
    });

    it("returns false for parallel segments", () => {
      expect(
        segmentsIntersect(
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 0, y: 10 },
          { x: 10, y: 10 },
        ),
      ).toBe(false);
    });
  });

  describe("segmentIntersectsRect", () => {
    it("returns true when the segment crosses the rectangle", () => {
      expect(
        segmentIntersectsRect([{ x: -5, y: 5 }, { x: 15, y: 5 }], { x: 0, y: 0, width: 10, height: 10 }),
      ).toBe(true);
    });

    it("returns true when an endpoint is inside the rectangle", () => {
      expect(
        segmentIntersectsRect([{ x: 5, y: 5 }, { x: 15, y: 15 }], { x: 0, y: 0, width: 10, height: 10 }),
      ).toBe(true);
    });

    it("returns false when the segment is completely outside the rectangle", () => {
      expect(
        segmentIntersectsRect([{ x: -10, y: -10 }, { x: -5, y: -5 }], { x: 0, y: 0, width: 10, height: 10 }),
      ).toBe(false);
    });
  });
});
