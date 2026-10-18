import { describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import type { DropTarget } from "react-aria-components";
import { SectionedDropTargetDelegate } from "@/components/ui/SectionedGridListDnd";

const ROW_HEIGHT = 40;

/**
 * A grid whose rows are appended in `domOrder`, each placed at its `tops` entry
 * (viewport px, the grid itself at top 0). Virtualized lists append rows in an
 * order that is not their visual order, so DOM order is the thing under test.
 */
function buildGrid(domOrder: string[], tops: Record<string, number>) {
  const grid = document.createElement("div");
  grid.setAttribute("role", "grid");
  document.body.appendChild(grid);
  for (const key of domOrder) {
    const row = document.createElement("div");
    row.setAttribute("role", "row");
    row.dataset.key = key;
    grid.appendChild(row);
    const top = tops[key];
    vi.spyOn(row, "getBoundingClientRect").mockReturnValue({
      top,
      bottom: top + ROW_HEIGHT,
      left: 0,
      right: 300,
      height: ROW_HEIGHT,
      width: 300,
      x: 0,
      y: top,
      toJSON: () => ({}),
    } as DOMRect);
  }
  vi.spyOn(grid, "getBoundingClientRect").mockReturnValue({
    top: 0,
    bottom: 400,
    left: 0,
    right: 300,
    height: 400,
    width: 300,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
  return grid;
}

const anyValid = () => true;

describe("SectionedDropTargetDelegate", () => {
  // Visual order a(0) b(40) c(80) d(120). Each probe point is inside the list.
  const tops = { a: 0, b: 40, c: 80, d: 120 };
  const probes: Array<[number, DropTarget]> = [
    [10, { type: "item", key: "a", dropPosition: "before" }],
    [50, { type: "item", key: "b", dropPosition: "before" }],
    [90, { type: "item", key: "c", dropPosition: "before" }],
    [200, { type: "item", key: "d", dropPosition: "after" }],
  ];

  it.each(
    probes
  )("resolves the same drop target at y=%i whatever order the rows are in the DOM", (y, expected) => {
    const inOrder = buildGrid(["a", "b", "c", "d"], tops);
    const inOrderRef = createRef<HTMLElement>();
    (inOrderRef as { current: HTMLElement | null }).current = inOrder;
    const shuffled = buildGrid(["c", "a", "d", "b"], tops);
    const shuffledRef = createRef<HTMLElement>();
    (shuffledRef as { current: HTMLElement | null }).current = shuffled;

    const expectedTarget = new SectionedDropTargetDelegate(inOrderRef).getDropTargetFromPoint(
      0,
      y,
      anyValid
    );
    const actual = new SectionedDropTargetDelegate(shuffledRef).getDropTargetFromPoint(
      0,
      y,
      anyValid
    );

    expect(expectedTarget).toEqual(expected);
    expect(actual).toEqual(expectedTarget);
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });
});
