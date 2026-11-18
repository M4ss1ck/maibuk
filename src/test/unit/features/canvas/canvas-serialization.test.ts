import { describe, expect, it } from "vitest";
import { CURRENT_CANVAS_SCHEMA_VERSION, DEFAULT_CANVAS_DOC_JSON } from "@/lib/canvas/defaultDoc";
import {
  normalizeParsedCanvasDoc,
  parseCanvasDoc,
  serializeCanvasDoc,
} from "@/features/canvas/serialization";
import { createDefaultCanvasDoc } from "@/features/canvas/types";

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

  it("preserves references without resolving their targets", () => {
    const result = normalizeParsedCanvasDoc({
      schemaVersion: 1,
      nodes: [
        {
          id: "ref",
          kind: "reference",
          source: "note",
          targetId: "deleted-note",
          label: "  Cached title  ",
          position: { x: 2, y: 3 },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    expect(result.ok).toBe(true);
    expect(result.doc.nodes[0]).toMatchObject({
      source: "note",
      targetId: "deleted-note",
      label: "Cached title",
    });
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

  it("keeps valid connection styles", () => {
    const result = normalizeParsedCanvasDoc({
      schemaVersion: CURRENT_CANVAS_SCHEMA_VERSION,
      nodes: [
        { id: "a", kind: "text", html: "<p>a</p>", position: { x: 0, y: 0 } },
        { id: "b", kind: "text", html: "<p>b</p>", position: { x: 1, y: 1 } },
      ],
      edges: [
        { id: "edge", source: "a", target: "b", color: "#ef4444", width: 4, lineStyle: "dotted" },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    expect(result.ok).toBe(true);
    expect(result.doc.edges[0]).toMatchObject({
      color: "#ef4444",
      width: 4,
      lineStyle: "dotted",
    });
  });

  it.each([
    { name: "width 3", style: { width: 3 } },
    { name: 'width "4"', style: { width: "4" } },
    { name: "width 1", style: { width: 1 } },
    { name: 'lineStyle "solid"', style: { lineStyle: "solid" } },
    { name: 'lineStyle "wavy"', style: { lineStyle: "wavy" } },
    { name: 'color "  "', style: { color: "  " } },
  ])("drops an invalid connection style ($name) and keeps the connection", ({ style }) => {
    const result = normalizeParsedCanvasDoc({
      schemaVersion: CURRENT_CANVAS_SCHEMA_VERSION,
      nodes: [
        { id: "a", kind: "text", html: "<p>a</p>", position: { x: 0, y: 0 } },
        { id: "b", kind: "text", html: "<p>b</p>", position: { x: 1, y: 1 } },
      ],
      edges: [{ id: "edge", source: "a", target: "b", ...style }],
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    expect(result.ok).toBe(true);
    expect(result.doc.edges.map((edge) => edge.id)).toEqual(["edge"]);
    expect(result.doc.edges[0]).toMatchObject({
      color: undefined,
      width: undefined,
      lineStyle: undefined,
    });
  });

  it("leaves connection styles undefined when absent", () => {
    const result = normalizeParsedCanvasDoc({
      schemaVersion: CURRENT_CANVAS_SCHEMA_VERSION,
      nodes: [
        { id: "a", kind: "text", html: "<p>a</p>", position: { x: 0, y: 0 } },
        { id: "b", kind: "text", html: "<p>b</p>", position: { x: 1, y: 1 } },
      ],
      edges: [{ id: "edge", source: "a", target: "b" }],
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    expect(result.ok).toBe(true);
    expect(result.doc.edges[0]).toMatchObject({
      color: undefined,
      width: undefined,
      lineStyle: undefined,
    });
  });

  it("uses the canonical default JSON", () => {
    expect(serializeCanvasDoc(createDefaultCanvasDoc())).toBe(DEFAULT_CANVAS_DOC_JSON);
  });

  it("keeps valid text-node widths and drops invalid ones", () => {
    const result = normalizeParsedCanvasDoc({
      schemaVersion: CURRENT_CANVAS_SCHEMA_VERSION,
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

describe("canvas image nodes (#813)", () => {
  const imageNode = {
    id: "img",
    kind: "image" as const,
    src: "data:image/png;base64,iVBORw0KGgo=",
    width: 320,
    height: 200,
    position: { x: 4, y: 5 },
  };

  it("round-trips an image node with its alt text and file name", () => {
    const doc = {
      ...createDefaultCanvasDoc(),
      nodes: [{ ...imageNode, alt: "A cat", fileName: "cat.png" }],
    };
    expect(parseCanvasDoc(serializeCanvasDoc(doc))).toEqual({ ok: true, doc, migrated: false });
  });

  it("drops an empty alt text and keeps the file name", () => {
    const result = normalizeParsedCanvasDoc({
      schemaVersion: CURRENT_CANVAS_SCHEMA_VERSION,
      nodes: [{ ...imageNode, alt: "   ", fileName: "  cat.png  " }],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    expect(result.ok).toBe(true);
    expect(result.doc.nodes[0]).toMatchObject({ alt: undefined, fileName: "cat.png" });
  });

  it.each([
    { name: "a hotlinked source", override: { src: "https://example.com/cat.png" } },
    { name: "a zero width", override: { width: 0 } },
    { name: "a negative height", override: { height: -120 } },
    { name: "a NaN width", override: { width: Number.NaN } },
    { name: "a non-number height", override: { height: "200" } },
  ])("drops an image node with $name and its Connections", ({ override }) => {
    const result = normalizeParsedCanvasDoc({
      schemaVersion: CURRENT_CANVAS_SCHEMA_VERSION,
      nodes: [
        { id: "text", kind: "text", html: "<p>t</p>", position: { x: 0, y: 0 } },
        { ...imageNode, ...override },
      ],
      edges: [{ id: "edge", source: "img", target: "text" }],
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    expect(result.ok).toBe(true);
    expect(result.doc.nodes.map((node) => node.id)).toEqual(["text"]);
    expect(result.doc.edges).toEqual([]);
  });

  it("reads a v3 document's text and reference nodes at the current version", () => {
    const result = normalizeParsedCanvasDoc({
      schemaVersion: 3,
      nodes: [
        {
          id: "text",
          kind: "text",
          html: "<p>Idea</p>",
          textColor: "#ef4444",
          position: { x: 1, y: 2 },
        },
        {
          id: "ref",
          kind: "noteRef",
          noteId: "note-1",
          label: "Note",
          position: { x: 3, y: 4 },
        },
      ],
      edges: [],
      strokes: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(CURRENT_CANVAS_SCHEMA_VERSION).toBe(5);
      expect(result.doc.schemaVersion).toBe(5);
      expect(result.migrated).toBe(true);
      expect(result.doc.nodes).toMatchObject([
        { id: "text", kind: "text", html: "<p>Idea</p>", textColor: "#ef4444" },
        { id: "ref", kind: "reference", source: "note", targetId: "note-1", label: "Note" },
      ]);
    }
  });

  it("does not flag a v4 document without noteRef nodes as migrated", () => {
    const result = normalizeParsedCanvasDoc({
      schemaVersion: 4,
      nodes: [{ ...imageNode }],
      edges: [],
      strokes: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    expect(result).toMatchObject({ ok: true, migrated: false, doc: { schemaVersion: 5 } });
  });

  it("rejects a schema version 6 document as future", () => {
    const result = normalizeParsedCanvasDoc({
      schemaVersion: 6,
      nodes: [{ ...imageNode }],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unsupported-version");
    expect(result.doc).toEqual(createDefaultCanvasDoc());
  });
});

describe("canvas schema v4 -> v5 migration", () => {
  it("renames a noteRef node to a reference node with source note", () => {
    const result = normalizeParsedCanvasDoc({
      schemaVersion: 4,
      nodes: [
        {
          id: "ref",
          kind: "noteRef",
          noteId: "note-1",
          label: "  Note  ",
          position: { x: 1, y: 2 },
        },
      ],
      edges: [],
      strokes: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migrated).toBe(true);
    expect(result.doc.schemaVersion).toBe(5);
    expect(result.doc.nodes[0]).toEqual({
      id: "ref",
      kind: "reference",
      source: "note",
      targetId: "note-1",
      label: "Note",
      position: { x: 1, y: 2 },
    });

    const raw = serializeCanvasDoc(result.doc);
    expect(raw).not.toContain("noteRef");
    expect(JSON.parse(raw).schemaVersion).toBe(5);
    expect(parseCanvasDoc(raw)).toEqual({ ok: true, doc: result.doc, migrated: false });
  });

  it("keeps an unknown reference source and round-trips it unchanged", () => {
    const doc = {
      ...createDefaultCanvasDoc(),
      nodes: [
        {
          id: "ref",
          kind: "reference" as const,
          source: "plugin.maps.maps",
          targetId: "map-1",
          position: { x: 1, y: 2 },
        },
      ],
    };
    const parsed = parseCanvasDoc(serializeCanvasDoc(doc));
    expect(parsed).toEqual({ ok: true, doc, migrated: false });
    if (parsed.ok) {
      expect(parsed.doc.nodes[0]).toMatchObject({ source: "plugin.maps.maps" });
      expect(parseCanvasDoc(serializeCanvasDoc(parsed.doc))).toEqual(parsed);
    }
  });

  it("drops a reference node without a targetId or with an empty source", () => {
    const result = normalizeParsedCanvasDoc({
      schemaVersion: CURRENT_CANVAS_SCHEMA_VERSION,
      nodes: [
        { id: "no-target", kind: "reference", source: "note", position: { x: 0, y: 0 } },
        {
          id: "empty-source",
          kind: "reference",
          source: "",
          targetId: "note-1",
          position: { x: 0, y: 0 },
        },
        {
          id: "kept",
          kind: "reference",
          source: "note",
          targetId: "note-1",
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.doc.nodes.map((node) => node.id)).toEqual(["kept"]);
  });
});

describe("canvas schema v2 -> v3 migration", () => {
  it("renames the existing text color and keeps the background transparent", () => {
    const result = normalizeParsedCanvasDoc({
      schemaVersion: 2,
      nodes: [
        {
          id: "a",
          kind: "text",
          html: "<p>Idea</p>",
          color: "#ef4444",
          position: { x: 1, y: 2 },
        },
      ],
      edges: [],
      strokes: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.migrated).toBe(true);
      expect(result.doc.nodes[0]).toMatchObject({
        textColor: "#ef4444",
        backgroundColor: undefined,
      });
      expect(result.doc.nodes[0]).not.toHaveProperty("color");
    }
  });
});
