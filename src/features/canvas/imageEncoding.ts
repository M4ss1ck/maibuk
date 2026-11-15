/** Longest edge, in pixels, that a rasterized Canvas Image may keep. */
export const CANVAS_IMAGE_MAX_EDGE = 2048;

/** Byte size at or below which a GIF or SVG is embedded unchanged. */
export const CANVAS_IMAGE_PASSTHROUGH_MAX_BYTES = 2 * 1024 * 1024;

/** Side of the box a newly placed Canvas Image is fitted into, in Canvas units. */
export const CANVAS_IMAGE_FIT = 320;

/** Shortest edge a Canvas Image may be resized to, in Canvas units. */
export const CANVAS_IMAGE_MIN_EDGE = 48;

/** JPEG quality used when rasterizing an opaque Canvas Image. */
export const CANVAS_IMAGE_JPEG_QUALITY = 0.85;

/** What the editor knows about an image before deciding how to store it. */
export type ImageEncodingInput = {
  mimeType: string;
  byteLength: number;
  width: number;
  height: number;
  hasAlpha: boolean;
};

/** How a Canvas Image should be stored: embedded unchanged or rasterized. */
export type ImageEncodingPlan =
  | { kind: "passthrough" }
  | {
      kind: "raster";
      mimeType: "image/jpeg" | "image/png";
      quality?: number;
      width: number;
      height: number;
    };

/** Decides whether an image is embedded unchanged or rasterized, and at what size. */
export function planImageEncoding(input: ImageEncodingInput): ImageEncodingPlan {
  const isPassthroughCandidate =
    input.mimeType === "image/gif" || input.mimeType === "image/svg+xml";

  if (isPassthroughCandidate && input.byteLength <= CANVAS_IMAGE_PASSTHROUGH_MAX_BYTES) {
    return { kind: "passthrough" };
  }

  const size = capImageSize(input.width, input.height);

  if (input.hasAlpha) {
    return { kind: "raster", mimeType: "image/png", ...size };
  }

  return {
    kind: "raster",
    mimeType: "image/jpeg",
    quality: CANVAS_IMAGE_JPEG_QUALITY,
    ...size,
  };
}

/** Fits an image into the placement box, never upscaling it. */
export function fitCanvasImageSize(
  width: number,
  height: number
): { width: number; height: number } {
  const longEdge = Math.max(width, height);
  if (longEdge <= CANVAS_IMAGE_FIT) {
    return { width, height };
  }
  const factor = CANVAS_IMAGE_FIT / longEdge;
  return {
    width: Math.max(1, Math.round(width * factor)),
    height: Math.max(1, Math.round(height * factor)),
  };
}

/** Scales an image by a factor, holding its short edge at the minimum when it would fall below. */
export function scaleCanvasImageSize(
  size: { width: number; height: number },
  factor: number
): { width: number; height: number } {
  const shortEdge = Math.min(size.width, size.height);
  const scaledShortEdge = shortEdge * factor;

  if (scaledShortEdge < CANVAS_IMAGE_MIN_EDGE) {
    const clampFactor = CANVAS_IMAGE_MIN_EDGE / shortEdge;
    return {
      width: Math.max(1, Math.round(size.width * clampFactor)),
      height: Math.max(1, Math.round(size.height * clampFactor)),
    };
  }

  return {
    width: Math.max(1, Math.round(size.width * factor)),
    height: Math.max(1, Math.round(size.height * factor)),
  };
}

function capImageSize(width: number, height: number): { width: number; height: number } {
  const longEdge = Math.max(width, height);
  if (longEdge <= CANVAS_IMAGE_MAX_EDGE) {
    return { width, height };
  }
  const factor = CANVAS_IMAGE_MAX_EDGE / longEdge;
  return {
    width: Math.max(1, Math.round(width * factor)),
    height: Math.max(1, Math.round(height * factor)),
  };
}
