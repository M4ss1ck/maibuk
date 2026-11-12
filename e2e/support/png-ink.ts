// Reading an exported picture back (#756). A Maps export spec ends with a PNG
// the browser saved, so what the file shows has to be read from its pixels.
// Playwright has no image API, and a hand-written PNG decoder would be a second,
// unproven copy of a format the browser already decodes exactly as a reader
// does, so the browser does the decoding: the file's bytes become an image
// bitmap, a canvas draws it, and the canvas reports the pixels the spec asserts
// on.
//
// It sits here rather than in the spec because `e2e/guards/coverage.ts` refuses
// `evaluate` in a spec (the keyboard contract keeps specs to the app's own UI),
// the way `frame-stroke.ts` reads the Frame's painted pixels from a helper.

import type { Page } from "@playwright/test";

/** A square of a picture, placed and sized in fractions of the picture itself. */
export interface InkBox {
  /** Its centre across the picture: 0 at the left edge, 1 at the right. */
  x: number;
  /** Its centre down the picture: 0 at the top edge, 1 at the bottom. */
  y: number;
  /** Its side, as a fraction of the picture's width. */
  width: number;
}

/** Red, green and blue summed at or under this is ink; the pale papers sum far higher. */
export const PAPER_MAX_SUM = 300;

/**
 * How many pixels of each box of the PNG `pngBase64` are darker than
 * {@link PAPER_MAX_SUM}, in the page's own browser: the boxes answer in order,
 * and a picture that never drew its content answers zeros. A box is clipped to
 * the picture, so a box at an edge still reads a square.
 */
export async function countInkPixels(
  page: Page,
  pngBase64: string,
  boxes: readonly InkBox[],
  paperMaxSum = PAPER_MAX_SUM
): Promise<number[]> {
  return page.evaluate(
    async ({ data, regions, limit }) => {
      const binary = atob(data);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      if (context === null) throw new Error("this page cannot draw a canvas");
      context.drawImage(bitmap, 0, 0);
      return regions.map((region) => {
        const side = Math.max(1, Math.round(region.width * bitmap.width));
        const left = Math.min(
          Math.max(0, Math.round(region.x * bitmap.width - side / 2)),
          bitmap.width - side
        );
        const top = Math.min(
          Math.max(0, Math.round(region.y * bitmap.height - side / 2)),
          bitmap.height - side
        );
        const { data: pixels } = context.getImageData(left, top, side, side);
        let ink = 0;
        for (let at = 0; at < pixels.length; at += 4) {
          if (pixels[at] + pixels[at + 1] + pixels[at + 2] <= limit) ink += 1;
        }
        return ink;
      });
    },
    { data: pngBase64, regions: boxes, limit: paperMaxSum }
  );
}
