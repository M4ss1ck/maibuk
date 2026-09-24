import { it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useRef } from "react";
import { useToolbarOverflow } from "@/components/editor/toolbar/useToolbarOverflow";

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    }
  );
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
});

function withRect(element: HTMLElement, left: number, width: number): HTMLElement {
  element.getBoundingClientRect = () =>
    ({ left, right: left + width, width, top: 0, bottom: 0, height: 0 }) as DOMRect;
  return element;
}

interface Layout {
  rootWidth: number;
  rootPadding?: number;
  laneGap?: number;
  endWidth: number;
  // Entries as laid out in the measure lane: width, optional horizontal margin, flex gap between them
  entries: { width: number; margin?: number }[];
  entryGap?: number;
}

/** Builds real elements with the geometry a browser would report for `layout`. */
function buildLayout({
  rootWidth,
  rootPadding = 0,
  laneGap = 0,
  endWidth,
  entries,
  entryGap = 0,
}: Layout) {
  const root = withRect(document.createElement("div"), 0, rootWidth);
  root.style.paddingLeft = `${rootPadding}px`;
  root.style.paddingRight = `${rootPadding}px`;
  root.style.columnGap = `${laneGap}px`;

  const end = withRect(document.createElement("div"), rootWidth - rootPadding - endWidth, endWidth);

  const laneLeft = 500;
  const lane = withRect(document.createElement("div"), laneLeft, 0);
  let cursor = laneLeft;
  entries.forEach(({ width, margin = 0 }, i) => {
    if (i > 0) cursor += entryGap;
    const child = document.createElement("div");
    child.style.marginLeft = `${margin}px`;
    child.style.marginRight = `${margin}px`;
    lane.appendChild(withRect(child, cursor + margin, width));
    cursor += margin + width + margin;
  });

  return { root, end, lane, entryCount: entries.length };
}

function visibleCountFor(layout: Layout) {
  const { root, end, lane, entryCount } = buildLayout(layout);
  const { result } = renderHook(() =>
    useToolbarOverflow({
      rootRef: useRef<HTMLElement>(root),
      endRef: useRef<HTMLElement>(end),
      measureRef: useRef<HTMLElement>(lane),
      entryCount,
      deps: [],
    })
  );
  return result.current.visibleCount;
}

it("admits the longest prefix of whole entries that fit", () => {
  // available = 300 - 80 = 220; children 100,100,100 -> 2 fit
  expect(
    visibleCountFor({
      rootWidth: 300,
      endWidth: 80,
      entries: [{ width: 100 }, { width: 100 }, { width: 100 }],
    })
  ).toBe(2);
});

it("returns 0 when root has not measured yet", () => {
  expect(visibleCountFor({ rootWidth: 0, endWidth: 0, entries: [{ width: 100 }] })).toBe(0);
});

it("subtracts the row's real horizontal padding", () => {
  // content = 300 - 2 * 16 = 268; available = 268 - 80 = 188 -> only one 100px entry fits
  expect(
    visibleCountFor({
      rootWidth: 300,
      rootPadding: 16,
      endWidth: 80,
      entries: [{ width: 100 }, { width: 88 }, { width: 100 }],
    })
  ).toBe(2);
  expect(
    visibleCountFor({
      rootWidth: 300,
      rootPadding: 16,
      endWidth: 80,
      entries: [{ width: 100 }, { width: 89 }],
    })
  ).toBe(1);
});

it("reserves the gap between the start and end lanes", () => {
  // available = 300 - 80 - 4 = 216
  const entries = [{ width: 100 }, { width: 116 }];
  expect(visibleCountFor({ rootWidth: 300, laneGap: 4, endWidth: 80, entries })).toBe(2);
  expect(
    visibleCountFor({
      rootWidth: 300,
      laneGap: 4,
      endWidth: 80,
      entries: [{ width: 100 }, { width: 117 }],
    })
  ).toBe(1);
});

it("counts entry margins and the gaps between entries", () => {
  // Divider-like entry: 1px wide with 4px margins each side -> 9px, plus two 4px gaps.
  // Prefix widths: 100, 100+4+9 = 113, 113+4+100 = 217; available = 300 - 80 = 220
  const entries = [{ width: 100 }, { width: 1, margin: 4 }, { width: 100 }];
  expect(visibleCountFor({ rootWidth: 300, endWidth: 80, entryGap: 4, entries })).toBe(3);
  expect(visibleCountFor({ rootWidth: 296, endWidth: 80, entryGap: 4, entries })).toBe(2);
});

it("does not admit an entry that overflows by a fraction of a pixel", () => {
  const entries = [{ width: 100 }, { width: 120.25 }];
  expect(visibleCountFor({ rootWidth: 300, endWidth: 80, entries })).toBe(1);
  expect(visibleCountFor({ rootWidth: 300.25, endWidth: 80, entries })).toBe(2);
});
