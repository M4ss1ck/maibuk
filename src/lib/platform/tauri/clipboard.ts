import { invoke } from "@tauri-apps/api/core";
import { readImage, readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { ClipboardAdapter } from "@/lib/platform/types";

/** The MIME type, one `\n`, then the file bytes; empty for "no copied file". */
function copiedFileBlob(response: ArrayBuffer): Blob | null {
  const bytes = new Uint8Array(response);
  const newline = bytes.indexOf(10);
  if (newline < 0) return null;
  const type = new TextDecoder().decode(bytes.subarray(0, newline));
  return new Blob([bytes.subarray(newline + 1)], { type });
}

/** A picture copied as pixels rather than as a file, redrawn as PNG. */
async function copiedPictureBlob(): Promise<Blob | null> {
  // No picture on the clipboard rejects; that is the same "nothing here".
  const image = await readImage().catch(() => null);
  if (!image) return null;
  const { width, height } = await image.size();
  const rgba = await image.rgba();
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

/** The OS clipboard, through the clipboard-manager plugin. */
export const tauriClipboard: ClipboardAdapter = {
  async readText(): Promise<string> {
    return readText();
  },
  async writeText(text: string): Promise<void> {
    await writeText(text);
  },
  async readImage(): Promise<Blob | null> {
    // A rejection here means the copied file is too large, so it propagates.
    const file = copiedFileBlob(await invoke<ArrayBuffer>("read_clipboard_image_file"));
    return file ?? copiedPictureBlob();
  },
};
