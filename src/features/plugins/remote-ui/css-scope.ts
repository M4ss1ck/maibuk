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
 *    to start with the scope selector, recursing into grouping rules. A list
 *    selector is split on its top-level commas only (`splitSelectorList`), so a
 *    comma inside `:is()`, `:not()`, `:where()`, `:has()`, or a quoted string
 *    does not fragment it. jsdom has no such parser, so layer 1 is what its
 *    tests exercise.
 *
 * Anything else the parser cannot safely scope also fails closed: a parse error
 * drops the whole stylesheet, and `@import`, `@keyframes`, `@font-face`,
 * `@page`, `@scope`, an unknown at-rule, CSS nesting, a `&` nesting selector,
 * or a selector led by a combinator (`>`, `+`, `~`) drops the offending rule.
 * When a caller passes `onDrop`, every dropped stylesheet, at-rule, nested
 * rule, and unsafe selector reports a short reason so the host can warn.
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
const RECURSIVE_AT_RULES = new Set(["media", "supports", "container", "layer", "starting-style"]);

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
 * unclosed token is a parse error PostCSS reports by throwing. Returns a short
 * reason, or null when the tokens agree with the browser.
 */
function tokenAgreementProblem(css: string): string | null {
  let tokenizer: Tokenizer;
  try {
    tokenizer = tokenize(new Input(css), { ignoreErrors: false });
  } catch {
    return "unclosed token";
  }
  try {
    while (!tokenizer.endOfFile()) {
      const token = tokenizer.nextToken();
      if (token === undefined) break;
      if (token[0] === "string" && hasUnescapedLineBreak(token[1])) {
        return "unsafe token: string with a line break";
      }
      // With `ignoreErrors: false` an unclosed token throws above; keep the
      // marker check for a tokenizer that returns instead.
      if (token[4] === "unclosed") return "unclosed token";
    }
  } catch {
    return "unclosed token";
  }
  return null;
}

/**
 * Splits a selector list on its top-level commas only. A comma inside a
 * functional pseudo-class (`:is()`, `:not()`, `:where()`, `:has()`), inside an
 * attribute selector (`[...]`), or inside a quoted string is part of one
 * selector, and neither ends it. A backslash escapes the next code point, so an
 * escaped comma (`\,`) is a literal, not a separator.
 */
export function splitSelectorList(selectorText: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < selectorText.length; i += 1) {
    const char = selectorText[i];
    if (quote !== null) {
      current += char;
      if (char === "\\") {
        // Copy the escaped code point verbatim so an escaped quote cannot end
        // the string early.
        if (i + 1 < selectorText.length) {
          current += selectorText[i + 1];
          i += 1;
        }
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "\\") {
      current += char;
      if (i + 1 < selectorText.length) {
        current += selectorText[i + 1];
        i += 1;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === "(" || char === "[") {
      depth += 1;
      current += char;
      continue;
    }
    if (char === ")" || char === "]") {
      if (depth > 0) depth -= 1;
      current += char;
      continue;
    }
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}

/**
 * The structural shape layer 2 walks: a style rule carries `selectorText`, and a
 * grouping rule carries nested `cssRules`. Any array-like or iterable of such
 * objects — a real `CSSRuleList` or a plain test array — satisfies it.
 */
export interface ScopedRuleShape {
  selectorText?: string;
  cssRules?: Iterable<ScopedRuleShape> | ArrayLike<ScopedRuleShape>;
}

/** Every style rule in the list starts with the scope, grouping rules included. */
export function everySelectorScoped(
  rules: Iterable<ScopedRuleShape> | ArrayLike<ScopedRuleShape>,
  scopeSelector: string
): boolean {
  for (const rule of Array.from(rules)) {
    if (typeof rule.selectorText === "string") {
      for (const part of splitSelectorList(rule.selectorText)) {
        if (!part.trim().startsWith(scopeSelector)) return false;
      }
    }
    if (rule.cssRules !== undefined && !everySelectorScoped(rule.cssRules, scopeSelector)) {
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
    // `CSSRuleList` is structurally rule-like (each rule may carry
    // `selectorText` and nested `cssRules`), which is what layer 2 walks.
    return everySelectorScoped(sheet.cssRules as unknown as ScopedRuleShape[], scopeSelector);
  } catch {
    // An at-rule this engine cannot represent, or output it cannot parse:
    // layer 1 already accepted the stylesheet, so leave the result alone.
    return true;
  }
}

/**
 * Rewrites Plugin CSS so no selector can match outside the surface identified
 * by `scopeSelector`, a value such as `[data-plugin-ui="plugin-ui-1"]`. Returns
 * an empty string when the stylesheet cannot be scoped. The optional `onDrop`
 * receives a short developer-facing English reason once per dropped stylesheet,
 * at-rule, nested rule, or unsafe selector.
 */
export function scopePluginCss(
  css: string,
  scopeSelector: string,
  onDrop?: (reason: string) => void
): string {
  const drop = (reason: string): void => {
    onDrop?.(reason);
  };

  const tokenProblem = tokenAgreementProblem(css);
  if (tokenProblem !== null) {
    drop(tokenProblem);
    return "";
  }

  let root: postcss.Root;
  try {
    root = postcss.parse(css, { from: undefined });
  } catch {
    // Ambiguous or malformed CSS: drop the whole stylesheet rather than emit a
    // selector the parser only guessed at.
    drop("stylesheet does not parse");
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
      drop(`@${name} is not allowed`);
      atRule.remove();
    }
  });

  root.walkRules((rule) => {
    if (hasNestedRule(rule)) {
      drop(`nested rule is not scoped: ${rule.selector.trim()}`);
      rule.remove();
      return;
    }
    // Drop the selectors a prefix cannot scope; keep the rest of the list.
    const kept: string[] = [];
    for (const selector of rule.selectors) {
      if (isUnsafeSelector(selector)) {
        drop(`unsafe selector is not scoped: ${selector.trim()}`);
      } else {
        kept.push(selector);
      }
    }
    if (kept.length === 0) {
      rule.remove();
      return;
    }
    rule.selector = kept.map((selector) => `${scopeSelector} ${selector.trim()}`).join(", ");
  });

  const scoped = root.toString().trim();
  if (scoped === "") return "";
  if (!browserConfirmsScoped(scoped, scopeSelector)) {
    drop("layer 2 refused the scoped stylesheet");
    return "";
  }
  return scoped;
}
