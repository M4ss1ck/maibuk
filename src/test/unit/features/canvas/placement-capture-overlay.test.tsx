import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import {
  PlacementCaptureOverlay,
  freeSpotNear,
  pressAfterMove,
  textNodeDragPlacement,
} from "@/features/canvas/PlacementCaptureOverlay";
import { useCanvasStore } from "@/features/canvas/store";
import type { CanvasNode, CanvasToolMode } from "@/features/canvas/types";

// Canvas coordinates are screen pixels divided by the zoom, so the mock keeps
// the zoom in one place and the tests can change it per case.
const flow = vi.hoisted(() => ({ zoom: 1 }));

vi.mock("@xyflow/react", () => ({
  useReactFlow: () => ({
    screenToFlowPosition: (point: { x: number; y: number }) => ({
      x: point.x / flow.zoom,
      y: point.y / flow.zoom,
    }),
    flowToScreenPosition: (point: { x: number; y: number }) => ({
      x: point.x * flow.zoom,
      y: point.y * flow.zoom,
    }),
    getZoom: () => flow.zoom,
  }),
}));

function textNodeAt(x: number, y: number): CanvasNode {
  return { id: `node-${x}-${y}`, kind: "text", html: "<p></p>", position: { x, y } };
}

describe("textNodeDragPlacement", () => {
  it("places a left-to-right drag from its start with the dragged width", () => {
    expect(textNodeDragPlacement({ x: 100, y: 50 }, { x: 400, y: 90 })).toEqual({
      position: { x: 100, y: 50 },
      width: 300,
    });
  });

  it("keeps the right edge at the start for a right-to-left drag", () => {
    expect(textNodeDragPlacement({ x: 400, y: 50 }, { x: 100, y: 90 })).toEqual({
      position: { x: 100, y: 50 },
      width: 300,
    });
  });

  it("widens a short left-to-right drag to the minimum width", () => {
    expect(textNodeDragPlacement({ x: 100, y: 50 }, { x: 150, y: 50 })).toEqual({
      position: { x: 100, y: 50 },
      width: 160,
    });
  });

  it("lets a short right-to-left drag past the start when the minimum width needs room", () => {
    expect(textNodeDragPlacement({ x: 100, y: 50 }, { x: 50, y: 50 })).toEqual({
      position: { x: -60, y: 50 },
      width: 160,
    });
  });
});

describe("pressAfterMove", () => {
  const fine = { clientX: 100, startedAt: 0, coarse: false };
  const coarse = { clientX: 100, startedAt: 0, coarse: true };

  it("needs 6 screen pixels of sideways travel from a mouse", () => {
    expect(pressAfterMove(fine, 105, 10)).toBe("pressed");
    expect(pressAfterMove(fine, 106, 10)).toBe("dragging");
  });

  it("needs 16 screen pixels of sideways travel from a finger", () => {
    expect(pressAfterMove(coarse, 115, 10)).toBe("pressed");
    expect(pressAfterMove(coarse, 116, 10)).toBe("dragging");
  });

  it("turns a press held past 500 ms into a click, however far it moves", () => {
    expect(pressAfterMove(fine, 300, 501)).toBe("click");
  });
});

describe("freeSpotNear", () => {
  it("returns the spot itself when no item holds it", () => {
    expect(freeSpotNear({ x: 0, y: 0 }, [])).toEqual({ x: 0, y: 0 });
    expect(freeSpotNear({ x: 0, y: 0 }, [textNodeAt(300, 300)])).toEqual({ x: 0, y: 0 });
  });

  it("steps by 24 on both axes when one item holds the spot", () => {
    expect(freeSpotNear({ x: 0, y: 0 }, [textNodeAt(0, 0)])).toEqual({ x: 24, y: 24 });
  });

  it("steps past every item in a row that holds the spot and the next step", () => {
    expect(freeSpotNear({ x: 0, y: 0 }, [textNodeAt(0, 0), textNodeAt(24, 24)])).toEqual({
      x: 48,
      y: 48,
    });
  });
});

describe("PlacementCaptureOverlay", () => {
  const onPlace = vi.fn();
  const surfaceRef = { current: document.createElement("div") };

  function renderOverlay() {
    return render(<PlacementCaptureOverlay surfaceRef={surfaceRef} onPlace={onPlace} />);
  }

  function overlay() {
    return screen.getByTestId("canvas-placement-overlay");
  }

  function setTool(toolMode: CanvasToolMode, extra: Record<string, unknown> = {}) {
    useCanvasStore.setState({
      toolMode,
      interactivityLocked: false,
      editorReadOnly: false,
      ...extra,
    });
  }

  function press(init: Record<string, unknown>) {
    fireEvent.pointerDown(overlay(), { button: 0, pointerId: 1, pointerType: "mouse", ...init });
  }

  function move(init: Record<string, unknown>) {
    fireEvent.pointerMove(overlay(), { pointerId: 1, pointerType: "mouse", ...init });
  }

  function release(init: Record<string, unknown>) {
    fireEvent.pointerUp(overlay(), { button: 0, pointerId: 1, pointerType: "mouse", ...init });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    flow.zoom = 1;
    // Event timeStamps come from Date.now() in jsdom, so faking Date controls the
    // press window without touching timers the pointer code never uses.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1000);
    if (typeof HTMLElement.prototype.setPointerCapture !== "function") {
      Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
        configurable: true,
        value: vi.fn(),
      });
    }
    setTool("textNode");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("places a Text Node at a click with no width", () => {
    renderOverlay();

    press({ clientX: 100, clientY: 50 });
    release({ clientX: 100, clientY: 50 });

    expect(onPlace).toHaveBeenCalledTimes(1);
    expect(onPlace.mock.calls[0]).toHaveLength(1);
    expect(onPlace).toHaveBeenCalledWith({ x: 100, y: 50 });
  });

  it("sets the width of a Text Node from a drag, with the preview shown only while dragging", () => {
    renderOverlay();

    press({ clientX: 100, clientY: 50 });
    move({ clientX: 400, clientY: 90 });
    expect(screen.getByTestId("canvas-placement-preview")).toBeInTheDocument();
    expect(onPlace).not.toHaveBeenCalled();

    release({ clientX: 400, clientY: 90 });

    expect(onPlace).toHaveBeenCalledTimes(1);
    expect(onPlace).toHaveBeenCalledWith({ x: 100, y: 50 }, 300);
    expect(screen.queryByTestId("canvas-placement-preview")).not.toBeInTheDocument();
  });

  it("places a right-to-left drag by its right edge", () => {
    renderOverlay();

    press({ clientX: 400, clientY: 50 });
    move({ clientX: 100, clientY: 90 });
    release({ clientX: 100, clientY: 90 });

    expect(onPlace).toHaveBeenCalledWith({ x: 100, y: 50 }, 300);
  });

  it("treats a drag shorter than the threshold as a click", () => {
    renderOverlay();

    press({ clientX: 100, clientY: 50 });
    move({ clientX: 104, clientY: 50 });
    expect(screen.queryByTestId("canvas-placement-preview")).not.toBeInTheDocument();
    release({ clientX: 104, clientY: 50 });

    expect(onPlace.mock.calls[0]).toHaveLength(1);
    expect(onPlace).toHaveBeenCalledWith({ x: 100, y: 50 });
  });

  it("treats a finger that travels 10 screen pixels as a click", () => {
    renderOverlay();

    press({ clientX: 100, clientY: 50, pointerType: "touch" });
    move({ clientX: 110, clientY: 50, pointerType: "touch" });
    release({ clientX: 110, clientY: 50, pointerType: "touch" });

    expect(onPlace.mock.calls[0]).toHaveLength(1);
    expect(onPlace).toHaveBeenCalledWith({ x: 100, y: 50 });
  });

  it("treats a press held longer than 500 ms before moving as a click", () => {
    renderOverlay();

    press({ clientX: 100, clientY: 50 });
    vi.setSystemTime(1600);
    move({ clientX: 400, clientY: 50 });
    expect(screen.queryByTestId("canvas-placement-preview")).not.toBeInTheDocument();
    release({ clientX: 400, clientY: 50 });

    expect(onPlace.mock.calls[0]).toHaveLength(1);
    expect(onPlace).toHaveBeenCalledWith({ x: 100, y: 50 });
  });

  it("places a note reference at the press with no width, even after a drag", () => {
    setTool("noteRef");
    renderOverlay();

    press({ clientX: 100, clientY: 50 });
    move({ clientX: 400, clientY: 90 });
    expect(screen.queryByTestId("canvas-placement-preview")).not.toBeInTheDocument();
    release({ clientX: 400, clientY: 90 });

    expect(onPlace.mock.calls[0]).toHaveLength(1);
    expect(onPlace).toHaveBeenCalledWith({ x: 100, y: 50 });
  });

  it("drops a cancelled press without placing and stays armed", () => {
    renderOverlay();

    press({ clientX: 100, clientY: 50 });
    fireEvent.pointerCancel(overlay(), { pointerId: 1, pointerType: "mouse" });
    expect(onPlace).not.toHaveBeenCalled();
    expect(useCanvasStore.getState().toolMode).toBe("textNode");

    press({ clientX: 200, clientY: 60 });
    release({ clientX: 200, clientY: 60 });
    expect(onPlace).toHaveBeenCalledWith({ x: 200, y: 60 });
  });

  it("ignores presses from a button other than the primary one", () => {
    renderOverlay();

    press({ button: 2, clientX: 100, clientY: 50 });
    release({ button: 2, clientX: 100, clientY: 50 });

    expect(onPlace).not.toHaveBeenCalled();
  });

  it("ignores a second pointer while the first is down", () => {
    renderOverlay();

    press({ clientX: 100, clientY: 50, pointerId: 1 });
    press({ clientX: 300, clientY: 200, pointerId: 2 });
    release({ clientX: 300, clientY: 200, pointerId: 2 });
    expect(onPlace).not.toHaveBeenCalled();

    release({ clientX: 100, clientY: 50, pointerId: 1 });
    expect(onPlace).toHaveBeenCalledTimes(1);
    expect(onPlace).toHaveBeenCalledWith({ x: 100, y: 50 });
  });

  it("places at zoom 2 in Canvas coordinates, so a 400 screen pixel drag is 200 wide", () => {
    flow.zoom = 2;
    renderOverlay();

    press({ clientX: 100, clientY: 50 });
    move({ clientX: 500, clientY: 50 });
    expect(screen.getByTestId("canvas-placement-preview")).toHaveStyle({ width: "400px" });
    release({ clientX: 500, clientY: 50 });

    expect(onPlace).toHaveBeenCalledWith({ x: 50, y: 25 }, 200);
  });

  it("places at zoom 0.5 in Canvas coordinates, so a 400 screen pixel drag is 800 wide", () => {
    flow.zoom = 0.5;
    renderOverlay();

    press({ clientX: 100, clientY: 50 });
    move({ clientX: 500, clientY: 50 });
    release({ clientX: 500, clientY: 50 });

    expect(onPlace).toHaveBeenCalledWith({ x: 200, y: 100 }, 800);
  });

  it("claims touch so the browser does not scroll or cancel the drag", () => {
    renderOverlay();

    expect(overlay()).toHaveStyle({ touchAction: "none" });
  });

  it.each(["select", "pen"] as const)("renders nothing while the tool is %s", (toolMode) => {
    setTool(toolMode);
    renderOverlay();

    expect(screen.queryByTestId("canvas-placement-overlay")).not.toBeInTheDocument();
  });

  it("renders nothing while the canvas is locked", () => {
    setTool("textNode", { interactivityLocked: true });
    renderOverlay();

    expect(screen.queryByTestId("canvas-placement-overlay")).not.toBeInTheDocument();
  });

  it("renders nothing while the canvas is read-only", () => {
    setTool("textNode", { editorReadOnly: true });
    renderOverlay();

    expect(screen.queryByTestId("canvas-placement-overlay")).not.toBeInTheDocument();
  });
});
