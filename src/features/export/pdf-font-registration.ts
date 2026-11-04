/**
 * Registers the embedded fonts a PDF needs with @react-pdf/renderer.
 *
 * Imported statically only by the two PDF generators, so react-pdf and the
 * font bytes never join the shell bundle. A font is registered once per
 * session: re-registering appends to the family and the first source wins.
 */
import { Font } from "@react-pdf/renderer";
import { PDF_FONT_CATALOG, pdfFontPlan } from "@/features/pdf-fonts/catalog";
import { isPdfFontInstalled, readInstalledPdfFont } from "@/features/pdf-fonts/install";
import type { InstalledPdfFont, PdfFont, PdfFontId } from "@/features/pdf-fonts/types";
import { uint8ArrayToBase64 } from "@/features/sync/crypto";
import { getPdfFontFiles } from "@/lib/platform";

const registered = new Set<string>();

function dataSource(font: PdfFont, bytes: Uint8Array): string {
  const type = font.files.regular.url.endsWith(".otf") ? "otf" : "ttf";
  return `data:font/${type};base64,${uint8ArrayToBase64(bytes)}`;
}

function register(font: PdfFont, data: InstalledPdfFont): void {
  if (registered.has(font.family)) return;

  const regular = dataSource(font, data.regular);
  const bold = dataSource(font, data.bold);
  // A missing style throws in react-pdf, so it borrows the nearest one.
  Font.register({
    family: font.family,
    fonts: [
      { src: regular },
      { src: bold, fontWeight: "bold" },
      { src: data.italic ? dataSource(font, data.italic) : regular, fontStyle: "italic" },
      {
        src: data.boldItalic ? dataSource(font, data.boldItalic) : bold,
        fontWeight: "bold",
        fontStyle: "italic",
      },
    ],
  });
  registered.add(font.family);
}

/**
 * The families the stylesheet must use for `text`, in catalog order, or
 * undefined when the built-in fonts can render it.
 */
export async function embeddedPdfFontFamilies(text: string): Promise<string[] | undefined> {
  const files = await getPdfFontFiles();

  const installed: PdfFontId[] = [];
  for (const font of PDF_FONT_CATALOG) {
    try {
      if (await isPdfFontInstalled(font, files)) installed.push(font.id);
    } catch {
      // Storage that cannot answer reads as nothing installed.
    }
  }

  const plan = pdfFontPlan(text, installed);
  if (plan.stack.length === 0) return undefined;

  const stack: PdfFont[] = [];
  for (const font of plan.stack) {
    if (registered.has(font.family)) {
      stack.push(font);
      continue;
    }
    try {
      const data = await readInstalledPdfFont(font, files);
      // A font whose bytes fail to read counts as not installed.
      if (!data) continue;
      register(font, data);
      stack.push(font);
    } catch {
      // Same: an unreadable font is not embedded this run.
    }
  }

  return stack.length > 0 ? stack.map((font) => font.family) : undefined;
}
