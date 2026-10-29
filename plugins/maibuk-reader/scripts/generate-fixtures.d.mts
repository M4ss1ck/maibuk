export const LARGE_PDF_PAGES: number;
export const LARGE_PDF_IMAGE: number;
export const LARGE_EPUB_SECTIONS: number;
export function buildLargePdf(options?: { pages?: number; imageSize?: number }): Buffer;
export function buildLargeEpub(options?: { sections?: number }): Buffer;
