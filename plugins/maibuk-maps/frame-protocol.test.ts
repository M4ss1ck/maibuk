/**
 * The Maps Frame wire protocol's rasterize pair (#753): the request the Worker
 * sends so the Frame's document, which alone has a canvas and may load an
 * image, turns the export SVG into pixels, and the reply it answers with. The
 * Frame mirrors the request shape in `assets/ui/map.js`; the Worker validates
 * every reply here before it reaches the editor.
 */

import { describe, expect, it } from "vitest";
import { parseFrameMessage, rasterizeMessage } from "./frame-protocol";

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
