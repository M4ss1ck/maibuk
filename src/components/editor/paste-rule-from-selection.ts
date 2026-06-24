import type { PasteRuleTarget } from "../../features/settings/types";

/** Common HTML tag names that, when selected alone, should map to a `tag` rule. */
const KNOWN_TAGS = new Set([
  "a", "abbr", "address", "article", "aside", "b", "blockquote", "br", "code",
  "col", "colgroup", "dd", "del", "details", "div", "dl", "dt", "em", "figcaption",
  "figure", "font", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr",
  "i", "img", "ins", "kbd", "li", "main", "mark", "nav", "ol", "p", "pre", "q",
  "s", "section", "small", "span", "strike", "strong", "sub", "summary", "sup",
  "table", "tbody", "td", "tfoot", "th", "thead", "tr", "u", "ul",
]);

const COLOR_RE = /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla)\([^)]*\))$/i;
const IDENTIFIER_RE = /^[a-z][\w-]*$/i;

/**
 * Turn a text selection from the HTML source view into a best-guess custom
 * cleanup rule (target + value). Returns null for empty selections. The guess
 * is only a starting point — the user confirms or changes the target and picks
 * the action in the Custom Rules editor.
 *
 * Inline CSS (a `style="…"` attribute or a `prop: value; …` declaration block)
 * is turned into a valid `[style*=…]` selector that matches the selected CSS
 * property names. The paste engine's `removeStyle` action then strips the whole
 * `style` attribute. Matching property names instead of the exact declaration
 * string keeps the rule stable when browser/clipboard HTML serializes
 * declarations in a different order or with different value spacing.
 */
export function inferPasteRuleFromSelection(
  raw: string,
): { target: PasteRuleTarget; value: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const inlineStyle = extractInlineStyle(trimmed);
  if (inlineStyle) {
    return {
      target: "cssSelector",
      value: buildInlineStyleSelector(inlineStyle),
    };
  }

  const value = trimmed;
  if (COLOR_RE.test(value)) {
    return { target: "textColor", value };
  }

  // ".MsoNormal" — a single class with a leading dot.
  if (value.startsWith(".") && IDENTIFIER_RE.test(value.slice(1))) {
    return { target: "cssClass", value: value.slice(1) };
  }

  // Anything with selector syntax (combinators, attribute/id/pseudo, whitespace).
  if (/[\s>+~[#:.]/.test(value)) {
    return { target: "cssSelector", value };
  }

  if (KNOWN_TAGS.has(value.toLowerCase())) {
    return { target: "tag", value };
  }

  return { target: "cssClass", value };
}

/**
 * Recognise an inline-style selection and return its declaration body, or null.
 * Two unambiguous forms qualify: an explicit `style="…"` / `style='…'` attribute,
 * or a multi-declaration block (`prop: value; …`) — semicolons never appear in
 * CSS selectors, so this never swallows a real selector like
 * `span[style*="font-size"]`.
 */
function extractInlineStyle(text: string): string | null {
  const attrMatch = text.match(/^style\s*=\s*(.*)$/is);
  if (attrMatch) {
    let body = attrMatch[1].trim();
    const quote = body[0];
    if ((quote === '"' || quote === "'") && body.endsWith(quote)) {
      body = body.slice(1, -1);
    }
    body = body.trim();
    return body || null;
  }

  if (text.includes(";") && /^[a-z-]+\s*:\s*\S/i.test(text)) {
    return text;
  }
  return null;
}

function buildInlineStyleSelector(style: string): string {
  const properties = extractStylePropertyNames(style);
  if (properties.length === 0) {
    return `[style*="${escapeAttrSelectorValue(style)}"]`;
  }
  return properties
    .map((property) => `[style*="${escapeAttrSelectorValue(property)}"]`)
    .join("");
}

function extractStylePropertyNames(style: string): string[] {
  const seen = new Set<string>();
  const properties: string[] = [];
  for (const declaration of style.split(";")) {
    const match = declaration.match(/^\s*(-{0,2}[a-z][\w-]*)\s*:/i);
    if (!match) continue;
    const property = match[1].toLowerCase();
    if (seen.has(property)) continue;
    seen.add(property);
    properties.push(property);
  }
  return properties;
}

/** Escape a value for embedding inside a double-quoted `[attr*="…"]` selector. */
function escapeAttrSelectorValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
