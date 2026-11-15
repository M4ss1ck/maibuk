import { planImageEncoding } from "@/features/canvas/imageEncoding";

/** An image ready to store in a Canvas Image, with its natural pixel size. */
export type EncodedCanvasImage = { src: string; width: number; height: number };

/** Why an image could not become a Canvas Image. */
export class CanvasImageError extends Error {
  constructor(readonly reason: "fetch" | "unsupported") {
    super(reason);
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function decodeImage(blob: Blob): Promise<HTMLImageElement> {
  // An <img>, not createImageBitmap: Chromium's createImageBitmap rejects SVG.
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function hasTransparentPixel(context: CanvasRenderingContext2D, width: number, height: number) {
  const pixels = context.getImageData(0, 0, width, height).data;
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] < 255) return true;
  }
  return false;
}

/**
 * Fetches an image once (a data: URL from the file picker, or a web URL) and
 * returns it as a data URL per the Canvas Image Encoding: GIF and SVG up to the
 * passthrough cap stay as they are, everything else is redrawn at no more than
 * the size cap as JPEG, or PNG when it has transparency. Never hotlinks.
 */
export async function encodeCanvasImage(source: string): Promise<EncodedCanvasImage> {
  let blob: Blob;
  try {
    const response = await fetch(source);
    if (!response.ok) throw new Error(String(response.status));
    blob = await response.blob();
  } catch {
    throw new CanvasImageError("fetch");
  }
  if (!blob.type.startsWith("image/")) throw new CanvasImageError("fetch");

  let image: HTMLImageElement;
  try {
    image = await decodeImage(blob);
  } catch {
    throw new CanvasImageError("unsupported");
  }
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (!width || !height) throw new CanvasImageError("unsupported");

  const input = { mimeType: blob.type, byteLength: blob.size, width, height, hasAlpha: false };
  const plan = planImageEncoding(input);
  if (plan.kind === "passthrough") return { src: await blobToDataUrl(blob), width, height };

  const canvas = document.createElement("canvas");
  canvas.width = plan.width;
  canvas.height = plan.height;
  const context = canvas.getContext("2d");
  if (!context) throw new CanvasImageError("unsupported");
  context.drawImage(image, 0, 0, plan.width, plan.height);
  // Transparency is only known once drawn, so the format is planned again with it.
  const hasAlpha =
    blob.type !== "image/jpeg" && hasTransparentPixel(context, plan.width, plan.height);
  const output = planImageEncoding({ ...input, hasAlpha });
  if (output.kind === "passthrough") throw new CanvasImageError("unsupported");
  return { src: canvas.toDataURL(output.mimeType, output.quality), width, height };
}
