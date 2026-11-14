/**
 * The Maps Frame wire protocol's rasterize pair (#753): the request the Worker
 * sends so the Frame's document, which alone has a canvas and may load an
 * image, turns the export SVG into pixels, and the reply it answers with. The
 * Frame mirrors the request shape in `assets/ui/map.js`; the Worker validates
 * every reply here before it reaches the editor.
 *
 * The asset ingest pair (#756) is validated here too: the Frame cleans and
 * measures an uploaded picture, and the Worker keeps only what came back.
 *
 * The pointer zoom and pan requests (#777) are validated here as well: the
 * Frame measures a wheel or a drag and the editor, which owns the view, applies
 * it.
 */

import { describe, expect, it } from "vitest";
import type { MapAsset } from "./assets";
import { assetMessage, parseFrameMessage, rasterizeMessage, sceneMessage } from "./frame-protocol";
import type { MapDocument, MapImageElement, MapStampElement } from "./maps";
import { mapLibrary } from "./scene";

/** A PNG's first bytes, enough to tell one reply's bytes from another's. */
function pngBytes(): ArrayBuffer {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer;
}

describe("rasterizeMessage()", () => {
  it("builds a PNG request carrying the SVG, the pixel size, and the id", () => {
    expect(rasterizeMessage(7, "<svg/>", { widthPx: 900, heightPx: 1350 }, "png")).toEqual({
      kind: "rasterize",
      requestId: 7,
      svg: "<svg/>",
      widthPx: 900,
      heightPx: 1350,
      format: "png",
    });
  });

  it("carries the JPEG quality the caller asks for", () => {
    expect(
      rasterizeMessage(8, "<svg/>", { widthPx: 800, heightPx: 600 }, { jpeg: 0.85 }).format
    ).toEqual({ jpeg: 0.85 });
  });
});

describe("parseFrameMessage() for a rasterize reply", () => {
  it("reads the encoded bytes and the request they answer", () => {
    const bytes = pngBytes();
    expect(parseFrameMessage({ kind: "rasterized", requestId: 7, bytes })).toEqual({
      kind: "rasterized",
      requestId: 7,
      bytes,
    });
  });

  it("reads an error reply", () => {
    expect(parseFrameMessage({ kind: "rasterized", requestId: 7, error: "no canvas" })).toEqual({
      kind: "rasterized",
      requestId: 7,
      error: "no canvas",
    });
  });

  it("drops a malformed reply", () => {
    const bytes = pngBytes();
    for (const message of [
      { kind: "rasterized" },
      { kind: "rasterized", requestId: "7", bytes },
      { kind: "rasterized", requestId: 7 },
      { kind: "rasterized", requestId: 7, bytes: "not bytes" },
      { kind: "rasterized", requestId: 7, error: "" },
      { kind: "rasterized", requestId: 7, bytes, error: "both" },
    ]) {
      expect(parseFrameMessage(message)).toBeNull();
    }
  });

  it("does not read the Worker's own request back as a Frame message", () => {
    expect(
      parseFrameMessage(rasterizeMessage(1, "<svg/>", { widthPx: 10, heightPx: 10 }, "png"))
    ).toBeNull();
  });
});

describe("parseFrameMessage() for an asset ingest reply", () => {
  const SVG = "PHN2Zy8+";

  it("reads what the Frame measured and the bytes the Library keeps", () => {
    expect(
      parseFrameMessage({
        kind: "asset-ingested",
        requestId: 3,
        data: SVG,
        width: 24,
        height: 36,
        recolorable: true,
      })
    ).toEqual({
      kind: "asset-ingested",
      requestId: 3,
      data: SVG,
      width: 24,
      height: 36,
      recolorable: true,
    });
  });

  it("reads a refused upload under its own request id", () => {
    expect(
      parseFrameMessage({ kind: "ingest-error", requestId: 4, reason: "invalid-image" })
    ).toEqual({ kind: "ingest-error", requestId: 4, reason: "invalid-image" });
  });

  it("drops an ingest reply that could not be stored", () => {
    const valid = {
      kind: "asset-ingested",
      requestId: 3,
      data: SVG,
      width: 24,
      height: 36,
      recolorable: true,
    };
    for (const message of [
      { ...valid, requestId: undefined },
      { ...valid, requestId: "3" },
      { ...valid, data: "" },
      { ...valid, data: 7 },
      // A picture of no size would draw nothing, and the Library refuses it.
      { ...valid, width: 0 },
      { ...valid, height: -1 },
      { ...valid, width: Number.NaN },
      { ...valid, recolorable: "yes" },
      { ...valid, recolorable: undefined },
      { kind: "ingest-error", requestId: 4, reason: "too-large" },
      { kind: "ingest-error", requestId: 4 },
      { kind: "ingest-error", reason: "invalid-image" },
    ]) {
      expect(parseFrameMessage(message)).toBeNull();
    }
  });

  it("does not read the Worker's own ingest request back as a Frame message", () => {
    expect(
      parseFrameMessage({
        kind: "ingest-asset",
        requestId: 5,
        mime: "image/svg+xml",
        data: SVG,
      })
    ).toBeNull();
    expect(parseFrameMessage({ kind: "asset", id: "a1", mime: "image/png", data: SVG })).toBeNull();
  });
});

describe("parseFrameMessage() for a zoom or a pan request", () => {
  it("reads a zoom around one page point", () => {
    expect(parseFrameMessage({ kind: "zoom", point: [60, 25], factor: 1.25 })).toEqual({
      kind: "zoom",
      point: [60, 25],
      factor: 1.25,
    });
  });

  it("reads one step of a pan", () => {
    expect(parseFrameMessage({ kind: "pan", dx: -10, dy: 5 })).toEqual({
      kind: "pan",
      dx: -10,
      dy: 5,
    });
  });

  it("drops a zoom with no point, or a factor that cannot zoom", () => {
    for (const message of [
      { kind: "zoom", factor: 1.25 },
      { kind: "zoom", point: [60, 25] },
      { kind: "zoom", point: [60], factor: 1.25 },
      { kind: "zoom", point: [60, Number.NaN], factor: 1.25 },
      { kind: "zoom", point: "60,25", factor: 1.25 },
      // A factor of zero or less would collapse or flip the view.
      { kind: "zoom", point: [60, 25], factor: 0 },
      { kind: "zoom", point: [60, 25], factor: -1 },
      { kind: "zoom", point: [60, 25], factor: Number.POSITIVE_INFINITY },
      { kind: "zoom", point: [60, 25], factor: "1.25" },
    ]) {
      expect(parseFrameMessage(message)).toBeNull();
    }
  });

  it("drops a pan that is not a pair of finite millimetres", () => {
    for (const message of [
      { kind: "pan" },
      { kind: "pan", dx: 10 },
      { kind: "pan", dx: 10, dy: Number.NaN },
      { kind: "pan", dx: 10, dy: Number.POSITIVE_INFINITY },
      { kind: "pan", dx: "10", dy: 5 },
    ]) {
      expect(parseFrameMessage(message)).toBeNull();
    }
  });

  it("does not read the scene that already carries the view as a gesture", () => {
    expect(parseFrameMessage({ kind: "scene", zoom: 2, panX: 10, panY: -5 })).toBeNull();
  });
});

describe("assetMessage()", () => {
  it("hands the Frame one picture's bytes under its asset id", () => {
    const asset: MapAsset = {
      id: "a1",
      name: "Coast",
      mime: "image/png",
      data: "AAAA",
      width: 40,
      height: 20,
      recolorable: false,
    };

    expect(assetMessage(asset)).toEqual({
      kind: "asset",
      id: "a1",
      mime: "image/png",
      data: "AAAA",
    });
  });
});

describe("sceneMessage() with the Library's pictures", () => {
  /** A square Map holding one Map Image of the picture `a1`. */
  const scan: MapImageElement = {
    id: "scan",
    kind: "image",
    name: "The Reach",
    hidden: false,
    locked: false,
    assetRef: "a1",
    transform: { x: 40, y: 60, size: 80, rotation: 0 },
    opacity: 1,
    exportable: true,
  };
  const map = {
    page: { preset: "square" as const, widthMm: 203.2, heightMm: 203.2 },
    elements: [scan],
    styleId: "atlas",
  } satisfies Pick<MapDocument, "page" | "elements" | "styleId">;
  const view = {
    selectedId: null,
    tool: "select" as const,
    zoom: 1,
    panX: 0,
    panY: 0,
    penLabel: { one: "Pen line, {{count}} point", other: "Pen line, {{count}} points" },
    readout: {
      size: "{{value}} mm",
      angle: "{{value}}°",
      shape: "{{width}} × {{height}} mm",
      label: "Cap {{size}} mm · {{width}} mm",
    },
  };

  it("carries the picture's primitive, by id, in the scene the Frame draws", () => {
    const message = sceneMessage(map, view, {
      library: mapLibrary([
        {
          id: "a1",
          name: "Coast",
          mime: "image/png",
          width: 40,
          height: 20,
          recolorable: false,
          use: "image",
        },
      ]),
    });

    expect(message.elements[0].shapes).toEqual([
      {
        kind: "image",
        assetId: "a1",
        x: 40,
        y: 60,
        width: 80,
        height: 40,
        rotation: 0,
        opacity: 1,
      },
    ]);
    // The bytes never ride in the scene; the Frame is sent them once by id.
    expect(JSON.stringify(message)).not.toContain("data:");
  });

  it("draws nothing for a picture the Library is not asked about", () => {
    const message = sceneMessage(map, view);

    expect(message.elements[0].shapes).toEqual([]);
  });
});

describe("the transformElement message (#795)", () => {
  const box = { x: 10, y: 20, width: 30, height: 15, rotation: 45 };

  it("reads the box a handle drag asks for", () => {
    expect(parseFrameMessage({ kind: "transformElement", id: "e1", box })).toEqual({
      kind: "transformElement",
      id: "e1",
      box,
    });
  });

  it("reads the cap size a Map Label's corner asks for", () => {
    expect(parseFrameMessage({ kind: "transformElement", id: "l1", box, size: 7 })).toEqual({
      kind: "transformElement",
      id: "l1",
      box,
      size: 7,
    });
  });

  it("drops a malformed box", () => {
    for (const message of [
      { kind: "transformElement", box },
      { kind: "transformElement", id: "", box },
      { kind: "transformElement", id: "e1" },
      { kind: "transformElement", id: "e1", box: { ...box, width: 0 } },
      { kind: "transformElement", id: "e1", box: { ...box, height: -1 } },
      { kind: "transformElement", id: "e1", box: { ...box, rotation: "45" } },
      { kind: "transformElement", id: "e1", box: { ...box, x: Number.NaN } },
      { kind: "transformElement", id: "e1", box: { ...box, y: Number.POSITIVE_INFINITY } },
      { kind: "transformElement", id: "e1", box, size: 0 },
      { kind: "transformElement", id: "e1", box, size: Number.NaN },
    ]) {
      expect(parseFrameMessage(message)).toBeNull();
    }
  });

  it("does not read a scene that already carries the box back as a message", () => {
    expect(
      parseFrameMessage({ kind: "scene", elements: [{ id: "e1", transform: { box } }] })
    ).toBeNull();
  });
});

describe("sceneMessage() with transform handles (#795)", () => {
  const page = { preset: "square" as const, widthMm: 200, heightMm: 100 };
  const stamp: MapStampElement = {
    id: "stamp",
    kind: "stamp",
    name: "Marker",
    hidden: false,
    locked: false,
    stampRef: "base:marker",
    transform: { x: 100, y: 50, size: 12, rotation: 0 },
  };
  const image: MapImageElement = {
    id: "image",
    kind: "image",
    name: "Scan",
    hidden: false,
    locked: false,
    assetRef: "a1",
    transform: { x: 60, y: 40, size: 80, rotation: 15 },
    opacity: 1,
    exportable: true,
  };
  const view = {
    selectedId: "stamp",
    tool: "select" as const,
    zoom: 1,
    panX: 0,
    panY: 0,
    penLabel: { one: "Pen line, {{count}} point", other: "Pen line, {{count}} points" },
    readout: {
      size: "{{value}} mm",
      angle: "{{value}}°",
      shape: "{{width}} × {{height}} mm",
      label: "Cap {{size}} mm · {{width}} mm",
    },
  };

  it("carries the selected Stamp's handle box, its handle set, and whether it is locked", () => {
    const message = sceneMessage({ page, elements: [stamp, image] }, view);
    expect(message.elements[0]).toMatchObject({
      id: "stamp",
      selected: true,
      locked: false,
      transform: {
        box: { x: 100, y: 50, width: 12, height: 12, rotation: 0 },
        handles: "corners",
      },
    });
    // Only the selected Element carries the box: the others keep the outline.
    expect(message.elements[1].transform).toBeUndefined();
  });

  it("still carries a locked Element's box, so the Frame can say why it cannot be dragged", () => {
    const message = sceneMessage({ page, elements: [{ ...stamp, locked: true }] }, view);
    expect(message.elements[0]).toMatchObject({ locked: true, transform: { handles: "corners" } });
  });

  it("carries the readout's localized text for the Frame's chip", () => {
    const message = sceneMessage({ page, elements: [] }, view);
    expect(message.readout).toEqual({
      size: "{{value}} mm",
      angle: "{{value}}°",
      shape: "{{width}} × {{height}} mm",
      label: "Cap {{size}} mm · {{width}} mm",
    });
  });
});

describe("the editLabel message (#800)", () => {
  it("reads the id of the Map Label a double click asks to edit", () => {
    expect(parseFrameMessage({ kind: "editLabel", id: "l1" })).toEqual({
      kind: "editLabel",
      id: "l1",
    });
  });

  it("drops an editLabel message with no id, or an id that is not text", () => {
    for (const message of [
      { kind: "editLabel" },
      { kind: "editLabel", id: null },
      { kind: "editLabel", id: 7 },
    ]) {
      expect(parseFrameMessage(message)).toBeNull();
    }
  });
});
