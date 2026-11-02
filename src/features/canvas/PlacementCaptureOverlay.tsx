import { useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useReactFlow } from "@xyflow/react";
import {
  CANVAS_PLACEMENT_DRAG_THRESHOLD,
  CANVAS_PLACEMENT_DRAG_THRESHOLD_COARSE,
  CANVAS_PLACEMENT_DRAG_WINDOW_MS,
  CANVAS_PLACEMENT_OFFSET,
  CANVAS_TEXT_NODE_MIN_HEIGHT,
  CANVAS_TEXT_NODE_MIN_WIDTH,
} from "@/constants";
import { useCanvasStore } from "@/features/canvas/store";
import { isPlacementTool, type CanvasNode, type CanvasPosition } from "@/features/canvas/types";

/**
 * Where a Text Node drag puts the node. The drag sets the width only, so the top
 * stays at the press point, and a right-to-left drag keeps its right edge there
 * even when the minimum width pushes the left edge past the pointer.
 */
export function textNodeDragPlacement(start: CanvasPosition, end: CanvasPosition) {
  const width = Math.max(CANVAS_TEXT_NODE_MIN_WIDTH, Math.abs(end.x - start.x));
  return {
    position: { x: end.x < start.x ? start.x - width : start.x, y: start.y },
    width,
  };
}

type DragStart = { clientX: number; startedAt: number; coarse: boolean };

/**
 * What a press that is not yet a drag becomes after this move. Only sideways travel
 * counts, because a drag sets nothing but the width. A press that sat still past the
 * window stays a click however it moves later (tldraw's Pointing state does the same).
 */
export function pressAfterMove(
  press: DragStart,
  clientX: number,
  now: number
): "pressed" | "dragging" | "click" {
  if (now - press.startedAt > CANVAS_PLACEMENT_DRAG_WINDOW_MS) return "click";
  const threshold = press.coarse
    ? CANVAS_PLACEMENT_DRAG_THRESHOLD_COARSE
    : CANVAS_PLACEMENT_DRAG_THRESHOLD;
  return Math.abs(clientX - press.clientX) >= threshold ? "dragging" : "pressed";
}

/** The spot itself, or the first step away from it that no item already holds. */
export function freeSpotNear(position: CanvasPosition, nodes: CanvasNode[]): CanvasPosition {
  let spot = position;
  while (
    nodes.some(
      (node) =>
        Math.hypot(node.position.x - spot.x, node.position.y - spot.y) < CANVAS_PLACEMENT_OFFSET
    )
  ) {
    spot = { x: spot.x + CANVAS_PLACEMENT_OFFSET, y: spot.y + CANVAS_PLACEMENT_OFFSET };
  }
  return spot;
}

type Gesture = DragStart & {
  pointerId: number;
  start: CanvasPosition;
  phase: "pressed" | "dragging" | "click";
};

/** Takes the press, tap, or drag that places an item while a placement tool is armed. */
export function PlacementCaptureOverlay({
  surfaceRef,
  onPlace,
}: {
  surfaceRef: RefObject<HTMLDivElement | null>;
  onPlace: (position: CanvasPosition, width?: number) => void;
}) {
  const reactFlow = useReactFlow();
  const toolMode = useCanvasStore((state) => state.toolMode);
  const enabled = useCanvasStore(
    (state) =>
      isPlacementTool(state.toolMode) && !state.interactivityLocked && !state.editorReadOnly
  );
  const gesture = useRef<Gesture | null>(null);
  const [drag, setDrag] = useState<{ start: CanvasPosition; end: CanvasPosition } | null>(null);

  if (!enabled) return null;

  const toFlow = (event: ReactPointerEvent) =>
    reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY });

  const reset = () => {
    gesture.current = null;
    setDrag(null);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // A second finger neither restarts the gesture nor pinches: no panning while armed.
    if (event.button !== 0 || gesture.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      startedAt: event.timeStamp,
      coarse: event.pointerType === "touch",
      start: toFlow(event),
      phase: "pressed",
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId || toolMode !== "textNode") return;
    if (current.phase === "pressed") {
      current.phase = pressAfterMove(current, event.clientX, event.timeStamp);
    }
    if (current.phase === "dragging") setDrag({ start: current.start, end: toFlow(event) });
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const end = toFlow(event);
    reset();
    if (current.phase === "dragging") {
      const { position, width } = textNodeDragPlacement(current.start, end);
      onPlace(position, width);
    } else {
      onPlace(current.start);
    }
  };

  const onPointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (gesture.current?.pointerId === event.pointerId) reset();
  };

  const preview = (() => {
    if (!drag) return null;
    const { position, width } = textNodeDragPlacement(drag.start, drag.end);
    const origin = surfaceRef.current?.getBoundingClientRect();
    const screen = reactFlow.flowToScreenPosition(position);
    const zoom = reactFlow.getZoom();
    return {
      left: screen.x - (origin?.left ?? 0),
      top: screen.y - (origin?.top ?? 0),
      width: width * zoom,
      // Fixed: a drag sets no height, so the preview must not suggest one.
      height: CANVAS_TEXT_NODE_MIN_HEIGHT * zoom,
    };
  })();

  return (
    <div
      data-testid="canvas-placement-overlay"
      className="absolute inset-0 z-[5]"
      // Without this a finger drag scrolls or is cancelled by the browser.
      style={{ cursor: "crosshair", touchAction: "none" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      {preview && (
        <div
          aria-hidden="true"
          data-testid="canvas-placement-preview"
          className="pointer-events-none absolute rounded-lg border border-dashed border-primary bg-primary/5"
          style={preview}
        />
      )}
    </div>
  );
}
