/**
 * Plugin CSS scoping (#439): a Plugin stylesheet is rewritten so every rule it
 * can express reaches the Plugin's own host-rendered surface and nothing else.
 *
 * A scoped stylesheet never relies on the browser: each selector is prefixed
 * with the surface's own `[data-plugin-ui="…"]` attribute, so a rule can only
 * match a descendant of that surface. Two Plugins get two attribute values, and
 * Maibuk chrome carries neither, so Plugin CSS cannot restyle the app or
 * another Plugin. Conditional at-rules recurse; anything that cannot be scoped
 * — `@import`, `@font-face`, `@keyframes`, `@page`, and CSS nesting — is
 * dropped, failing closed instead of leaking an unprefixed selector.
 *
 * The rewrite is deliberately flat: it understands rules, selector lists,
 * declaration blocks, strings, and comments, and keeps declarations byte for
 * byte. Unsupported syntax is dropped, never rendered.
 */

/** At-rules whose block holds more rules, which are then scoped in turn. */
const RECURSIVE_AT_RULES = new Set([
  "media",
  "supports",
  "container",
  "layer",
  "starting-style",
  "scope",
]);

function isQuote(char: string): boolean {
  return char === '"' || char === "'";
}

/** Removes comments, leaving strings untouched. */
function stripComments(css: string): string {
  let out = "";
  let i = 0;
  while (i < css.length) {
    const char = css[i];
    if (char === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      i = end === -1 ? css.length : end + 2;
      continue;
    }
    if (isQuote(char)) {
      const start = i;
      i += 1;
      while (i < css.length && css[i] !== char) {
        if (css[i] === "\\") i += 1;
        i += 1;
      }
      i += 1;
      out += css.slice(start, i);
      continue;
    }
    out += char;
    i += 1;
  }
  return out;
}

/**
 * The index of the next top-level `{` or `;`, skipping comments and strings;
 * -1 when the rest holds neither.
 */
function nextDelimiter(css: string, from: number): { index: number; char: "{" | ";" } | null {
  let i = from;
  while (i < css.length) {
    const char = css[i];
    if (char === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      i = end === -1 ? css.length : end + 2;
      continue;
    }
    if (isQuote(char)) {
      i += 1;
      while (i < css.length && css[i] !== char) {
        if (css[i] === "\\") i += 1;
        i += 1;
      }
      i += 1;
      continue;
    }
    if (char === "{") return { index: i, char: "{" };
    if (char === ";") return { index: i, char: ";" };
    i += 1;
  }
  return null;
}

/** The index of the `}` matching the `{` at `open`, nesting- and string-aware. */
function matchingBrace(css: string, open: number): number {
  let depth = 0;
  let i = open;
  while (i < css.length) {
    const char = css[i];
    if (char === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      i = end === -1 ? css.length : end + 2;
      continue;
    }
    if (isQuote(char)) {
      i += 1;
      while (i < css.length && css[i] !== char) {
        if (css[i] === "\\") i += 1;
        i += 1;
      }
      i += 1;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return -1;
}

/** True when a rule body holds a nested block, which a flat rewrite cannot scope. */
function hasNestedBlock(body: string): boolean {
  return nextDelimiter(body, 0)?.char === "{";
}

/** Splits a selector list on commas that sit outside brackets, parens, and strings. */
function splitTopLevel(selectorList: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  let i = 0;
  while (i < selectorList.length) {
    const char = selectorList[i];
    if (isQuote(char)) {
      const start = i;
      i += 1;
      while (i < selectorList.length && selectorList[i] !== char) {
        if (selectorList[i] === "\\") i += 1;
        i += 1;
      }
      i += 1;
      current += selectorList.slice(start, i);
      continue;
    }
    if (char === "(" || char === "[") depth += 1;
    if (char === ")" || char === "]") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
    i += 1;
  }
  parts.push(current);
  return parts;
}

function scopeSelectorList(selectorList: string, scope: string): string {
  return splitTopLevel(selectorList)
    .map((selector) => selector.trim())
    .filter((selector) => selector !== "")
    .map((selector) => `${scope} ${selector}`)
    .join(", ");
}

function transformRules(css: string, scope: string): string {
  let out = "";
  let pos = 0;
  while (pos < css.length) {
    const delimiter = nextDelimiter(css, pos);
    if (delimiter === null) break;
    if (delimiter.char === ";") {
      // A bare statement (`@import …;`, `@charset …;`) carries no rule.
      pos = delimiter.index + 1;
      continue;
    }
    const prelude = css.slice(pos, delimiter.index).trim();
    const close = matchingBrace(css, delimiter.index);
    if (close === -1) break;
    const body = css.slice(delimiter.index + 1, close);
    pos = close + 1;
    if (prelude === "") continue;

    if (prelude.startsWith("@")) {
      const name = prelude.slice(1).split(/[\s({;]/, 1)[0]?.toLowerCase() ?? "";
      if (RECURSIVE_AT_RULES.has(name)) out += `${prelude} {${transformRules(body, scope)}}`;
      continue;
    }
    // Unsupported nesting: drop the rule rather than emit `.inner` unscoped.
    if (hasNestedBlock(body)) continue;
    const selectors = scopeSelectorList(prelude, scope);
    if (selectors === "") continue;
    out += `${selectors} {${body}}`;
  }
  return out;
}

/**
 * Rewrites Plugin CSS so no selector can match outside the surface identified
 * by `scopeSelector`, a value such as `[data-plugin-ui="plugin-ui-1"]`.
 */
export function scopePluginCss(css: string, scopeSelector: string): string {
  return transformRules(stripComments(css), scopeSelector).trim();
}
