import type { CoverScene } from "@/features/covers/scene/schema";

/** Unique font families referenced by the scene's text layers. */
export function collectFonts(scene: CoverScene): string[] {
  const seen = new Set<string>();
  for (const layer of scene.layers) {
    if (layer.type === "text") seen.add(layer.font.family);
  }
  return [...seen];
}

/**
 * Ensure the given font families are loaded before rendering/exporting, so
 * headless renders match the on-screen editor. No-op where the FontFace API is
 * unavailable (e.g. jsdom). Weights/styles default to a representative set.
 */
export async function ensureFontsLoaded(families: string[]): Promise<void> {
  const fonts = (globalThis as { document?: { fonts?: FontFaceSet } }).document?.fonts;
  if (!fonts) return;
  const specs = ["16px", "bold 16px", "italic 16px"];
  await Promise.all(
    families.flatMap((family) =>
      specs.map((spec) => fonts.load(`${spec} "${family}"`).catch(() => undefined))
    )
  );
  await fonts.ready;
}
