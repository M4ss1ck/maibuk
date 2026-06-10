import { Marked } from "marked";

/**
 * Converts Markdown into HTML the Maibuk editor renders correctly.
 *
 * `marked` produces standard HTML; we then constrain it to the editor's node
 * set: headings deeper than h3 are demoted, and any element outside the
 * allow-list is unwrapped (its children are kept). This mirrors the import
 * normalisation in `xhtml-to-editor` so pasted/imported Markdown lands as
 * clean, supported content.
 */

const marked = new Marked({ gfm: true, breaks: false });

/** Block + inline elements the editor schema understands. */
const ALLOWED_ELEMENTS = new Set([
  "A",
  "BLOCKQUOTE",
  "BR",
  "CODE",
  "EM",
  "H1",
  "H2",
  "H3",
  "HR",
  "IMG",
  "LI",
  "OL",
  "P",
  "PRE",
  "S",
  "STRONG",
  "SUB",
  "SUP",
  "TABLE",
  "TBODY",
  "TD",
  "TFOOT",
  "TH",
  "THEAD",
  "TR",
  "U",
  "UL",
]);

export function markdownToEditorHtml(markdown: string): string {
  if (!markdown.trim()) return "";

  const rawHtml = marked.parse(markdown, { async: false }) as string;
  const doc = new DOMParser().parseFromString(rawHtml, "text/html");
  const body = doc.body;

  demoteDeepHeadings(body);
  unwrapDisallowedElements(body);

  return body.innerHTML.trim();
}

function demoteDeepHeadings(body: HTMLElement): void {
  for (const el of Array.from(body.querySelectorAll("h4, h5, h6"))) {
    const replacement = el.ownerDocument.createElement("h3");
    while (el.firstChild) replacement.appendChild(el.firstChild);
    el.replaceWith(replacement);
  }
}

function unwrapDisallowedElements(body: HTMLElement): void {
  for (const el of Array.from(body.querySelectorAll("*"))) {
    if (ALLOWED_ELEMENTS.has(el.tagName)) continue;
    el.replaceWith(...Array.from(el.childNodes));
  }
}
