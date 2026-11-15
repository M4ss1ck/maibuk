import { MarkerType } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import type { CanvasEdge } from "@/features/canvas/types";
import {
  computeConnectedSides,
  connectionBetween,
  connectionDash,
  fromConnection,
  toFlowEdges,
  toFlowNodes,
} from "@/features/canvas/reactFlowAdapter";

describe("Canvas React Flow adapter", () => {
  it("maps store-owned node and edge selection", () => {
    const nodes = toFlowNodes(
      [{ id: "node", kind: "text", html: "<p>Idea</p>", position: { x: 0, y: 0 } }],
      { selectedNodeId: "node", canvasId: "canvas", canvasTitle: "Map", edges: [] }
    );
    const edges = toFlowEdges(
      [{ id: "edge", source: "node", target: "node", directed: true, label: "Loop" }],
      { selectedEdgeId: "edge" }
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
      { selectedNodeId: null, canvasId: "canvas", canvasTitle: "Map", edges: [] }
    );
    expect(nodes[0].style).toEqual({ width: 360 });
    expect(nodes[1].style).toBeUndefined();
  });

  it("sizes an Image node's box from its stored width and height", () => {
    const nodes = toFlowNodes(
      [
        {
          id: "image",
          kind: "image",
          src: "data:image/png;base64,AA",
          width: 320,
          height: 240,
          position: { x: 0, y: 0 },
        },
      ],
      { selectedNodeId: null, canvasId: "canvas", canvasTitle: "Map", edges: [] }
    );
    expect(nodes[0].style).toEqual({ width: 320, height: 240 });
    expect(nodes[0].initialWidth).toBe(320);
    expect(nodes[0].initialHeight).toBe(240);
  });

  it("preserves handle IDs when creating a domain edge", () => {
    expect(
      fromConnection({ source: "a", target: "b", sourceHandle: "out", targetHandle: "in" })
    ).toMatchObject({
      source: "a",
      target: "b",
      sourceHandle: "out",
      targetHandle: "in",
      directed: false,
    });
  });
});

describe("toFlowEdges Connection styles", () => {
  const edge = (overrides: Partial<CanvasEdge> = {}): CanvasEdge => ({
    id: "edge",
    source: "a",
    target: "b",
    ...overrides,
  });

  it("leaves an unstyled Connection to the theme", () => {
    const [flow] = toFlowEdges([edge({ directed: true })], { selectedEdgeId: null });
    expect(flow.style).toBeUndefined();
    expect(flow.markerEnd).toEqual({ type: MarkerType.ArrowClosed });
  });

  it("draws color, width, and a dashed pattern, scaling the arrow by sqrt(width)", () => {
    const [flow] = toFlowEdges(
      [edge({ directed: true, color: "#cc0000", width: 4, lineStyle: "dashed" })],
      { selectedEdgeId: null }
    );
    expect(flow.style).toEqual({
      stroke: "#cc0000",
      strokeWidth: 4,
      strokeDasharray: "16 12",
    });
    expect(flow.markerEnd).toEqual({
      type: MarkerType.ArrowClosed,
      color: "#cc0000",
      width: 6.25,
      height: 6.25,
    });
  });

  it("draws a dotted pattern with round caps", () => {
    const [flow] = toFlowEdges([edge({ width: 2, lineStyle: "dotted" })], {
      selectedEdgeId: null,
    });
    expect(flow.style).toEqual({
      strokeWidth: 2,
      strokeDasharray: "0 6",
      strokeLinecap: "round",
    });
    expect(flow.markerEnd).toBeUndefined();
  });

  it("previews a color on the selected Connection", () => {
    const [flow] = toFlowEdges([edge({ color: "#111111" })], {
      selectedEdgeId: "edge",
      colorPreview: { edgeId: "edge", color: "#00ff00" },
    });
    expect(flow.style).toEqual({ stroke: "#00ff00" });
  });

  it("ignores a color preview for a Connection that is not selected", () => {
    const [flow] = toFlowEdges([edge({ color: "#111111" })], {
      selectedEdgeId: null,
      colorPreview: { edgeId: "edge", color: "#00ff00" },
    });
    expect(flow.style).toEqual({ stroke: "#111111" });
  });
});

describe("connectionDash", () => {
  it("dashes at the width and leaves solid plain", () => {
    expect(connectionDash(undefined, 2)).toEqual({});
    expect(connectionDash("solid", 2)).toEqual({});
    expect(connectionDash("dashed", 2)).toEqual({ strokeDasharray: "8 6" });
    expect(connectionDash("dotted", 2)).toEqual({ strokeDasharray: "0 6", strokeLinecap: "round" });
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

describe("connectionBetween", () => {
  const at = (id: string, x: number, y: number) => ({
    id,
    kind: "text" as const,
    html: "",
    position: { x, y },
  });

  it("leaves and enters on the sides that face each other", () => {
    expect(connectionBetween(at("a", 0, 0), at("b", 300, 40))).toMatchObject({
      sourceHandle: "right",
      targetHandle: "left",
    });
    expect(connectionBetween(at("a", 0, 0), at("b", -300, 40))).toMatchObject({
      sourceHandle: "left",
      targetHandle: "right",
    });
    expect(connectionBetween(at("a", 0, 0), at("b", 40, 300))).toMatchObject({
      sourceHandle: "bottom",
      targetHandle: "top",
    });
    expect(connectionBetween(at("a", 0, 0), at("b", 40, -300))).toMatchObject({
      source: "a",
      target: "b",
      sourceHandle: "top",
      targetHandle: "bottom",
    });
  });
});
