import { describe, expect, it } from "vitest";
import { snapAxis } from "@/features/covers/scene/snap";

describe("snapAxis", () => {
  it("returns the delta to the nearest target within threshold", () => {
    // a position at 98, target line at 100, threshold 8 -> delta +2
    const r = snapAxis([98], [100, 500], 8);
    expect(r).not.toBeNull();
    expect(r!.delta).toBe(2);
    expect(r!.line).toBe(100);
  });

  it("returns null when no target is within threshold", () => {
    expect(snapAxis([50], [100, 500], 8)).toBeNull();
  });

  it("picks the closest across multiple positions and targets", () => {
    // positions: left=10, center=60, right=110; targets: 100
    // closest is right(110)->100 delta -10, or center(60)->100 delta 40; left far.
    const r = snapAxis([10, 60, 110], [100], 12);
    expect(r!.line).toBe(100);
    expect(r!.delta).toBe(-10);
  });
});
