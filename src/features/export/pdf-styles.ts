/**
 * CSS styles for PDF export via browser print.
 * Browser controls page size, margins, headers/footers, etc.
 * All styles are scoped to .pdf-preview-content to avoid affecting the UI.
 */

export interface PdfExportOptions {
  includeTableOfContents: boolean;
}

export const DEFAULT_PDF_OPTIONS: PdfExportOptions = {
  includeTableOfContents: true,
};

/**
 * Generate styles for PDF export.
 * All rules scoped to .pdf-preview-content for preview isolation.
 */
export function generatePdfStyles(_options: PdfExportOptions): string {
  // Scope prefix for all styles
  const s = ".pdf-preview-content";

  return `
/* ===================
   BASE TYPOGRAPHY
   =================== */
${s} {
  font-family: Georgia, "Times New Roman", serif;
  font-size: 12pt;
  line-height: 1.6;
  color: #000;
  background: #fff;
}

${s} * { box-sizing: border-box; }

/* ===================
   COVER PAGE
   =================== */
${s} .cover-page {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  background: #fff;
  page-break-after: always;
  break-after: page;
}

/* Cover with image */
${s} .cover-page img {
  max-width: 100%;
  max-height: 100vh;
  object-fit: cover;
  height: 100vh;
  width: 100%;
}

/* Text-only cover (no image) */
${s} .cover-page .title {
  font-size: 36pt;
  font-weight: bold;
  margin-bottom: 0.5em;
  color: #000;
}

${s} .cover-page .subtitle {
  font-size: 18pt;
  font-style: italic;
  margin-bottom: 2em;
  color: #555;
}

${s} .cover-page .author {
  font-size: 18pt;
  color: #333;
  margin-top: 3em;
}

/* ===================
   TABLE OF CONTENTS
   =================== */
${s} .toc {
  page-break-after: always;
  break-after: page;
  padding: 2em 0;
}

${s} .toc h2 {
  text-align: center;
  font-size: 24pt;
  margin-bottom: 2em;
  color: #000;
}

${s} .toc-entry {
  display: block;
  margin-bottom: 0.75em;
  line-height: 1.6;
  font-size: 14pt;
}

${s} .toc-entry a {
  color: #000;
  text-decoration: none;
}

${s} .toc-entry a:hover {
  text-decoration: underline;
}

/* ===================
   CHAPTERS
   =================== */
${s} .chapter {
  page-break-before: always;
  break-before: page;
}

/* First chapter doesn't need page break if it follows TOC or cover */
${s} .toc + .chapter,
${s} .cover-page + .chapter {
  page-break-before: auto;
  break-before: auto;
}

${s} .chapter-header {
  text-align: center;
  margin-bottom: 3em;
  padding-top: 3em;
  page-break-after: avoid;
  break-after: avoid;
  page-break-inside: avoid;
  break-inside: avoid;
}

${s} .chapter-number {
  font-size: 14pt;
  font-variant: small-caps;
  letter-spacing: 0.2em;
  color: #666;
  margin-bottom: 0.75em;
  display: block;
}

${s} .chapter-title {
  font-size: 28pt;
  font-weight: normal;
  margin: 0;
  color: #000;
  line-height: 1.2;
}

${s} .chapter-content {
  color: #000;
}

/* ===================
   TYPOGRAPHY
   =================== */
   
/* Headings - keep with following content */
${s} h1, ${s} h2, ${s} h3, ${s} h4, ${s} h5, ${s} h6 {
  color: #000;
  page-break-after: avoid;
  break-after: avoid;
  page-break-inside: avoid;
  break-inside: avoid;
  margin-top: 1.5em;
  margin-bottom: 0.5em;
}

/* Paragraphs */
${s} p {
  margin: 0 0 0.75em 0;
  text-indent: 1.5em;
  text-align: justify;
  orphans: 3;
  widows: 3;
  color: #000;
}

/* No indent after headings or breaks */
${s} h1 + p, ${s} h2 + p, ${s} h3 + p, ${s} h4 + p, ${s} hr + p, ${s} blockquote + p {
  text-indent: 0;
}

${s} .chapter-content > p:first-child {
  text-indent: 0;
}

/* Scene breaks */
${s} hr {
  border: none;
  text-align: center;
  margin: 2em 0;
  page-break-after: avoid;
  break-after: avoid;
}

${s} hr::before {
  content: "* * *";
  letter-spacing: 0.5em;
  color: #666;
  font-size: 14pt;
}

/* Lists */
${s} ul, ${s} ol {
  margin: 1em 0;
  padding-left: 2em;
  color: #000;
}

${s} li {
  margin-bottom: 0.25em;
  color: #000;
}

/* Blockquotes */
${s} blockquote {
  margin: 1.5em 2em;
  font-style: italic;
  color: #333;
  border-left: 3px solid #ccc;
  padding-left: 1em;
}

/* Images */
${s} img:not(.cover-page img) {
  max-width: 100%;
  height: auto;
  display: block;
  margin: 1.5em auto;
  page-break-inside: avoid;
  break-inside: avoid;
}

/* Tables */
${s} table {
  width: 100%;
  border-collapse: collapse;
  margin: 1em 0;
  page-break-inside: avoid;
  break-inside: avoid;
}

${s} th, ${s} td {
  border: 1px solid #ccc;
  padding: 0.5em;
  text-align: left;
  color: #000;
  background: #fff;
}

${s} th {
  background: #f5f5f5;
  font-weight: bold;
}

/* Footnotes */
${s} .footnote-ref {
  font-size: 0.75em;
  vertical-align: super;
}

${s} .footnote-ref a {
  color: #000;
  text-decoration: none;
}

${s} .endnotes {
  margin-top: 3em;
  border-top: 1px solid #ccc;
  padding-top: 1em;
  font-size: 10pt;
}

${s} .endnotes h2 {
  font-size: 14pt;
  margin-bottom: 1em;
}

${s} .endnote {
  margin-bottom: 0.5em;
  text-indent: 0;
}

/* Links */
${s} a {
  color: #000;
  text-decoration: none;
}

/* ===================
   PRINT STYLES
   =================== */
@media print {
  /* Page margins - ensures content doesn't overflow into edges */
  @page {
    margin: 2.5cm 2cm;
  }
  
  /* First page (cover) - no margins */
  @page :first {
    margin: 0;
  }
  
  /* Reset any problematic styles */
  ${s} {
    margin: 0;
    padding: 0;
  }
  
  ${s} .cover-page {
    padding: 0;
    margin: 0;
    height: 100vh;
    page-break-after: always;
  }
  
  ${s} .cover-page img {
    width: 100%;
    height: 100vh;
    object-fit: contain;
  }
  
  ${s} .toc {
    padding-top: 2em;
  }
  
  ${s} .chapter {
    padding: 0;
  }
  
  ${s} .chapter-header {
    padding-top: 4em;
  }
  
  /* Ensure text doesn't get clipped */
  ${s} p,
  ${s} li,
  ${s} blockquote,
  ${s} .chapter-content {
    overflow: visible;
  }
}
`;
}
