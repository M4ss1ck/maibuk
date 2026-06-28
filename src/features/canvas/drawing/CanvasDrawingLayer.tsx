import { ViewportPortal } from "@xyflow/react";
import { useCanvasStore } from "../store";
import { strokeToPath } from "./strokePath";

export function CanvasDrawingLayer() {
  const strokes = useCanvasStore((state) => state.doc.strokes);
  return (
    <ViewportPortal>
      <svg
        className="pointer-events-none absolute left-0 top-0 overflow-visible"
        style={{ width: 0, height: 0 }}
      >
        {strokes.map((stroke) => (
          <path
            key={stroke.id}
            d={strokeToPath(stroke.points)}
            stroke={stroke.color}
            strokeWidth={stroke.width}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </svg>
    </ViewportPortal>
  );
}
