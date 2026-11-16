import { encodeCanvasImage, type EncodedCanvasImage } from "@/features/canvas/encodeCanvasImage";
import { fitCanvasImageSize } from "@/features/canvas/imageEncoding";
import type { CanvasNode, CanvasPosition } from "@/features/canvas/types";

/** Canvas units each dropped image is offset by, so a stack of drops stays visible. */
export const CANVAS_DROP_CASCADE = 24;

const IMAGE_MIME_BY_EXTENSION = new Map([
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
  ["svg", "image/svg+xml"],
  ["bmp", "image/bmp"],
  ["avif", "image/avif"],
]);

/**
 * Turns dropped files into Canvas Image nodes, cascading each placed image from
 * `at` and counting the files the encoder refuses as skipped. Encoding runs one
 * file at a time, and a skipped file does not advance the cascade.
 */
export async function droppedImageNodes(
  files: File[],
  at: CanvasPosition,
  encode: (source: string | Blob) => Promise<EncodedCanvasImage> = encodeCanvasImage
): Promise<{ nodes: CanvasNode[]; skipped: number }> {
  const nodes: CanvasNode[] = [];
  let skipped = 0;

  for (const file of files) {
    let encoded: EncodedCanvasImage;
    try {
      encoded = await encode(file);
    } catch {
      skipped += 1;
      continue;
    }
    nodes.push({
      id: crypto.randomUUID(),
      kind: "image",
      src: encoded.src,
      ...fitCanvasImageSize(encoded.width, encoded.height),
      fileName: file.name || undefined,
      position: {
        x: at.x + nodes.length * CANVAS_DROP_CASCADE,
        y: at.y + nodes.length * CANVAS_DROP_CASCADE,
      },
    });
  }

  return { nodes, skipped };
}

/** Names an image MIME type from a file path's extension, so a Tauri drop path can become a File. */
export function imageMimeFromPath(path: string): string {
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return IMAGE_MIME_BY_EXTENSION.get(extension) ?? "application/octet-stream";
}
