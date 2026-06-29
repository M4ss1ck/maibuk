import { IS_TAURI } from "@/lib/platform";

export interface ClipboardSnapshot {
  text: string;
  html: string | null;
  hasImage: boolean;
}

export function hasRichFormatting(html: string): boolean {
  return /<(h[1-6]|ul|ol|li|strong|b|em|i|blockquote|a|img|table|pre)\b/i.test(html);
}

function isTauriRuntime(): boolean {
  return IS_TAURI && typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function readTextViaNavigator(): Promise<string> {
  if (typeof navigator === "undefined" || !navigator.clipboard?.readText) {
    return "";
  }
  try {
    return await navigator.clipboard.readText();
  } catch {
    return "";
  }
}

async function readViaNavigator(): Promise<ClipboardSnapshot | null> {
  if (typeof navigator === "undefined" || !navigator.clipboard) {
    return null;
  }

  if (!navigator.clipboard.read) {
    const text = await readTextViaNavigator();
    return text ? { text, html: null, hasImage: false } : null;
  }

  try {
    const items = await navigator.clipboard.read();
    let text = "";
    let html: string | null = null;
    let hasImage = false;

    for (const item of items) {
      if (item.types.some((type) => type.startsWith("image/"))) {
        hasImage = true;
      }
      if (html === null && item.types.includes("text/html")) {
        html = await (await item.getType("text/html")).text();
      }
      if (!text && item.types.includes("text/plain")) {
        text = await (await item.getType("text/plain")).text();
      }
    }

    if (!text && !html && !hasImage) return null;
    return { text, html, hasImage };
  } catch {
    const text = await readTextViaNavigator();
    return text ? { text, html: null, hasImage: false } : null;
  }
}

async function readViaTauri(): Promise<ClipboardSnapshot> {
  let text = "";
  let hasImage = false;

  try {
    const { readText, readImage } = await import("@tauri-apps/plugin-clipboard-manager");
    try {
      text = await readText();
    } catch {
      // no text payload
    }
    try {
      await readImage();
      hasImage = true;
    } catch {
      // no image payload
    }
  } catch {
    // plugin unavailable
  }

  return { text, html: null, hasImage };
}

export async function readClipboardSnapshot(): Promise<ClipboardSnapshot> {
  const viaNavigator = await readViaNavigator();
  if (viaNavigator) return viaNavigator;
  if (isTauriRuntime()) return readViaTauri();
  return { text: "", html: null, hasImage: false };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function readClipboardImageDataUrl(): Promise<string | null> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.read) {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((type) => type.startsWith("image/"));
        if (imageType) {
          return await blobToDataUrl(await item.getType(imageType));
        }
      }
    } catch {
      // fall through to Tauri
    }
  }

  if (isTauriRuntime()) {
    try {
      const { readImage } = await import("@tauri-apps/plugin-clipboard-manager");
      const image = await readImage();
      const { width, height } = await image.size();
      const rgba = await image.rgba();
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) return null;
      context.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
      return canvas.toDataURL("image/png");
    } catch {
      return null;
    }
  }

  return null;
}

export function snapshotToPlainText(snap: ClipboardSnapshot): string {
  if (snap.text) return snap.text;
  if (!snap.html) return "";
  const doc = new DOMParser().parseFromString(snap.html, "text/html");
  return doc.body.textContent ?? "";
}

export function plainTextToHtml(text: string): string {
  const escapeHtml = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  return text
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}
