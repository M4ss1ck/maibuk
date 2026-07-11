import { it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useRef } from "react";
import { useToolbarOverflow } from "@/components/editor/toolbar/useToolbarOverflow";

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { cb(0); return 0; });
});

function setup(rootWidth: number, endWidth: number, childWidths: number[]) {
  return renderHook(() => {
    const rootRef = useRef<HTMLElement>({ getBoundingClientRect: () => ({ width: rootWidth }) } as HTMLElement);
    const endRef = useRef<HTMLElement>({ getBoundingClientRect: () => ({ width: endWidth }) } as HTMLElement);
    const children = childWidths.map((w) => ({ offsetWidth: w } as HTMLElement));
    const measureRef = useRef<HTMLElement>({ children } as unknown as HTMLElement);
    return useToolbarOverflow({ rootRef, endRef, measureRef, entryCount: childWidths.length, deps: [] });
  });
}

it("admits the longest prefix of whole entries that fit", () => {
  // available = 300 - 80 = 220; children 100,100,100 -> 2 fit
  const { result } = setup(300, 80, [100, 100, 100]);
  expect(result.current.visibleCount).toBe(2);
});
it("returns 0 when root has not measured yet", () => {
  const { result } = setup(0, 0, [100]);
  expect(result.current.visibleCount).toBe(0);
});
