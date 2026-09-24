import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@xyflow/react", () => ({
  ViewportPortal: ({ children }: { children: React.ReactNode }) => children,
}));

const { useCanvasStore } = await import("@/features/canvas/store");
const { CanvasDrawingLayer } = await import("@/features/canvas/drawing/CanvasDrawingLayer");

describe("CanvasDrawingLayer", () => {
  it("draws every saved Drawing inside an svg that browsers render", () => {
    useCanvasStore.setState((state) => ({
      doc: {
        ...state.doc,
        strokes: [
          { id: "s1", color: "#ef4444", width: 3, points: [{ x: 0, y: 0 }, { x: 40, y: 20 }] },
        ],
      },
    }));

    const { container } = render(<CanvasDrawingLayer />);

    const svg = container.querySelector("svg") as SVGSVGElement;
    // An outer <svg> with a zero width or height is not rendered at all, so
    // saved Drawings were invisible in Chromium webviews.
    expect(parseFloat(svg.style.width)).toBeGreaterThan(0);
    expect(parseFloat(svg.style.height)).toBeGreaterThan(0);
    expect(svg.querySelector("path")).toHaveAttribute("stroke", "#ef4444");
  });
});
