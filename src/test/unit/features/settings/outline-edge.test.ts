import { describe, expect, it } from "vitest";
import {
  OUTLINE_EDGE_SAMPLES,
  cubicBezier,
  edgeKeyframes,
} from "@/features/settings/outline-edge";

const linear = cubicBezier(0, 0, 1, 1);
const easeIn = cubicBezier(0.4, 0, 1, 1);
const easeOut = cubicBezier(0, 0, 0.2, 1);

describe("cubicBezier()", () => {
  it("a linear curve is the identity", () => {
    for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      expect(linear(t)).toBeCloseTo(t, 6);
    }
  });

  it("ease-in lags behind the straight line half way", () => {
    expect(easeIn(0.5)).toBeLessThan(0.5);
  });

  it("ease-out is ahead of the straight line half way", () => {
    expect(easeOut(0.5)).toBeGreaterThan(0.5);
  });

  it("both curves hit their endpoints exactly", () => {
    for (const curve of [easeIn, easeOut]) {
      expect(curve(0)).toBe(0);
      expect(curve(1)).toBe(1);
    }
  });

  it("clamps beyond the unit interval", () => {
    for (const curve of [easeIn, easeOut]) {
      expect(curve(-0.5)).toBe(0);
      expect(curve(1.5)).toBe(1);
    }
  });

  it("is monotonic across the interval", () => {
    for (const curve of [easeIn, easeOut]) {
      let previous = curve(0);
      for (let i = 1; i <= 100; i++) {
        const value = curve(i / 100);
        expect(value).toBeGreaterThanOrEqual(previous - 1e-9);
        previous = value;
      }
    }
  });
});

describe("edgeKeyframes()", () => {
  const naturals = [20, 20, 20, 20];

  it("samples the edge at OUTLINE_EDGE_SAMPLES + 1 offsets", () => {
    const frames = edgeKeyframes(naturals, 80, 0, linear);
    expect(frames).toHaveLength(OUTLINE_EDGE_SAMPLES + 1);
    expect(frames[0].offset).toBe(0);
    expect(frames.at(-1)!.offset).toBe(1);
  });

  it("starts full and ends empty folding to nothing", () => {
    const frames = edgeKeyframes(naturals, 80, 0, linear);
    expect(frames[0].heights).toEqual([20, 20, 20, 20]);
    expect(frames.at(-1)!.heights).toEqual([0, 0, 0, 0]);
  });

  it("keeps at most one partial row on every step", () => {
    for (const frames of [
      edgeKeyframes(naturals, 80, 0, linear),
      edgeKeyframes(naturals, 80, 0, easeIn),
      edgeKeyframes(naturals, 0, 80, linear),
      edgeKeyframes(naturals, 0, 80, easeOut),
    ]) {
      for (const frame of frames) {
        const partial = frame.heights.filter(
          (height, i) => height > 0 && height < naturals[i]
        );
        expect(partial.length).toBeLessThanOrEqual(1);
      }
    }
  });

  it("sums the row heights to the edge value", () => {
    const frames = edgeKeyframes(naturals, 80, 0, easeIn);
    for (const frame of frames) {
      const edge = 80 - 80 * easeIn(frame.offset);
      expect(frame.heights.reduce((total, height) => total + height, 0)).toBeCloseTo(edge, 6);
    }
  });

  it("empties rows bottom-up as the edge rises", () => {
    const frames = edgeKeyframes(naturals, 80, 0, linear);
    const firstEmpty = frames.find((frame) => frame.heights[3] === 0);
    const lastEmpty = frames.find((frame) => frame.heights[0] === 0);
    expect(firstEmpty).toBeDefined();
    expect(lastEmpty).toBeDefined();
    // The bottom row is gone before the top row is.
    expect(frames.indexOf(firstEmpty!)).toBeLessThan(frames.indexOf(lastEmpty!));
  });

  it("fills rows top-down as the edge falls", () => {
    const frames = edgeKeyframes(naturals, 0, 80, linear);
    const firstFull = frames.find((frame) => frame.heights[0] === 20);
    const lastFull = frames.find((frame) => frame.heights[3] === 20);
    expect(firstFull).toBeDefined();
    expect(lastFull).toBeDefined();
    expect(frames.indexOf(firstFull!)).toBeLessThan(frames.indexOf(lastFull!));
  });

  it("a reversal from a partial edge keeps the space already taken", () => {
    // The section paints 30px tall (a full row and half of the next) and grows
    // back to its 80px natural height.
    const frames = edgeKeyframes(naturals, 30, 80, linear);
    expect(frames[0].heights).toEqual([20, 10, 0, 0]);
  });

  it("honours a custom sample count", () => {
    const frames = edgeKeyframes(naturals, 80, 0, linear, 4);
    expect(frames).toHaveLength(5);
    expect(frames.map((frame) => frame.offset)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });
});

describe("edgeKeyframes() boundary keyframes", () => {
  const naturals = [20, 20, 20, 20];
  // Every boundary the edge can sit on: each row's top and the stack bottom.
  const boundaries = [0, 20, 40, 60, 80];

  const scenarios = [
    { from: 80, to: 0, ease: easeIn },
    { from: 0, to: 80, ease: easeOut },
    { from: 30, to: 80, ease: easeIn },
  ];

  const edgeOf = (frame: { heights: number[] }) =>
    frame.heights.reduce((total, height) => total + height, 0);

  it("changes at most one row between consecutive keyframes", () => {
    for (const { from, to, ease } of scenarios) {
      const frames = edgeKeyframes(naturals, from, to, ease);
      for (let i = 1; i < frames.length; i++) {
        const changed = frames[i].heights.filter(
          (height, row) =>
            Math.abs(height - frames[i - 1].heights[row]) > 1e-9
        );
        expect(changed.length).toBeLessThanOrEqual(1);
      }
    }
  });

  it("lists strictly increasing offsets from 0 to 1", () => {
    for (const { from, to, ease } of scenarios) {
      const frames = edgeKeyframes(naturals, from, to, ease);
      expect(frames[0].offset).toBe(0);
      expect(frames.at(-1)!.offset).toBe(1);
      for (let i = 1; i < frames.length; i++) {
        expect(frames[i].offset).toBeGreaterThan(frames[i - 1].offset);
      }
    }
  });

  it("sits on every row boundary the edge crosses", () => {
    for (const { from, to, ease } of scenarios) {
      const frames = edgeKeyframes(naturals, from, to, ease);
      const low = Math.min(from, to);
      const high = Math.max(from, to);
      for (const boundary of boundaries) {
        if (boundary <= low || boundary >= high) continue;
        const crossing = frames.find(
          (frame) => Math.abs(edgeOf(frame) - boundary) < 1e-6
        );
        expect(crossing).toBeDefined();
        // On a boundary, some prefix of rows is full and the rest are empty.
        const full = crossing!.heights.filter(
          (height) => Math.abs(height - 20) < 1e-6
        ).length;
        crossing!.heights.forEach((height, row) => {
          expect(height).toBeCloseTo(row < full ? 20 : 0, 6);
        });
      }
    }
  });
});
