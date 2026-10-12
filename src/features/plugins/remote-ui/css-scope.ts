/**
 * Plugin CSS scoping (#439, #484): a Plugin stylesheet is rewritten so every
 * rule it can express reaches the Plugin's own host-rendered surface and
 * nothing else.
 *
 * A scoped stylesheet never relies on the browser: each selector is prefixed
 * with the surface's own `[data-plugin-ui="…"]` attribute, so a rule can only
 * match a descendant of that surface. Two Plugins get two attribute values, and
 * Maibuk chrome carries neither, so Plugin CSS cannot restyle the app or
 * another Plugin.
 *
 * The rewrite uses PostCSS, but PostCSS's tokenizer is not quite the browser's:
 * it accepts a string that spans a raw newline, which the browser ends at the
 * newline (a CSS Syntax Level 3 bad-string), letting the rest of the stylesheet
 * escape unscoped (#484). Two layers guard the output:
 *
 * 1. Before parsing, the stylesheet is tokenized with `postcss/lib/tokenize`;
 *    it is dropped whole if a string token holds an unescaped newline (a
 *    backslash-newline continuation is fine) or the tokenizer reports an
 *    unclosed token.
 * 2. Where a real CSS parser exists (`CSSStyleSheet.replaceSync`), the scoped
 *    output is parsed with it and every style rule's `selectorText` is checked
 *    to start with the scope selector, recursing into grouping rules. jsdom has
 *    no such parser, so layer 1 is what its tests exercise.
 *
 * Anything else the parser cannot safely scope also fails closed: a parse error
 * drops the whole stylesheet, and `@import`, `@keyframes`, `@font-face`,
 * `@page`, `@scope`, an unknown at-rule, CSS nesting, a `&` nesting selector,
 * or a selector led by a combinator (`>`, `+`, `~`) drops the offending rule.
 *
 * `:root`, `html`, and `body` are kept but inert: prefixed under the surface
 * they can never match (the surface cannot be their descendant), and keeping
 * them is safer than guessing at a Plugin's intent. `:has()` is kept because
 * scoping makes it a descendant query like any other.
 */

import postcss from "postcss";
import type { Rule } from "postcss";
import Input from "postcss/lib/input";
import tokenize, { type Tokenizer } from "postcss/lib/tokenize";

/** At-rules whose body holds more rules, which are then scoped in turn. */
const RECURSIVE_AT_RULES = new Set([
  "media",
  "supports",
  "container",
  "layer",
  "starting-style",
]);

/**
 * A selector a flat prefix cannot scope. A leading combinator (`>`, `+`, `~`)
 * with the surface prefix would match siblings of the surface, and a nesting
 * selector (`&`) refers to a parent the surface does not provide.
 */
function isUnsafeSelector(selector: string): boolean {
  const trimmed = selector.trimStart();
  if (trimmed === "") return true;
  const first = trimmed[0];
  if (first === ">" || first === "+" || first === "~") return true;
  return trimmed.includes("&");
}

/** A rule holding a nested rule or at-rule, which a flat rewrite cannot scope. */
function hasNestedRule(rule: Rule): boolean {
  return (rule.nodes ?? []).some((node) => node.type === "rule" || node.type === "atrule");
}

/** True when a string body holds a line break the browser would end it at. */
function hasUnescapedLineBreak(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (char === "\\") {
      // A backslash escapes the next code point; `\` + CRLF is one continuation.
      if (value[i + 1] === "\r" && value[i + 2] === "\n") i += 2;
      else i += 1;
      continue;
    }
    if (char === "\n" || char === "\r" || char === "\f") return true;
  }
  return false;
}

/**
 * Layer 1: tokenize with PostCSS's own tokenizer and refuse a stylesheet whose
 * tokens do not mean what PostCSS's parser takes them to mean. A bad string (a
 * raw newline) passes the parser but ends at the newline in the browser; an
 * unclosed token is a parse error PostCSS reports by throwing.
 */
function tokensAgreeWithBrowser(css: string): boolean {
  let tokenizer: Tokenizer;
  try {
    tokenizer = tokenize(new Input(css), { ignoreErrors: false });
  } catch {
    return false;
  }
  try {
    while (!tokenizer.endOfFile()) {
      const token = tokenizer.nextToken();
      if (token === undefined) break;
      if (token[0] === "string" && hasUnescapedLineBreak(token[1])) return false;
      // With `ignoreErrors: false` an unclosed token throws above; keep the
      // marker check for a tokenizer that returns instead.
      if (token[4] === "unclosed") return false;
    }
  } catch {
    return false;
  }
  return true;
}

/** Every style rule in the list starts with the scope, grouping rules included. */
function everySelectorScoped(rules: CSSRuleList, scopeSelector: string): boolean {
  for (const rule of Array.from(rules)) {
    const style = rule as CSSStyleRule;
    if (typeof style.selectorText === "string") {
      for (const part of style.selectorText.split(",")) {
        if (!part.trim().startsWith(scopeSelector)) return false;
      }
    }
    const grouping = rule as CSSGroupingRule;
    if (grouping.cssRules !== undefined && !everySelectorScoped(grouping.cssRules, scopeSelector)) {
      return false;
    }
  }
  return true;
}

/** The engine's CSSStyleSheet constructor, or null where it cannot parse CSS. */
function replaceSyncCapableSheet(): (new () => CSSStyleSheet) | null {
  const ctor = (globalThis as { CSSStyleSheet?: { new (): CSSStyleSheet } }).CSSStyleSheet;
  if (typeof ctor !== "function") return null;
  if (typeof ctor.prototype.replaceSync !== "function") return null;
  return ctor;
}

/**
 * Layer 2: defense in depth, where the engine can parse CSS itself. jsdom has
 * no `replaceSync`, so its tests rest on layer 1.
 */
function browserConfirmsScoped(scoped: string, scopeSelector: string): boolean {
  const Sheet = replaceSyncCapableSheet();
  if (Sheet === null) return true;
  try {
    const sheet = new Sheet();
    sheet.replaceSync(scoped);
    return everySelectorScoped(sheet.cssRules, scopeSelector);
  } catch {
    // An at-rule this engine cannot represent, or output it cannot parse:
    // layer 1 already accepted the stylesheet, so leave the result alone.
    return true;
  }
}

/**
 * Rewrites Plugin CSS so no selector can match outside the surface identified
 * by `scopeSelector`, a value such as `[data-plugin-ui="plugin-ui-1"]`. Returns
 * an empty string when the stylesheet cannot be scoped.
 */
export function scopePluginCss(css: string, scopeSelector: string): string {
  if (!tokensAgreeWithBrowser(css)) return "";

  let root: postcss.Root;
  try {
    root = postcss.parse(css, { from: undefined });
  } catch {
    // Ambiguous or malformed CSS: drop the whole stylesheet rather than emit a
    // selector the parser only guessed at.
    return "";
  }

  root.walkComments((comment) => {
    comment.remove();
  });

  root.walkAtRules((atRule) => {
    const name = atRule.name.toLowerCase();
    if (name === "scope" || !RECURSIVE_AT_RULES.has(name)) {
      // `@scope` carries the Plugin's own scope root, which would override the
      // surface prefix; everything else that is not a conditional wrapper
      // (`@import`, `@keyframes`, `@font-face`, `@page`, `@charset`, …) cannot
      // be scoped by prefixing.
      atRule.remove();
    }
  });

  root.walkRules((rule) => {
    if (hasNestedRule(rule)) {
      rule.remove();
      return;
    }
    // Drop the selectors a prefix cannot scope; keep the rest of the list.
    const kept = rule.selectors.filter((selector) => !isUnsafeSelector(selector));
    if (kept.length === 0) {
      rule.remove();
      return;
    }
    rule.selector = kept.map((selector) => `${scopeSelector} ${selector.trim()}`).join(", ");
  });

  const scoped = root.toString().trim();
  if (scoped === "") return "";
  return browserConfirmsScoped(scoped, scopeSelector) ? scoped : "";
}
