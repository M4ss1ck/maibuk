import { describe, expect, it } from "vitest";
import {
  CANVAS_IMAGE_FIT,
  CANVAS_IMAGE_JPEG_QUALITY,
  CANVAS_IMAGE_MAX_EDGE,
  CANVAS_IMAGE_MIN_EDGE,
  CANVAS_IMAGE_PASSTHROUGH_MAX_BYTES,
  fitCanvasImageSize,
  planImageEncoding,
  scaleCanvasImageSize,
} from "@/features/canvas/imageEncoding";

const KB = 1024;
const MB = 1024 * KB;

describe("planImageEncoding", () => {
  it("caps a landscape image on its long edge", () => {
    expect(
      planImageEncoding({
        mimeType: "image/jpeg",
        byteLength: 4 * MB,
        width: 4000,
        height: 2000,
        hasAlpha: false,
      })
    ).toEqual({
      kind: "raster",
      mimeType: "image/jpeg",
      quality: CANVAS_IMAGE_JPEG_QUALITY,
      width: CANVAS_IMAGE_MAX_EDGE,
      height: 1024,
    });
  });

  it("caps a portrait image on its long edge", () => {
    expect(
      planImageEncoding({
        mimeType: "image/jpeg",
        byteLength: 3 * MB,
        width: 2000,
        height: 4000,
        hasAlpha: false,
      })
    ).toEqual({
      kind: "raster",
      mimeType: "image/jpeg",
      quality: CANVAS_IMAGE_JPEG_QUALITY,
      width: 1024,
      height: CANVAS_IMAGE_MAX_EDGE,
    });
  });

  it("never upscales a small opaque image", () => {
    expect(
      planImageEncoding({
        mimeType: "image/jpeg",
        byteLength: 100 * KB,
        width: 800,
        height: 600,
        hasAlpha: false,
      })
    ).toEqual({
      kind: "raster",
      mimeType: "image/jpeg",
      quality: CANVAS_IMAGE_JPEG_QUALITY,
      width: 800,
      height: 600,
    });
  });

  it("keeps transparency by encoding PNG without quality", () => {
    const plan = planImageEncoding({
      mimeType: "image/png",
      byteLength: 6 * MB,
      width: 4000,
      height: 4000,
      hasAlpha: true,
    });
    expect(plan).toEqual({
      kind: "raster",
      mimeType: "image/png",
      width: CANVAS_IMAGE_MAX_EDGE,
      height: CANVAS_IMAGE_MAX_EDGE,
    });
    expect(plan).not.toHaveProperty("quality");
  });

  it("encodes opaque images as JPEG at the configured quality", () => {
    expect(
      planImageEncoding({
        mimeType: "image/png",
        byteLength: 2 * MB,
        width: 1000,
        height: 500,
        hasAlpha: false,
      })
    ).toEqual({
      kind: "raster",
      mimeType: "image/jpeg",
      quality: CANVAS_IMAGE_JPEG_QUALITY,
      width: 1000,
      height: 500,
    });
  });

  it("keeps small GIFs animated with passthrough", () => {
    expect(
      planImageEncoding({
        mimeType: "image/gif",
        byteLength: CANVAS_IMAGE_PASSTHROUGH_MAX_BYTES,
        width: 500,
        height: 500,
        hasAlpha: true,
      })
    ).toEqual({ kind: "passthrough" });
  });

  it("keeps small SVGs scalable with passthrough", () => {
    expect(
      planImageEncoding({
        mimeType: "image/svg+xml",
        byteLength: 40 * KB,
        width: 100,
        height: 100,
        hasAlpha: true,
      })
    ).toEqual({ kind: "passthrough" });
  });

  it("rasterizes a GIF just above the passthrough cap", () => {
    expect(
      planImageEncoding({
        mimeType: "image/gif",
        byteLength: CANVAS_IMAGE_PASSTHROUGH_MAX_BYTES + 1,
        width: 500,
        height: 500,
        hasAlpha: true,
      })
    ).toEqual({
      kind: "raster",
      mimeType: "image/png",
      width: 500,
      height: 500,
    });
  });

  it("rasterizes an oversized SVG", () => {
    expect(
      planImageEncoding({
        mimeType: "image/svg+xml",
        byteLength: 3 * MB,
        width: 4096,
        height: CANVAS_IMAGE_MAX_EDGE,
        hasAlpha: true,
      })
    ).toEqual({
      kind: "raster",
      mimeType: "image/png",
      width: CANVAS_IMAGE_MAX_EDGE,
      height: 1024,
    });
  });

  it("always produces integer edges of at least one pixel", () => {
    const plan = planImageEncoding({
      mimeType: "image/jpeg",
      byteLength: KB,
      width: 5000,
      height: 1,
      hasAlpha: false,
    });
    expect(plan).toMatchObject({ kind: "raster", width: CANVAS_IMAGE_MAX_EDGE, height: 1 });
  });
});

describe("fitCanvasImageSize", () => {
  it("scales a large image down to the fit box", () => {
    expect(fitCanvasImageSize(640, 320)).toEqual({
      width: CANVAS_IMAGE_FIT,
      height: CANVAS_IMAGE_FIT / 2,
    });
  });

  it("rounds to integers", () => {
    expect(fitCanvasImageSize(1000, 333)).toEqual({ width: 320, height: 107 });
  });

  it("leaves an image smaller than the box unchanged", () => {
    expect(fitCanvasImageSize(120, 90)).toEqual({ width: 120, height: 90 });
  });

  it("fits the height of a tall image", () => {
    expect(fitCanvasImageSize(100, 1000)).toEqual({ width: 32, height: 320 });
  });
});

describe("scaleCanvasImageSize", () => {
  it("grows both edges by the factor", () => {
    expect(scaleCanvasImageSize({ width: 100, height: 48 }, 1.1)).toEqual({
      width: 110,
      height: 53,
    });
  });

  it("shrinks both edges by the factor", () => {
    expect(scaleCanvasImageSize({ width: 200, height: 100 }, 1 / 1.1)).toEqual({
      width: 182,
      height: 91,
    });
  });

  it("clamps the short edge to the minimum before rounding", () => {
    expect(scaleCanvasImageSize({ width: 100, height: 50 }, 1 / 1.1)).toEqual({
      width: 96,
      height: CANVAS_IMAGE_MIN_EDGE,
    });
  });

  it("clamps a portrait image on its short edge", () => {
    expect(scaleCanvasImageSize({ width: 50, height: 100 }, 1 / 1.1)).toEqual({
      width: CANVAS_IMAGE_MIN_EDGE,
      height: 96,
    });
  });

  it("keeps the long edge when the clamp applies", () => {
    expect(scaleCanvasImageSize({ width: 300, height: 49 }, 1 / 1.1)).toEqual({
      width: 294,
      height: CANVAS_IMAGE_MIN_EDGE,
    });
  });
});
