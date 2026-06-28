import { MarkerType, type Connection, type Edge, type Node } from "@xyflow/react";
import type { CanvasEdge, CanvasNode } from "./types";

export type CanvasFlowNodeData = Record<string, unknown> & {
  node: CanvasNode;
  canvasId: string;
  canvasTitle: string;
};

export type ToFlowNodesOptions = {
  selectedNodeId: string | null;
  canvasId: string;
  canvasTitle: string;
};

export type ToFlowEdgesOptions = {
  selectedEdgeId: string | null;
};

export function toFlowNodes(
  nodes: CanvasNode[],
  options: ToFlowNodesOptions,
): Node<CanvasFlowNodeData>[] {
  return nodes.map((node) => ({
    id: node.id,
    type: node.kind,
    position: node.position,
    selected: node.id === options.selectedNodeId,
    data: {
      node,
      canvasId: options.canvasId,
      canvasTitle: options.canvasTitle,
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
