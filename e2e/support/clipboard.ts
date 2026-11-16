// Clipboard setup/read helpers. Chromium-only rows: the browser grants the
// clipboard permissions the spec asks for, and these helpers are the only
// place in the suite allowed to touch navigator.clipboard.

import type { Page } from "@playwright/test";

export async function writeClipboard(
  page: Page,
  data: { text?: string; html?: string; image?: { width: number; height: number } }
): Promise<void> {
  await page.evaluate(async ({ text, html, image }) => {
    const items: Record<string, Blob> = {};
    if (text !== undefined) items["text/plain"] = new Blob([text], { type: "text/plain" });
    if (html !== undefined) items["text/html"] = new Blob([html], { type: "text/html" });
    if (image !== undefined) {
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      if (context === null) throw new Error("this page cannot draw a canvas");
      context.fillStyle = "#3366cc";
      context.fillRect(0, 0, image.width, image.height);
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, "image/png");
      });
      if (blob === null) throw new Error("this page cannot encode a PNG");
      items["image/png"] = blob;
    }
    await navigator.clipboard.write([new ClipboardItem(items)]);
  }, data);
}

export async function readClipboard(page: Page): Promise<{ text: string; html: string | null }> {
  return page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    let text = "";
    let html: string | null = null;
    for (const item of items) {
      if (item.types.includes("text/plain")) {
        text = await (await item.getType("text/plain")).text();
      }
      if (item.types.includes("text/html")) {
        html = await (await item.getType("text/html")).text();
      }
    }
    return { text, html };
  });
}
