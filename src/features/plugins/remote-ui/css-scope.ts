/**
 * Plugin CSS scoping (#439): a Plugin stylesheet is rewritten so every rule it
 * can express reaches the Plugin's own host-rendered surface and nothing else.
 *
 * A scoped stylesheet never relies on the browser: each selector is prefixed
 * with the surface's own `[data-plugin-ui="…"]` attribute, so a rule can only
 * match a descendant of that surface. Two Plugins get two attribute values, and
 * Maibuk chrome carries neither, so Plugin CSS cannot restyle the app or
 * another Plugin.
 *
 * The rewrite uses a real CSS parser (PostCSS) instead of a hand-rolled
 * scanner. A scanner that does not tokenize per CSS Syntax Level 3 misreads
 * `url(}` ) as a block terminator and lets the rest of the stylesheet escape
 * (issue #439); PostCSS tokenizes `url()`, strings, comments, and escapes, so
 * declaration blocks and selector lists are what the browser sees. Anything
 * the parser cannot represent — a parse error, CSS nesting, a selector that
 * starts with a combinator, `@scope`, or an unknown at-rule — fails closed:
 * the whole stylesheet is dropped, or the offending rule is.
 *
 * `:root`, `html`, and `body` are kept but inert: prefixed under the surface
 * they can never match (the surface cannot be their descendant), and keeping
 * them is safer than guessing at a Plugin's intent. `:has()` is kept because
 * scoping makes it a descendant query like any other.
 */

import postcss from "postcss";
import type { Rule } from "postcss";

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

/**
 * Rewrites Plugin CSS so no selector can match outside the surface identified
 * by `scopeSelector`, a value such as `[data-plugin-ui="plugin-ui-1"]`. Returns
 * an empty string when the stylesheet cannot be scoped.
 */
export function scopePluginCss(css: string, scopeSelector: string): string {
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

  return root.toString().trim();
}
