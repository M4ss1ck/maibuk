import { invoke } from "@tauri-apps/api/core";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { ClipboardAdapter } from "@/lib/platform/types";

/** The MIME type, one `\n`, then the file bytes; empty for "no copied file". */
function copiedFileBlob(response: ArrayBuffer): Blob | null {
  const bytes = new Uint8Array(response);
  const newline = bytes.indexOf(10);
  if (newline < 0) return null;
  const type = new TextDecoder().decode(bytes.subarray(0, newline));
  return new Blob([bytes.subarray(newline + 1)], { type });
}

/** The OS clipboard, through the clipboard-manager plugin. */
export const tauriClipboard: ClipboardAdapter = {
  async readText(): Promise<string> {
    return readText();
  },
  async writeText(text: string): Promise<void> {
    await writeText(text);
  },
  async readCopiedImageFile(): Promise<Blob | null> {
    // A rejection here means the copied file is too large, so it propagates.
    return copiedFileBlob(await invoke<ArrayBuffer>("read_clipboard_image_file"));
  },
};
