import type { DownloadedFiles, PinnedFile } from "@/lib/verified-download";
import { fetchVerified } from "@/lib/verified-download";
import type { InstalledPdfFont, PdfFont } from "@/features/pdf-fonts/types";

const MARKER = "pin";

const STYLES: readonly (keyof InstalledPdfFont)[] = ["regular", "bold", "italic", "boldItalic"];

function fileName(file: PinnedFile): string {
  return file.url.slice(file.url.lastIndexOf("/") + 1);
}

function styleFiles(font: PdfFont): { style: keyof InstalledPdfFont; file: PinnedFile }[] {
  const files: { style: keyof InstalledPdfFont; file: PinnedFile }[] = [];
  for (const style of STYLES) {
    const file = font.files[style];
    if (file) files.push({ style, file });
  }
  return files;
}

function pin(font: PdfFont): string {
  return styleFiles(font)
    .map(({ file }) => file.sha256)
    .join(":");
}

/**
 * Verifies every file before touching the device: nothing is written when any
 * download is wrong. The marker goes last, so a partial install reads as not
 * installed.
 */
export async function installPdfFont(
  font: PdfFont,
  files: DownloadedFiles,
  fetchFile: (url: string) => Promise<Response> = fetch
): Promise<void> {
  const styles = styleFiles(font);
  const bytes: Uint8Array[] = [];
  for (const { file } of styles) bytes.push(await fetchVerified(file, fetchFile));

  try {
    for (let i = 0; i < styles.length; i++) {
      await files.write(font.id, fileName(styles[i].file), bytes[i]);
    }
    await files.write(font.id, MARKER, new TextEncoder().encode(pin(font)));
  } catch (error) {
    await files.remove(font.id);
    throw error;
  }
}

/** The installed styles, or null when this font's current pins are not on disk. */
export async function readInstalledPdfFont(
  font: PdfFont,
  files: DownloadedFiles
): Promise<InstalledPdfFont | null> {
  if (!(await isPdfFontInstalled(font, files))) return null;

  const read = new Map<keyof InstalledPdfFont, Uint8Array>();
  for (const { style, file } of styleFiles(font)) {
    const data = await files.read(font.id, fileName(file));
    if (!data || data.byteLength !== file.bytes) return null;
    read.set(style, data);
  }
  const regular = read.get("regular");
  const bold = read.get("bold");
  if (!regular || !bold) return null;
  return { regular, bold, italic: read.get("italic"), boldItalic: read.get("boldItalic") };
}

export async function isPdfFontInstalled(font: PdfFont, files: DownloadedFiles): Promise<boolean> {
  const marker = await files.read(font.id, MARKER);
  return marker !== null && new TextDecoder().decode(marker) === pin(font);
}
