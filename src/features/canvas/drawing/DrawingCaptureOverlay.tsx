import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { useReactFlow } from "@xyflow/react";
import { useCanvasStore } from "../store";
import type { CanvasPosition } from "../types";
import { strokeToPath } from "./strokePath";

function distanceToSegment(
  p: CanvasPosition,
  a: CanvasPosition,
  b: CanvasPosition,
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  const t =
    lenSq === 0
      ? 0
      : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  return Math.hypot(p.x - cx, p.y - cy);
}

export function DrawingCaptureOverlay({
  surfaceRef,
}: {
  surfaceRef: RefObject<HTMLDivElement | null>;
}) {
  const reactFlow = useReactFlow();
  const toolMode = useCanvasStore((state) => state.toolMode);
  const penWidth = useCanvasStore((state) => state.penWidth);
  const penColor = useCanvasStore((state) => state.penColor);
  const addStroke = useCanvasStore((state) => state.addStroke);
  const removeStroke = useCanvasStore((state) => state.removeStroke);
  const drawing = useRef(false);
  const [points, setPoints] = useState<CanvasPosition[]>([]);

  if (toolMode === "select") return null;

  const toFlow = (event: ReactPointerEvent) =>
    reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY });

  const eraseAt = (flow: CanvasPosition) => {
    const zoom = reactFlow.getZoom();
    const threshold = 10 / zoom;
    const strokes = useCanvasStore.getState().doc.strokes;
    for (const stroke of strokes) {
      for (let i = 1; i < stroke.points.length; i++) {
        if (
          distanceToSegment(flow, stroke.points[i - 1], stroke.points[i]) <=
          threshold + stroke.width / 2
        ) {
          removeStroke(stroke.id);
          break;
        }
      }
    }
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    const flow = toFlow(event);
    if (toolMode === "eraser") eraseAt(flow);
    else setPoints([flow]);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drawing.current) return;
    const flow = toFlow(event);
    if (toolMode === "eraser") eraseAt(flow);
    else setPoints((previous) => [...previous, flow]);
  };

  const onPointerUp = () => {
    drawing.current = false;
    if (toolMode === "pen" && points.length >= 2) {
      addStroke({
        id: crypto.randomUUID(),
        points,
        color: penColor,
        width: penWidth,
      });
    }
    setPoints([]);
  };

  return (
    <div
      className="absolute inset-0 z-[5]"
      style={{ cursor: "crosshair" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {toolMode === "pen" && points.length > 0 && (
        <svg className="pointer-events-none absolute inset-0 h-full w-full">
          <path
            d={strokeToPath(
              points
                .map((point) => reactFlow.flowToScreenPosition(point))
                .map((screen) => {
                  const rect = surfaceRef.current?.getBoundingClientRect();
                  return {
                    x: screen.x - (rect?.left ?? 0),
                    y: screen.y - (rect?.top ?? 0),
                  };
                }),
            )}
            stroke={penColor}
            strokeWidth={penWidth}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </div>
  );
}
