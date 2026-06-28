import { MarkerType } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import {
  fromConnection,
  toFlowEdges,
  toFlowNodes,
} from "../../../../features/canvas/reactFlowAdapter";

describe("Canvas React Flow adapter", () => {
  it("maps store-owned node and edge selection", () => {
    const nodes = toFlowNodes(
      [{ id: "node", kind: "text", text: "Idea", position: { x: 0, y: 0 } }],
      { selectedNodeId: "node", canvasId: "canvas", canvasTitle: "Map" },
    );
    const edges = toFlowEdges(
      [{ id: "edge", source: "node", target: "node", directed: true, label: "Loop" }],
      { selectedEdgeId: "edge" },
    );
    expect(nodes[0].selected).toBe(true);
    expect(edges[0]).toMatchObject({
      selected: true,
      label: "Loop",
      markerEnd: { type: MarkerType.ArrowClosed },
    });
  });

  it("preserves handle IDs when creating a domain edge", () => {
    expect(
      fromConnection({ source: "a", target: "b", sourceHandle: "out", targetHandle: "in" }),
    ).toMatchObject({
      source: "a",
      target: "b",
      sourceHandle: "out",
      targetHandle: "in",
      directed: false,
    });
  });
});
