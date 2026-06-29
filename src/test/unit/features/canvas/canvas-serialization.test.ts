import { describe, expect, it } from "vitest";
import {
  CURRENT_CANVAS_SCHEMA_VERSION,
  DEFAULT_CANVAS_DOC_JSON,
} from "../../../../lib/canvas/defaultDoc";
import {
  normalizeParsedCanvasDoc,
  parseCanvasDoc,
  serializeCanvasDoc,
} from "../../../../features/canvas/serialization";
import { createDefaultCanvasDoc } from "../../../../features/canvas/types";

describe("canvas document serialization", () => {
  it("round-trips a valid document", () => {
    const doc = {
      ...createDefaultCanvasDoc(),
      nodes: [{ id: "a", kind: "text" as const, html: "<p>Idea</p>", position: { x: 1, y: 2 } }],
      viewport: { x: 10, y: -20, zoom: 1.5 },
    };
    expect(parseCanvasDoc(serializeCanvasDoc(doc))).toEqual({ ok: true, doc, migrated: false });
  });

  it.each([undefined, null, "", "   "])("returns the default for missing input %s", (raw) => {
    expect(parseCanvasDoc(raw)).toEqual({
      ok: true,
      doc: createDefaultCanvasDoc(),
      migrated: false,
    });
  });

  it("returns a protected failure for corrupt JSON", () => {
    const result = parseCanvasDoc("{");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("corrupt-json");
    expect(result.doc).toEqual(createDefaultCanvasDoc());
  });

  it("rejects a future schema version", () => {
    const result = normalizeParsedCanvasDoc({
      schemaVersion: 999,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unsupported-version");
  });

  it("drops invalid nodes and edges connected to missing nodes", () => {
    const result = normalizeParsedCanvasDoc({
      schemaVersion: 1,
      nodes: [
        { id: "valid", kind: "text", text: "yes", position: { x: 0, y: 0 } },
        { id: "invalid", kind: "text", position: { x: 0, y: 0 } },
      ],
      edges: [
        { id: "dangling", source: "valid", target: "missing" },
        { id: "also-invalid", source: 3, target: "valid" },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    expect(result.ok).toBe(true);
    expect(result.doc.nodes.map((node) => node.id)).toEqual(["valid"]);
    expect(result.doc.edges).toEqual([]);
  });

  it("preserves note references without resolving notes", () => {
    const result = normalizeParsedCanvasDoc({
      schemaVersion: 1,
      nodes: [
        {
          id: "ref",
          kind: "noteRef",
          noteId: "deleted-note",
          label: "  Cached title  ",
          position: { x: 2, y: 3 },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    expect(result.ok).toBe(true);
    expect(result.doc.nodes[0]).toMatchObject({ noteId: "deleted-note", label: "Cached title" });
  });

  it("normalizes empty edge labels and restores viewport", () => {
    const result = normalizeParsedCanvasDoc({
      schemaVersion: 1,
      nodes: [
        { id: "a", kind: "text", text: "a", position: { x: 0, y: 0 } },
        { id: "b", kind: "text", text: "b", position: { x: 1, y: 1 } },
      ],
      edges: [{ id: "edge", source: "a", target: "b", label: "   " }],
      viewport: { x: 12, y: 34, zoom: 2 },
    });
    expect(result.ok).toBe(true);
    expect(result.doc.edges[0].label).toBeUndefined();
    expect(result.doc.viewport).toEqual({ x: 12, y: 34, zoom: 2 });
  });

  it("uses the canonical default JSON", () => {
    expect(serializeCanvasDoc(createDefaultCanvasDoc())).toBe(DEFAULT_CANVAS_DOC_JSON);
  });

  it("keeps valid text-node widths and drops invalid ones", () => {
    const result = normalizeParsedCanvasDoc({
      schemaVersion: 2,
      nodes: [
        { id: "valid", kind: "text", html: "<p>a</p>", position: { x: 0, y: 0 }, width: 320 },
        { id: "small", kind: "text", html: "<p>b</p>", position: { x: 0, y: 0 }, width: 100 },
        {
          id: "nonfinite",
          kind: "text",
          html: "<p>c</p>",
          position: { x: 0, y: 0 },
          width: Number.POSITIVE_INFINITY,
        },
        { id: "nonnumber", kind: "text", html: "<p>d</p>", position: { x: 0, y: 0 }, width: "320" },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    expect(result.ok).toBe(true);
    expect(result.doc.nodes).toMatchObject([
      { id: "valid", width: 320 },
      { id: "small", width: undefined },
      { id: "nonfinite", width: undefined },
      { id: "nonnumber", width: undefined },
    ]);
  });
});

describe("canvas schema v1 -> v2 migration", () => {
  it("migrates v1 text nodes to html and adds an empty strokes array", () => {
    const result = normalizeParsedCanvasDoc({
      schemaVersion: 1,
      nodes: [
        {
          id: "a",
          kind: "text",
          text: "Hello <world>",
          position: { x: 1, y: 2 },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.migrated).toBe(true);
      expect(result.doc.schemaVersion).toBe(CURRENT_CANVAS_SCHEMA_VERSION);
      expect(result.doc.nodes[0]).toMatchObject({
        id: "a",
        kind: "text",
        html: "<p>Hello &lt;world&gt;</p>",
      });
      expect(result.doc.strokes).toEqual([]);
    }
  });

  it("keeps valid v2 strokes and drops malformed ones", () => {
    const result = normalizeParsedCanvasDoc({
      schemaVersion: 2,
      nodes: [],
      edges: [],
      strokes: [
        {
          id: "s1",
          points: [
            { x: 0, y: 0 },
            { x: 5, y: 5 },
          ],
          color: "#f00",
          width: 3,
        },
        { id: "s2", points: "nope", color: "#f00", width: 3 },
        { id: "s3", points: [{ x: 0, y: 0 }], color: "#f00", width: 0 },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.doc.strokes.map((s) => s.id)).toEqual(["s1"]);
  });
});
