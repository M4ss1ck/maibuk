import { describe, expect, it } from "vitest";
import {
  type Candidate,
  pickInDirection,
  pickPane,
  type Rect,
} from "@/lib/arrow-navigation/geometry";

function rect(left: number, top: number, right: number, bottom: number): Rect {
  return { left, top, right, bottom };
}

function candidate<T>(id: T, r: Rect): Candidate<T> {
  return { id, rect: r };
}

describe("pickInDirection()", () => {
  it("picks the nearest candidate in each of the four directions", () => {
    const from = rect(100, 100, 200, 200);

    const right = [
      candidate("near", rect(210, 100, 250, 150)),
      candidate("far", rect(400, 100, 450, 150)),
    ];
    const left = [
      candidate("near", rect(50, 100, 90, 150)),
      candidate("far", rect(-200, 100, -150, 150)),
    ];
    const down = [
      candidate("near", rect(100, 210, 150, 250)),
      candidate("far", rect(100, 400, 150, 450)),
    ];
    const up = [
      candidate("near", rect(100, 50, 150, 90)),
      candidate("far", rect(100, -200, 150, -150)),
    ];

    expect(pickInDirection(from, right, "right")).toBe("near");
    expect(pickInDirection(from, left, "left")).toBe("near");
    expect(pickInDirection(from, down, "down")).toBe("near");
    expect(pickInDirection(from, up, "up")).toBe("near");
  });

  it("measures the gap from the near edges, not the candidate's size", () => {
    const from = rect(100, 100, 200, 200);
    // The tall/wide candidate is nearer but its far edge is further away.
    const big = (r: Rect) => candidate("big", r);
    const small = (r: Rect) => candidate("small", r);

    expect(
      pickInDirection(from, [small(rect(100, 40, 150, 50)), big(rect(100, 0, 150, 95))], "up")
    ).toBe("big");
    expect(
      pickInDirection(
        from,
        [small(rect(250, 100, 260, 150)), big(rect(205, 100, 400, 150))],
        "right"
      )
    ).toBe("big");
    expect(
      pickInDirection(
        from,
        [small(rect(100, 250, 150, 260)), big(rect(100, 205, 150, 400))],
        "down"
      )
    ).toBe("big");
    expect(
      pickInDirection(from, [small(rect(40, 100, 50, 150)), big(rect(0, 100, 95, 150))], "left")
    ).toBe("big");
  });

  it("lets an overlapping candidate beat a nearer but offset one", () => {
    const from = rect(0, 0, 100, 100);

    const offsetNear = candidate("offset", rect(105, 300, 120, 320));
    const overlapFar = candidate("overlap", rect(300, 20, 320, 40));

    expect(pickInDirection(from, [offsetNear, overlapFar], "right")).toBe("overlap");
  });

  it("breaks a score tie by the earlier index in the array", () => {
    const from = rect(0, 0, 100, 100);

    const first = candidate("first", rect(150, 0, 180, 30));
    const second = candidate("second", rect(150, 0, 180, 30));

    expect(pickInDirection(from, [first, second], "right")).toBe("first");
  });

  it("drops candidates with zero width or zero height", () => {
    const from = rect(0, 0, 100, 100);

    const zeroWidth = candidate("zero-width", rect(150, 0, 150, 50));
    const zeroHeight = candidate("zero-height", rect(120, 0, 180, 0));
    const good = candidate("good", rect(200, 0, 240, 50));

    expect(pickInDirection(from, [zeroWidth, zeroHeight, good], "right")).toBe("good");
  });

  it("does not treat a candidate that contains `from` as eligible", () => {
    const from = rect(100, 100, 200, 200);
    const nested = candidate("nested", rect(50, 50, 250, 250));

    expect(pickInDirection(from, [nested], "right")).toBeNull();
  });

  it("treats a candidate touching an edge (gap 0) as eligible", () => {
    const from = rect(0, 0, 100, 100);
    const touching = candidate("touching", rect(100, 0, 150, 50));

    expect(pickInDirection(from, [touching], "right")).toBe("touching");
  });

  it("returns null when nothing is eligible", () => {
    const from = rect(0, 0, 100, 100);
    const behind = candidate("behind", rect(-50, 0, -10, 50));

    expect(pickInDirection(from, [behind], "right")).toBeNull();
    expect(pickInDirection(from, [], "right")).toBeNull();
  });
});

describe("pickPane()", () => {
  it("uses fromPane for eligibility even when a pane overlaps from", () => {
    const fromPane = rect(0, 0, 100, 100);
    const from = rect(10, 10, 40, 40);

    const beyondFrom = candidate("beyond-from", rect(50, 10, 140, 40));
    const beyondFromPane = candidate("beyond-pane", rect(150, 10, 200, 40));

    expect(pickPane(from, fromPane, [beyondFrom, beyondFromPane], "right")).toBe("beyond-pane");
    expect(pickPane(from, fromPane, [beyondFrom], "right")).toBeNull();
  });

  it("uses from for the cross axis, not fromPane", () => {
    const fromPane = rect(0, 0, 100, 300);
    const from = rect(10, 150, 50, 200);

    const levelWithPaneTop = candidate("pane-top", rect(150, 0, 250, 100));
    const levelWithFrom = candidate("from-level", rect(150, 150, 250, 250));

    expect(pickPane(from, fromPane, [levelWithPaneTop, levelWithFrom], "right")).toBe("from-level");
  });
});
