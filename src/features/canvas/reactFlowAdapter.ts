import { MarkerType, type Connection, type Edge, type Node } from "@xyflow/react";
import type { CanvasEdge, CanvasNode } from "./types";

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
    data: {
      node,
      canvasId: options.canvasId,
      canvasTitle: options.canvasTitle,
      connectedSides: computeConnectedSides(node.id, options.edges),
    },
  }));
}

export function toFlowEdges(edges: CanvasEdge[], options: ToFlowEdgesOptions): Edge[] {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
    selected: edge.id === options.selectedEdgeId,
    label: edge.label,
    markerEnd: edge.directed ? { type: MarkerType.ArrowClosed } : undefined,
  }));
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
