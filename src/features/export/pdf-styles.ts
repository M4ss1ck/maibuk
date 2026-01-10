/**
 * CSS Paged Media styles for PDF export.
 * Uses Paged.js for rendering.
 */

export type PageSize = "a4" | "letter" | "6x9";

export interface PdfExportOptions {
  pageSize: PageSize;
  includeTableOfContents: boolean;
  includePageNumbers: boolean;
  includeRunningHeaders: boolean;
}

export const DEFAULT_PDF_OPTIONS: PdfExportOptions = {
  pageSize: "a4",
  includeTableOfContents: true,
  includePageNumbers: true,
  includeRunningHeaders: true,
};

export const PAGE_SIZES: Record<PageSize, { width: string; height: string; label: string }> = {
  a4: { width: "210mm", height: "297mm", label: "A4" },
  letter: { width: "8.5in", height: "11in", label: "Letter" },
  "6x9": { width: "6in", height: "9in", label: '6" × 9" (Book)' },
};

/**
 * Generate CSS Paged Media styles for PDF export.
 */
export function generatePdfStyles(options: PdfExportOptions): string {
  const pageSize = PAGE_SIZES[options.pageSize];
  const s = ".pagedjs_page";

  return `
@page {
  size: ${pageSize.width} ${pageSize.height};
  margin: 2.5cm 2cm;
  ${options.includePageNumbers ? `
  @bottom-center {
    content: counter(page);
    font-family: Georgia, serif;
    font-size: 10pt;
    color: #666;
  }` : ""}
  ${options.includeRunningHeaders ? `
  @top-center {
    content: string(chapter-title);
    font-family: Georgia, serif;
    font-size: 10pt;
    font-style: italic;
    color: #666;
  }` : ""}
}

@page cover { margin: 0; @top-center { content: none; } @bottom-center { content: none; } }
@page toc { @top-center { content: none; } }
@page chapter-start { @top-center { content: none; } }

${s} { font-family: Georgia, "Times New Roman", serif; font-size: 12pt; line-height: 1.6; color: #000; background: #fff; }
${s} * { box-sizing: border-box; }

${s} .cover-page { page: cover; break-after: page; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; height: 100vh; width: 100%; margin: 0; padding: 2cm; background: #fff; }
${s} .cover-page img { position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; }
${s} .cover-page .title { font-size: 32pt; font-weight: bold; margin-bottom: 0.5em; color: #000; }
${s} .cover-page .subtitle { font-size: 18pt; font-style: italic; margin-bottom: 2em; color: #333; }
${s} .cover-page .author { font-size: 16pt; color: #000; margin-top: auto; }

${s} .toc { page: toc; break-after: page; }
${s} .toc h2 { text-align: center; font-size: 18pt; margin-bottom: 2em; color: #000; }
${s} .toc-entry { display: flex; margin-bottom: 0.75em; line-height: 1.4; }
${s} .toc-entry a { color: #000; text-decoration: none; flex: 1; padding-right: 0.5em; }
${s} .toc-entry .page-number { text-align: right; padding-left: 0.5em; }
${s} .toc-entry .page-number::after { content: target-counter(attr(href url), page); }

${s} .chapter { break-before: page; }
${s} .cover-page + .chapter, ${s} .toc + .chapter { break-before: auto; }
${s} .chapter-header { page: chapter-start; text-align: center; margin-bottom: 3em; padding-top: 4cm; }
${s} .chapter-number { font-size: 14pt; font-variant: small-caps; letter-spacing: 0.15em; color: #666; margin-bottom: 0.5em; }
${s} .chapter-title { font-size: 24pt; font-weight: normal; margin: 0; color: #000; string-set: chapter-title content(); }
${s} .chapter-content { color: #000; }

${s} h1, ${s} h2, ${s} h3, ${s} h4, ${s} h5, ${s} h6 { color: #000; break-after: avoid; margin-top: 1.5em; margin-bottom: 0.5em; }
${s} p { margin: 0; text-indent: 1.5em; text-align: justify; orphans: 3; widows: 3; color: #000; }
${s} h1 + p, ${s} h2 + p, ${s} h3 + p, ${s} h4 + p, ${s} hr + p, ${s} blockquote + p { text-indent: 0; }
${s} .chapter-content > p:first-child { text-indent: 0; }

${s} hr { border: none; text-align: center; margin: 2em 0; }
${s} hr::before { content: "* * *"; letter-spacing: 0.5em; color: #000; }

${s} ul, ${s} ol { margin: 1em 0; padding-left: 2em; color: #000; }
${s} li { margin-bottom: 0.25em; color: #000; }
${s} blockquote { margin: 1.5em 2em; font-style: italic; color: #333; }

${s} img:not(.cover-page img) { max-width: 100%; height: auto; display: block; margin: 1em auto; }
${s} table { width: 100%; border-collapse: collapse; margin: 1em 0; }
${s} th, ${s} td { border: 1px solid #ccc; padding: 0.5em; text-align: left; color: #000; background: #fff; }
${s} th { background: #f5f5f5; font-weight: bold; }

${s} .footnote-ref { font-size: 0.75em; vertical-align: super; }
${s} .footnote-ref a { color: #000; text-decoration: none; }
${s} .endnotes { margin-top: 3em; border-top: 1px solid #ccc; padding-top: 1em; font-size: 10pt; }
${s} .endnotes h2 { font-size: 14pt; margin-bottom: 1em; }
${s} .endnote { margin-bottom: 0.5em; text-indent: 0; }
${s} a { color: #000; text-decoration: none; }
`;
}
