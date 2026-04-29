import type { Diagnostic, linter as linterFn } from "@codemirror/lint";
import type { EditorView } from "@codemirror/view";

type HtmlDiagnostic = Pick<Diagnostic, "from" | "to" | "severity" | "message">;

/**
 * Validate HTML string and return diagnostics.
 * Uses DOMParser for structural validation.
 */
export function validateHtml(html: string): HtmlDiagnostic[] {
  if (!html.trim()) return [];

  const diagnostics: HtmlDiagnostic[] = [];

  // Use DOMParser to check for structural errors
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const parserErrors = doc.querySelectorAll("parsererror");

  if (parserErrors.length > 0) {
    diagnostics.push({
      from: 0,
      to: Math.min(html.length, 50),
      severity: "error",
      message: parserErrors[0].textContent || "HTML parsing error",
    });
  }

  // Check for common structural issues by regex scanning
  // Detect unclosed tags (simple heuristic)
  const tagStack: { tag: string; pos: number }[] = [];
  const selfClosing = new Set([
    "br",
    "hr",
    "img",
    "input",
    "meta",
    "link",
    "area",
    "base",
    "col",
    "embed",
    "source",
    "track",
    "wbr",
  ]);

  // Tags that auto-close when nested inside themselves
  const autoClosing = new Set([
    "p",
    "li",
    "td",
    "th",
    "tr",
    "thead",
    "tbody",
    "tfoot",
    "dt",
    "dd",
    "option",
    "optgroup",
    "colgroup",
    "caption",
    "rt",
    "rp",
  ]);

  const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*\/?>/g;
  let match = tagRegex.exec(html);

  while (match !== null) {
    const fullMatch = match[0];
    const tagName = match[1].toLowerCase();
    const pos = match.index;

    if (selfClosing.has(tagName) || fullMatch.endsWith("/>")) {
      continue;
    }

    if (fullMatch.startsWith("</")) {
      // Closing tag
      const lastOpen = tagStack[tagStack.length - 1];
      if (lastOpen && lastOpen.tag === tagName) {
        tagStack.pop();
      } else if (lastOpen) {
        diagnostics.push({
          from: pos,
          to: pos + fullMatch.length,
          severity: "error",
          message: `Unexpected closing tag </${tagName}>, expected </${lastOpen.tag}>`,
        });
      }
    } else {
      // Opening tag — check for auto-closing
      if (autoClosing.has(tagName)) {
        const lastOpen = tagStack[tagStack.length - 1];
        if (lastOpen && lastOpen.tag === tagName) {
          // Auto-close the previous same tag (invalid nesting)
          tagStack.pop();
          diagnostics.push({
            from: pos,
            to: pos + fullMatch.length,
            severity: "warning",
            message: `<${tagName}> implicitly closes previous <${tagName}>`,
          });
        }
      }
      tagStack.push({ tag: tagName, pos });
    }
    match = tagRegex.exec(html);
  }

  // Report unclosed tags
  for (const unclosed of tagStack) {
    diagnostics.push({
      from: unclosed.pos,
      to: Math.min(unclosed.pos + unclosed.tag.length + 2, html.length),
      severity: "error",
      message: `Unclosed tag <${unclosed.tag}>`,
    });
  }

  return diagnostics;
}

/**
 * Create a CodeMirror linter extension from the HTML validator.
 */
export function createHtmlLinter(linter: typeof linterFn) {
  return linter(
    (view: EditorView): Diagnostic[] => {
      return validateHtml(view.state.doc.toString());
    },
    { delay: 300 },
  );
}
