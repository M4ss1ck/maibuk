import type { ClipboardAdapter } from "@/lib/platform/types";

/**
 * The browser clipboard. `navigator.clipboard` is only reachable in a secure
 * context and may refuse a read without focus or a user gesture; a refused
 * call rejects and the caller surfaces it as one typed refusal.
 */
export const webClipboard: ClipboardAdapter = {
  async readText(): Promise<string> {
    return navigator.clipboard.readText();
  },
  async writeText(text: string): Promise<void> {
    await navigator.clipboard.writeText(text);
  },
  // Browsers put a copied file in the paste event itself, so there is none to read.
  async readCopiedImageFile(): Promise<Blob | null> {
    return null;
  },
};
