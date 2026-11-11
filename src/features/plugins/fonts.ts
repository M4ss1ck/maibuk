/**
 * The PDF Fonts a Plugin can use (#751, slice 3): the fonts the author installed
 * for the PDF export, listed and read as bytes so a Plugin can draw in the face
 * an export embeds. The PDF Fonts feature owns the catalog, the install marker,
 * and the read, so a Plugin sees the same ids and families the Settings row
 * shows and a font that changed on disk reads as not installed here too.
 *
 * Neither row needs a Plugin Permission: a PDF Font is a public file on this
 * device, and whether to trust a Plugin with it stays the user's call.
 */

import { PDF_FONT_CATALOG, pdfFontFor } from "@/features/pdf-fonts/catalog";
import { isPdfFontInstalled, readInstalledPdfFont } from "@/features/pdf-fonts/install";
import { getPdfFontFiles } from "@/lib/platform";
import { PluginApiError } from "@/plugin-sdk/protocol";

/** One installed PDF Font as `fonts.list` reports it. */
export interface PluginPdfFont {
  id: string;
  family: string;
}

/** The PDF Fonts installed on this device, in catalog order. */
export async function listPluginPdfFonts(): Promise<PluginPdfFont[]> {
  const files = await getPdfFontFiles();
  const fonts: PluginPdfFont[] = [];
  for (const font of PDF_FONT_CATALOG) {
    if (await isPdfFontInstalled(font, files)) fonts.push({ id: font.id, family: font.family });
  }
  return fonts;
}

/** The bytes of one installed PDF Font's regular style file. */
export async function readPluginPdfFont(id: string): Promise<Uint8Array> {
  const font = pdfFontFor(id);
  if (font === undefined) throw pdfFontNotInstalled(id);
  const data = await readInstalledPdfFont(font, await getPdfFontFiles());
  // A font whose files no longer match its pins counts as not installed.
  if (data === null) throw pdfFontNotInstalled(id);
  return data.regular;
}

/** An id no installed PDF Font answers; the same code an unknown id already gets. */
function pdfFontNotInstalled(id: string): PluginApiError {
  return new PluginApiError({ code: "invalid-params", message: `PDF Font ${id} is not installed` });
}
