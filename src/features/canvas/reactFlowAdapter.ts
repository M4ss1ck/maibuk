import { MarkerType, type Connection, type Edge, type EdgeMarker, type Node } from "@xyflow/react";
import { CANVAS_TEXT_NODE_DEFAULT_WIDTH, CANVAS_TEXT_NODE_MIN_HEIGHT } from "@/constants";
import {
  DEFAULT_CONNECTION_WIDTH,
  type CanvasEdge,
  type CanvasNode,
  type ConnectionWidth,
} from "@/features/canvas/types";

export type Side = "top" | "right" | "bottom" | "left";
export type SideConnection = {
  connected: boolean;
  incoming: boolean;
  outgoing: boolean;
};

const SIDES: Side[] = ["top", "right", "bottom", "left"];

function emptySides(): Record<Side, SideConnection> {
  return {
    top: { connected: false, incoming: false, outgoing: false },
    right: { connected: false, incoming: false, outgoing: false },
    bottom: { connected: false, incoming: false, outgoing: false },
    left: { connected: false, incoming: false, outgoing: false },
  };
}

function asSide(handle: string | undefined, fallback: Side): Side {
  return (SIDES as string[]).includes(handle ?? "") ? (handle as Side) : fallback;
}

export function computeConnectedSides(
  nodeId: string,
  edges: CanvasEdge[]
): Record<Side, SideConnection> {
  const sides = emptySides();
  for (const edge of edges) {
    if (edge.source === nodeId) {
      const side = asSide(edge.sourceHandle, "right");
      sides[side].connected = true;
      if (edge.directed) sides[side].outgoing = true;
    }
    if (edge.target === nodeId) {
      const side = asSide(edge.targetHandle, "left");
      sides[side].connected = true;
      if (edge.directed) sides[side].incoming = true;
    }
  }
  return sides;
}

export type CanvasFlowNodeData = Record<string, unknown> & {
  node: CanvasNode;
  canvasId: string;
  canvasTitle: string;
  connectedSides: Record<Side, SideConnection>;
};

export type ToFlowNodesOptions = {
  selectedNodeId: string | null;
  canvasId: string;
  canvasTitle: string;
  edges: CanvasEdge[];
};

export type ToFlowEdgesOptions = {
  selectedEdgeId: string | null;
  /** A hovered swatch color, shown on the selected Connection before it is committed. */
  colorPreview?: { edgeId: string; color: string } | null;
};

export function toFlowNodes(
  nodes: CanvasNode[],
  options: ToFlowNodesOptions
): Node<CanvasFlowNodeData>[] {
  return nodes.map((node) => ({
    id: node.id,
    type: node.kind,
    position: node.position,
    selected: node.id === options.selectedNodeId,
    style: node.kind === "text" && node.width ? { width: node.width } : undefined,
    // React Flow keeps a node hidden until it has dimensions. A Text Node's
    // editor mounts inside it, and a hidden element cannot take focus, so a
    // brand-new node's editor would open unfocused (its keystrokes then hit the
    // canvas). Seed the dimensions so the node is visible the moment its
    // editor mounts; React Flow refines the height after measuring.
    initialWidth: node.kind === "text" ? (node.width ?? CANVAS_TEXT_NODE_DEFAULT_WIDTH) : undefined,
    initialHeight: node.kind === "text" ? CANVAS_TEXT_NODE_MIN_HEIGHT : undefined,
    data: {
      node,
      canvasId: options.canvasId,
      canvasTitle: options.canvasTitle,
      connectedSides: computeConnectedSides(node.id, options.edges),
    },
  }));
}

/**
 * Only the style keys a Connection actually sets reach React Flow; an unstyled
 * Connection returns undefined so the theme CSS keeps control of the stroke.
 */
function connectionStyle(
  edge: CanvasEdge,
  color: string | undefined,
  width: ConnectionWidth
): Edge["style"] {
  const style: NonNullable<Edge["style"]> = {};
  if (color) style.stroke = color;
  if (width !== DEFAULT_CONNECTION_WIDTH) style.strokeWidth = width;
  if (edge.lineStyle === "dashed") style.strokeDasharray = `${4 * width} ${3 * width}`;
  if (edge.lineStyle === "dotted") {
    style.strokeDasharray = `0 ${3 * width}`;
    style.strokeLinecap = "round";
  }
  return Object.keys(style).length > 0 ? style : undefined;
}

/**
 * React Flow markers scale with the stroke width (`markerUnits="strokeWidth"`),
 * so shrinking the marker by sqrt(width) keeps the drawn arrow growing with the
 * square root of the width instead of linearly.
 */
function connectionMarker(
  edge: CanvasEdge,
  color: string | undefined,
  width: ConnectionWidth
): EdgeMarker | undefined {
  if (!edge.directed) return undefined;
  const marker: EdgeMarker = { type: MarkerType.ArrowClosed };
  if (color) marker.color = color;
  if (width !== DEFAULT_CONNECTION_WIDTH) {
    marker.width = 12.5 / Math.sqrt(width);
    marker.height = marker.width;
  }
  return marker;
}

export function toFlowEdges(edges: CanvasEdge[], options: ToFlowEdgesOptions): Edge[] {
  return edges.map((edge) => {
    const preview =
      options.colorPreview &&
      options.colorPreview.edgeId === edge.id &&
      edge.id === options.selectedEdgeId
        ? options.colorPreview.color
        : undefined;
    const color = preview ?? edge.color;
    const width = edge.width ?? DEFAULT_CONNECTION_WIDTH;
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      selected: edge.id === options.selectedEdgeId,
      label: edge.label,
      style: connectionStyle(edge, color, width),
      markerEnd: connectionMarker(edge, color, width),
    };
  });
}

/**
 * A Connection made without dragging a handle (from the Connect to… picker)
 * leaves from the side facing the target and enters on the side facing back.
 */
export function connectionBetween(source: CanvasNode, target: CanvasNode): Connection {
  const dx = target.position.x - source.position.x;
  const dy = target.position.y - source.position.y;
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const sourceHandle: Side = horizontal ? (dx >= 0 ? "right" : "left") : dy >= 0 ? "bottom" : "top";
  const targetHandle: Side = horizontal ? (dx >= 0 ? "left" : "right") : dy >= 0 ? "top" : "bottom";
  return { source: source.id, target: target.id, sourceHandle, targetHandle };
}

export function fromConnection(connection: Connection): CanvasEdge | null {
  if (!connection.source || !connection.target) return null;
  return {
    id: crypto.randomUUID(),
    source: connection.source,
    target: connection.target,
    sourceHandle: connection.sourceHandle ?? undefined,
    targetHandle: connection.targetHandle ?? undefined,
    directed: false,
  };
}
