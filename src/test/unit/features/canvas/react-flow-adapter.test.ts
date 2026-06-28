import { MarkerType } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import {
  computeConnectedSides,
  fromConnection,
  toFlowEdges,
  toFlowNodes,
} from "../../../../features/canvas/reactFlowAdapter";

describe("Canvas React Flow adapter", () => {
  it("maps store-owned node and edge selection", () => {
    const nodes = toFlowNodes(
      [{ id: "node", kind: "text", html: "<p>Idea</p>", position: { x: 0, y: 0 } }],
      { selectedNodeId: "node", canvasId: "canvas", canvasTitle: "Map", edges: [] },
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

  it("passes a persisted width as a node style and omits style otherwise", () => {
    const nodes = toFlowNodes(
      [
        { id: "sized", kind: "text", html: "<p>a</p>", position: { x: 0, y: 0 }, width: 360 },
        { id: "auto", kind: "text", html: "<p>b</p>", position: { x: 0, y: 0 } },
      ],
      { selectedNodeId: null, canvasId: "canvas", canvasTitle: "Map", edges: [] },
    );
    expect(nodes[0].style).toEqual({ width: 360 });
    expect(nodes[1].style).toBeUndefined();
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

describe("computeConnectedSides", () => {
  it("marks undirected connections as connected without direction", () => {
    const sides = computeConnectedSides("a", [
      {
        id: "e1",
        source: "a",
        target: "b",
        sourceHandle: "right",
        targetHandle: "left",
      },
    ]);
    expect(sides.right).toEqual({
      connected: true,
      incoming: false,
      outgoing: false,
    });
    expect(sides.left).toEqual({
      connected: false,
      incoming: false,
      outgoing: false,
    });
  });

  it("marks directed direction per side for source and target nodes", () => {
    const edges = [
      {
        id: "e1",
        source: "a",
        target: "b",
        sourceHandle: "right",
        targetHandle: "top",
        directed: true,
      },
    ];
    const a = computeConnectedSides("a", edges);
    const b = computeConnectedSides("b", edges);
    expect(a.right).toEqual({
      connected: true,
      incoming: false,
      outgoing: true,
    });
    expect(b.top).toEqual({ connected: true, incoming: true, outgoing: false });
  });

  it("defaults a missing handle to the right (source) / left (target)", () => {
    const sides = computeConnectedSides("a", [{ id: "e1", source: "a", target: "b" }]);
    expect(sides.right.connected).toBe(true);
  });
});
