import { create } from "zustand";
import { PDF_FONT_CATALOG, pdfFontFor } from "@/features/pdf-fonts/catalog";
import { installPdfFont, isPdfFontInstalled } from "@/features/pdf-fonts/install";
import type { PdfFontId } from "@/features/pdf-fonts/types";
import { getPdfFontFiles } from "@/lib/platform";

export interface PdfFontsState {
  installed: PdfFontId[];
  downloading: PdfFontId[];
  failed: PdfFontId[];
  loaded: boolean;
  refresh: () => Promise<void>;
  download: (id: PdfFontId) => Promise<void>;
  remove: (id: PdfFontId) => Promise<void>;
}

// Not persisted: the installed files are the truth on this device.
export const usePdfFonts = create<PdfFontsState>((set, get) => ({
  installed: [],
  downloading: [],
  failed: [],
  loaded: false,

  async refresh() {
    const files = await getPdfFontFiles();
    const installed: PdfFontId[] = [];
    for (const font of PDF_FONT_CATALOG) {
      if (await isPdfFontInstalled(font, files)) installed.push(font.id);
    }
    set({ installed, loaded: true });
  },

  async download(id) {
    if (get().downloading.includes(id)) return;
    const font = pdfFontFor(id);
    if (!font) return;

    set((state) => ({
      downloading: [...state.downloading, id],
      failed: state.failed.filter((failed) => failed !== id),
    }));

    try {
      const files = await getPdfFontFiles();
      await installPdfFont(font, files);
      set((state) => ({
        installed: state.installed.includes(id) ? state.installed : [...state.installed, id],
      }));
    } catch {
      set((state) => ({
        failed: state.failed.includes(id) ? state.failed : [...state.failed, id],
      }));
    } finally {
      set((state) => ({
        downloading: state.downloading.filter((downloading) => downloading !== id),
      }));
    }
  },

  async remove(id) {
    if (get().downloading.includes(id)) return;
    const files = await getPdfFontFiles();
    await files.remove(id);
    set((state) => ({
      installed: state.installed.filter((installed) => installed !== id),
      failed: state.failed.filter((failed) => failed !== id),
    }));
  },
}));
