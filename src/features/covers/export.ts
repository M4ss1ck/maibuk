import { Canvas } from "fabric";
import { applyBackground, buildObject } from "@/components/cover-editor/render/toFabric";
import { collectFonts, ensureFontsLoaded } from "@/features/covers/scene/fonts";
import type { CoverScene } from "@/features/covers/scene/schema";

export type ExportFormat = "png" | "jpeg";

/** Multiplier to scale a design-DPI render up/down to a target DPI. */
export function exportMultiplier(designDpi: number, targetDpi: number): number {
  return designDpi > 0 && targetDpi > 0 ? targetDpi / designDpi : 1;
}

/** Convert a pixel measurement at `dpi` into PDF points (1pt = 1/72 inch). */
export function pxToPoints(px: number, dpi: number): number {
  return dpi > 0 ? (px / dpi) * 72 : px;
}

/** Decode a base64 data URL into raw bytes. */
export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",")[1] ?? "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Render a scene onto a fresh offscreen Fabric canvas at full document size. */
async function renderSceneToCanvas(scene: CoverScene): Promise<Canvas> {
  // Ensure fonts are ready so headless export matches the editor.
  await ensureFontsLoaded(collectFonts(scene));
  const el = document.createElement("canvas");
  const canvas = new Canvas(el, { width: scene.doc.width, height: scene.doc.height });
  await applyBackground(canvas, scene.background);
  for (const layer of scene.layers) {
    if (layer.hidden) continue;
    const obj = await buildObject(layer);
    if (obj) canvas.add(obj);
  }
  canvas.requestRenderAll();
  return canvas;
}

/** Render and export a scene to a PNG/JPEG data URL at the target DPI. */
export async function exportScene(
  scene: CoverScene,
  opts: { format: ExportFormat; quality?: number; targetDpi?: number }
): Promise<string> {
  const canvas = await renderSceneToCanvas(scene);
  try {
    return canvas.toDataURL({
      format: opts.format,
      quality: opts.quality ?? 0.92,
      multiplier: exportMultiplier(scene.doc.dpi, opts.targetDpi ?? scene.doc.dpi),
    });
  } finally {
    canvas.dispose();
  }
}

/**
 * Export a scene as a single-page, print-ready PDF: a full-bleed page sized to
 * the trim (in points) with the high-DPI render embedded edge to edge.
 */
export async function exportScenePdf(scene: CoverScene): Promise<Uint8Array> {
  const { PDFDocument } = await import("pdf-lib");
  const pngDataUrl = await exportScene(scene, { format: "png", targetDpi: scene.doc.dpi });
  const pngBytes = dataUrlToBytes(pngDataUrl);

  const pdf = await PDFDocument.create();
  const widthPt = pxToPoints(scene.doc.width, scene.doc.dpi);
  const heightPt = pxToPoints(scene.doc.height, scene.doc.dpi);
  const page = pdf.addPage([widthPt, heightPt]);
  const png = await pdf.embedPng(pngBytes);
  page.drawImage(png, { x: 0, y: 0, width: widthPt, height: heightPt });

  return pdf.save();
}
