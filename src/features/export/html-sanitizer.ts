/**
 * HTML Sanitizer for EPUB Export
 *
 * Converts Tiptap editor HTML to EPUB-compatible HTML by:
 * - Converting footnotes to endnotes format
 * - Converting scene breaks to <hr>
 * - Stripping editor-specific CSS classes
 * - Preserving standard HTML formatting
 */

interface Footnote {
  id: string;
  content: string;
  number: number;
}

interface SanitizeResult {
  html: string;
  footnotes: Footnote[];
}

/**
 * Sanitizes Tiptap HTML content for EPUB export.
 * Returns the sanitized HTML and extracted footnotes.
 */
export function sanitizeHtmlForEpub(html: string): SanitizeResult {
  if (!html) {
    return { html: "", footnotes: [] };
  }

  let sanitized = html;
  const footnotes: Footnote[] = [];
  let footnoteCounter = 0;

  // Extract and convert footnotes
  // Footnotes are: <span data-footnote data-footnote-content="..." data-footnote-id="...">text</span>
  sanitized = sanitized.replace(
    /<span[^>]*data-footnote[^>]*data-footnote-content="([^"]*)"[^>]*data-footnote-id="([^"]*)"[^>]*>(.*?)<\/span>/gi,
    (_match, content, id, text) => {
      footnoteCounter++;
      footnotes.push({
        id: id || `fn-${footnoteCounter}`,
        content: decodeHtmlEntities(content),
        number: footnoteCounter,
      });
      return `${text}<sup class="footnote-ref"><a href="#fn-${footnoteCounter}" id="fnref-${footnoteCounter}">[${footnoteCounter}]</a></sup>`;
    }
  );

  // Also handle footnotes where attributes are in different order
  sanitized = sanitized.replace(
    /<span[^>]*data-footnote-id="([^"]*)"[^>]*data-footnote-content="([^"]*)"[^>]*data-footnote[^>]*>(.*?)<\/span>/gi,
    (_match, id, content, text) => {
      footnoteCounter++;
      footnotes.push({
        id: id || `fn-${footnoteCounter}`,
        content: decodeHtmlEntities(content),
        number: footnoteCounter,
      });
      return `${text}<sup class="footnote-ref"><a href="#fn-${footnoteCounter}" id="fnref-${footnoteCounter}">[${footnoteCounter}]</a></sup>`;
    }
  );

  // Convert scene breaks
  // Scene breaks are: <div data-scene-break class="scene-break"><span class="scene-break-symbols">* * *</span></div>
  sanitized = sanitized.replace(
    /<div[^>]*data-scene-break[^>]*>.*?<\/div>/gi,
    '<hr class="scene-break" />'
  );

  // Strip editor-specific classes while preserving the elements
  sanitized = sanitized.replace(/class="[^"]*editor-[^"]*"/gi, "");
  sanitized = sanitized.replace(/class="[^"]*ProseMirror[^"]*"/gi, "");

  // Clean up empty class attributes
  sanitized = sanitized.replace(/class=""/g, "");
  sanitized = sanitized.replace(/class="\s+"/g, "");

  // Remove data attributes that aren't needed (except for scene-break hr)
  sanitized = sanitized.replace(/\s+data-[^=]+="[^"]*"/gi, (match) => {
    // Keep scene-break class on hr
    if (match.includes("scene-break")) return "";
    return "";
  });

  // Convert highlight marks to standard mark element
  sanitized = sanitized.replace(
    /<mark[^>]*data-color="([^"]*)"[^>]*>(.*?)<\/mark>/gi,
    '<mark style="background-color: $1">$2</mark>'
  );

  // Clean up any remaining Tiptap-specific elements
  // Remove font-family and font-size inline styles that might not render well
  // (keep them for now, e-readers typically handle them okay)

  return { html: sanitized, footnotes };
}

/**
 * Generates the endnotes section HTML from collected footnotes.
 */
export function generateEndnotesHtml(footnotes: Footnote[]): string {
  if (footnotes.length === 0) {
    return "";
  }

  const endnoteItems = footnotes
    .map(
      (fn) =>
        `<p class="endnote" id="fn-${fn.number}"><span class="endnote-number">${fn.number}.</span> ${fn.content} <a href="#fnref-${fn.number}">↩</a></p>`
    )
    .join("\n");

  return `
<section class="endnotes">
  <h2>Notes</h2>
  ${endnoteItems}
</section>`;
}

/**
 * Helper to decode HTML entities in footnote content.
 */
function decodeHtmlEntities(text: string): string {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = text;
  return textarea.value;
}

/**
 * Combines sanitized chapter HTML with its endnotes.
 */
export function processChapterHtml(html: string): string {
  const { html: sanitizedHtml, footnotes } = sanitizeHtmlForEpub(html);
  const endnotesHtml = generateEndnotesHtml(footnotes);
  return sanitizedHtml + endnotesHtml;
}
