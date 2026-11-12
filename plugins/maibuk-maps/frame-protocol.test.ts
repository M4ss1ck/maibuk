/**
 * The Maps Frame wire protocol's rasterize pair (#753): the request the Worker
 * sends so the Frame's document, which alone has a canvas and may load an
 * image, turns the export SVG into pixels, and the reply it answers with. The
 * Frame mirrors the request shape in `assets/ui/map.js`; the Worker validates
 * every reply here before it reaches the editor.
 *
 * The asset ingest pair (#756) is validated here too: the Frame cleans and
 * measures an uploaded picture, and the Worker keeps only what came back.
 */

import { describe, expect, it } from "vitest";
import type { MapAsset } from "./assets";
import { assetMessage, parseFrameMessage, rasterizeMessage, sceneMessage } from "./frame-protocol";
import type { MapDocument, MapImageElement } from "./maps";
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
