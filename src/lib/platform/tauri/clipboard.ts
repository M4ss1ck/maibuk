import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { ClipboardAdapter } from "@/lib/platform/types";

/** The OS clipboard, through the clipboard-manager plugin. */
export const tauriClipboard: ClipboardAdapter = {
  async readText(): Promise<string> {
    return readText();
  },
  async writeText(text: string): Promise<void> {
    await writeText(text);
  },
};
