import {
  useRef,
  useState,
  useMemo,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { useReactFlow, type Node } from "@xyflow/react";
import { useCanvasStore } from "../store";
import type { CanvasPosition } from "../types";
import { strokeToPath } from "./strokePath";

function distanceToSegment(p: CanvasPosition, a: CanvasPosition, b: CanvasPosition): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  const t =
    lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  return Math.hypot(p.x - cx, p.y - cy);
}

function centerOf(node: Node): CanvasPosition {
  const width = node.width ?? (node.type === "noteRef" ? 224 : 288);
  const height = node.height ?? (node.type === "noteRef" ? 176 : 48);
  return {
    x: node.position.x + width / 2,
    y: node.position.y + height / 2,
  };
}

export function rectangleFromPoints(a: CanvasPosition, b: CanvasPosition) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

type Rect = { x: number; y: number; width: number; height: number };

export function isPointInRect(p: CanvasPosition, rect: Rect): boolean {
  return (
    p.x >= rect.x && p.x <= rect.x + rect.width && p.y >= rect.y && p.y <= rect.y + rect.height
  );
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function segmentsIntersect(
  a: CanvasPosition,
  b: CanvasPosition,
  c: CanvasPosition,
  d: CanvasPosition
): boolean {
  const ccw = (p1: CanvasPosition, p2: CanvasPosition, p3: CanvasPosition) =>
    (p3.y - p1.y) * (p2.x - p1.x) - (p2.y - p1.y) * (p3.x - p1.x);
  const A = ccw(a, c, d);
  const B = ccw(b, c, d);
  const C = ccw(a, b, c);
  const D = ccw(a, b, d);
  return ((A > 0 && B < 0) || (A < 0 && B > 0)) && ((C > 0 && D < 0) || (C < 0 && D > 0));
}

export function segmentIntersectsRect(
  segment: [CanvasPosition, CanvasPosition],
  rect: Rect
): boolean {
  const [a, b] = segment;
  if (isPointInRect(a, rect) || isPointInRect(b, rect)) return true;
  if (rect.width === 0 || rect.height === 0) return false;
  const minX = rect.x;
  const maxX = rect.x + rect.width;
  const minY = rect.y;
  const maxY = rect.y + rect.height;
  const edges: [CanvasPosition, CanvasPosition][] = [
    [
      { x: minX, y: minY },
      { x: maxX, y: minY },
    ],
    [
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
    ],
    [
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ],
    [
      { x: minX, y: maxY },
      { x: minX, y: minY },
    ],
  ];
  return edges.some((edge) => segmentsIntersect(a, b, edge[0], edge[1]));
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
  const eraseElements = useCanvasStore((state) => state.eraseElements);
  const drawing = useRef(false);
  const [points, setPoints] = useState<CanvasPosition[]>([]);
  const [eraserBox, setEraserBox] = useState<{
    start: CanvasPosition;
    current: CanvasPosition;
  } | null>(null);

  const previewPath = useMemo(() => {
    if (toolMode !== "pen" || points.length === 0) return "";
    const rect = surfaceRef.current?.getBoundingClientRect();
    return strokeToPath(
      points
        .map((point) => reactFlow.flowToScreenPosition(point))
        .map((screen) => ({
          x: screen.x - (rect?.left ?? 0),
          y: screen.y - (rect?.top ?? 0),
        }))
    );
  }, [points, reactFlow, toolMode]);

  const eraserRect = useMemo(() => {
    if (toolMode !== "eraser" || !eraserBox) return null;
    const rect = surfaceRef.current?.getBoundingClientRect();
    const boxRect = rectangleFromPoints(eraserBox.start, eraserBox.current);
    const screenOrigin = reactFlow.flowToScreenPosition({ x: boxRect.x, y: boxRect.y });
    const screenCorner = reactFlow.flowToScreenPosition({
      x: boxRect.x + boxRect.width,
      y: boxRect.y + boxRect.height,
    });
    return {
      x: screenOrigin.x - (rect?.left ?? 0),
      y: screenOrigin.y - (rect?.top ?? 0),
      width: screenCorner.x - screenOrigin.x,
      height: screenCorner.y - screenOrigin.y,
    };
  }, [eraserBox, reactFlow, toolMode]);

  if (toolMode === "select") return null;

  const toFlow = (event: ReactPointerEvent) =>
    reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY });

  const eraseAt = (flow: CanvasPosition) => {
    const zoom = reactFlow.getZoom();
    const threshold = 10 / zoom;
    const state = useCanvasStore.getState();
    const nodes = reactFlow.getNodes();
    const nodeById = new Map(nodes.map((node) => [node.id, node]));

    const strokeIds = new Set<string>();
    const nodeIds = new Set<string>();
    const edgeIds = new Set<string>();

    for (const stroke of state.doc.strokes) {
      for (let i = 1; i < stroke.points.length; i++) {
        if (
          distanceToSegment(flow, stroke.points[i - 1], stroke.points[i]) <=
          threshold + stroke.width / 2
        ) {
          strokeIds.add(stroke.id);
          break;
        }
      }
    }

    for (const node of nodes) {
      const width = node.width ?? (node.type === "noteRef" ? 224 : 288);
      const height = node.height ?? (node.type === "noteRef" ? 176 : 48);
      const hit =
        flow.x >= node.position.x - threshold &&
        flow.x <= node.position.x + width + threshold &&
        flow.y >= node.position.y - threshold &&
        flow.y <= node.position.y + height + threshold;
      if (hit) nodeIds.add(node.id);
    }

    for (const edge of state.doc.edges) {
      if (nodeIds.has(edge.source) || nodeIds.has(edge.target)) {
        edgeIds.add(edge.id);
        continue;
      }
      const source = nodeById.get(edge.source);
      const target = nodeById.get(edge.target);
      if (!source || !target) continue;
      if (distanceToSegment(flow, centerOf(source), centerOf(target)) <= threshold + 4 / zoom) {
        edgeIds.add(edge.id);
      }
    }

    eraseElements(Array.from(strokeIds), Array.from(nodeIds), Array.from(edgeIds));
  };

  const eraseInRectangle = (rect: Rect) => {
    const state = useCanvasStore.getState();
    const nodes = reactFlow.getNodes();
    const nodeById = new Map(nodes.map((node) => [node.id, node]));

    const strokeIds = new Set<string>();
    const nodeIds = new Set<string>();
    const edgeIds = new Set<string>();

    for (const stroke of state.doc.strokes) {
      for (let i = 1; i < stroke.points.length; i++) {
        if (segmentIntersectsRect([stroke.points[i - 1], stroke.points[i]], rect)) {
          strokeIds.add(stroke.id);
          break;
        }
      }
    }

    for (const node of nodes) {
      const width = node.width ?? (node.type === "noteRef" ? 224 : 288);
      const height = node.height ?? (node.type === "noteRef" ? 176 : 48);
      const nodeRect: Rect = { x: node.position.x, y: node.position.y, width, height };
      if (rectsIntersect(rect, nodeRect)) {
        nodeIds.add(node.id);
      }
    }

    for (const edge of state.doc.edges) {
      if (nodeIds.has(edge.source) || nodeIds.has(edge.target)) {
        edgeIds.add(edge.id);
        continue;
      }
      const source = nodeById.get(edge.source);
      const target = nodeById.get(edge.target);
      if (!source || !target) continue;
      if (segmentIntersectsRect([centerOf(source), centerOf(target)], rect)) {
        edgeIds.add(edge.id);
      }
    }

    eraseElements(Array.from(strokeIds), Array.from(nodeIds), Array.from(edgeIds));
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    const flow = toFlow(event);
    if (toolMode === "eraser") {
      setEraserBox({ start: flow, current: flow });
    } else {
      setPoints([flow]);
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drawing.current) return;
    const flow = toFlow(event);
    if (toolMode === "eraser") {
      setEraserBox((previous) =>
        previous ? { ...previous, current: flow } : { start: flow, current: flow }
      );
    } else {
      setPoints((previous) => [...previous, flow]);
    }
  };

  const onPointerUp = () => {
    drawing.current = false;
    if (toolMode === "eraser" && eraserBox) {
      const startScreen = reactFlow.flowToScreenPosition(eraserBox.start);
      const currentScreen = reactFlow.flowToScreenPosition(eraserBox.current);
      const distance = Math.hypot(currentScreen.x - startScreen.x, currentScreen.y - startScreen.y);
      if (distance > 5) {
        eraseInRectangle(rectangleFromPoints(eraserBox.start, eraserBox.current));
      } else {
        eraseAt(eraserBox.start);
      }
    } else if (toolMode === "pen" && points.length >= 2) {
      addStroke({
        id: crypto.randomUUID(),
        points,
        color: penColor,
        width: penWidth,
      });
    }
    setPoints([]);
    setEraserBox(null);
  };

  return (
    <div
      className="absolute inset-0 z-[5]"
      style={{ cursor: "crosshair" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {(toolMode === "pen" && points.length > 0) || eraserRect ? (
        <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full">
          {toolMode === "pen" && previewPath && (
            <path
              d={previewPath}
              stroke={penColor}
              strokeWidth={penWidth}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
          {eraserRect && (
            <rect
              x={eraserRect.x}
              y={eraserRect.y}
              width={eraserRect.width}
              height={eraserRect.height}
              className="fill-destructive/10 stroke-destructive"
              strokeWidth={1}
              strokeDasharray="4 4"
              rx={4}
            />
          )}
        </svg>
      ) : null}
    </div>
  );
}
