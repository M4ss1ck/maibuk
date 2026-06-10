import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

/**
 * Converts Maibuk editor HTML into Markdown for export.
 *
 * A DOM pre-pass translates Maibuk-specific constructs that Turndown wouldn't
 * understand — scene breaks become a `* * *` thematic line, footnotes become
 * inline `[^n]` references with definitions appended — and strips editor-only
 * wrappers (figure/figcaption around images). Turndown + the GFM plugin then
 * handle the standard HTML.
 */

const turndown = new TurndownService({
  headingStyle: "atx",
  hr: "* * *",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  emDelimiter: "*",
  strongDelimiter: "**",
});
turndown.use(gfm);

export function editorHtmlToMarkdown(html: string): string {
  if (!html.trim()) return "";

  const doc = new DOMParser().parseFromString(html, "text/html");
  const body = doc.body;

  convertSceneBreaks(body);
  const footnotes = extractFootnotes(body);
  unwrapFigures(body);

  let markdown = turndown.turndown(body.innerHTML).trim();

  if (footnotes.length > 0) {
    const defs = footnotes
      .map((fn) => `[^${fn.number}]: ${fn.content}`)
      .join("\n");
    markdown = `${markdown}\n\n${defs}`;
  }

  return markdown;
}

function convertSceneBreaks(body: HTMLElement): void {
  for (const div of Array.from(body.querySelectorAll("div[data-scene-break]"))) {
    const hr = div.ownerDocument.createElement("hr");
    div.replaceWith(hr);
  }
}

interface ExtractedFootnote {
  number: number;
  content: string;
}

function extractFootnotes(body: HTMLElement): ExtractedFootnote[] {
  const footnotes: ExtractedFootnote[] = [];
  const sups = Array.from(
    body.querySelectorAll<HTMLElement>("sup[data-footnote]"),
  );
  sups.forEach((sup, index) => {
    const number = index + 1;
    const content = sup.getAttribute("data-footnote-content") ?? "";
    footnotes.push({ number, content });
    sup.replaceWith(sup.ownerDocument.createTextNode(`[^${number}]`));
  });
  return footnotes;
}

function unwrapFigures(body: HTMLElement): void {
  for (const figure of Array.from(body.querySelectorAll("figure"))) {
    const img = figure.querySelector("img");
    if (img) {
      figure.replaceWith(img);
    } else {
      figure.replaceWith(...Array.from(figure.childNodes));
    }
  }
}
