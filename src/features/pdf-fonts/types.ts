import type { PinnedFile } from "@/lib/verified-download";

export type PdfFontId = "latin" | "cjk";

/** One embedded font: its four styles, where each came from, and its pin. */
export interface PdfFont {
  id: PdfFontId;
  family: "Noto Serif" | "Noto Serif CJK";
  files: {
    regular: PinnedFile;
    bold: PinnedFile;
    italic?: PinnedFile;
    boldItalic?: PinnedFile;
  };
  /** Hex `start-end` ranges of code points present in every one of its files. */
  coverage: string;
  license: "OFL-1.1";
  source: string;
}

/** The bytes of an installed font, per style, as read back from the device. */
export interface InstalledPdfFont {
  regular: Uint8Array;
  bold: Uint8Array;
  italic?: Uint8Array;
  boldItalic?: Uint8Array;
}

export interface PdfFontPlan {
  /** Fonts to embed, in catalog order. */
  stack: PdfFont[];
  /** True when a required code point no installed font covers. */
  missing: boolean;
  /** Uninstalled fonts that would cover at least one uncovered code point. */
  offers: PdfFont[];
}
