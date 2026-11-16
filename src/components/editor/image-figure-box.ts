// The box an Image figure draws: shared by the editor's ImageView and the
// static render of a resting Canvas Text Node, so a picture keeps its size and
// side when the node stops editing.

export type ImageAlignment = "left" | "center" | "right";

export const DEFAULT_IMAGE_ALIGNMENT: ImageAlignment = "left";

const ALIGNMENTS = new Set<string>(["left", "center", "right"]);
const PERCENT_WIDTH = /^\s*(\d+(?:\.\d+)?)%\s*$/;

export function imageAlignment(value: unknown): ImageAlignment {
  return typeof value === "string" && ALIGNMENTS.has(value)
    ? (value as ImageAlignment)
    : DEFAULT_IMAGE_ALIGNMENT;
}

/**
 * The stored width as a percent of the page, or null when the picture was
 * never resized (or holds a width the editor could not have written) and
 * draws at its own size.
 */
export function imageWidthPercent(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = value.match(PERCENT_WIDTH);
  if (!match) return null;
  const width = Number(match[1]);
  return Number.isFinite(width) ? width : null;
}

/**
 * The figure's class and inline width. A picture with no width of its own
 * gets `natural-width`, which index.css draws at the picture's own width,
 * capped at the page.
 */
export function imageFigureBox(attrs: { width?: unknown; alignment?: unknown }): {
  className: string;
  width: string | undefined;
} {
  const percent = imageWidthPercent(attrs.width);
  const alignment = imageAlignment(attrs.alignment);
  return percent === null
    ? { className: `editor-image-figure align-${alignment} natural-width`, width: undefined }
    : { className: `editor-image-figure align-${alignment}`, width: `${percent}%` };
}
