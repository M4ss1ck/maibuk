// @vitest-environment node
//
// Plugin CSS scoping (#439): a Plugin's stylesheet reaches its own host-rendered
// surface and nothing else. The scoper prefixes every selector with the
// surface's own attribute, recurses into conditional at-rules, and drops
// anything that cannot be scoped safely (imports, keyframes, page rules, and
// nested rule syntax), so a Plugin can never style Maibuk chrome or another
// Plugin.

import { describe, expect, it } from "vitest";
import { scopePluginCss } from "@/features/plugins/remote-ui/css-scope";

const SCOPE = '[data-plugin-ui="plugin-ui-1"]';

describe("scopePluginCss", () => {
  it("prefixes a plain rule with the surface scope", () => {
    expect(scopePluginCss(".card { color: red; }", SCOPE)).toBe(`${SCOPE} .card { color: red; }`);
  });

  it("prefixes every selector in a selector list", () => {
    expect(scopePluginCss("h1, h2 { margin: 0 }", SCOPE)).toBe(
      `${SCOPE} h1, ${SCOPE} h2 { margin: 0 }`
    );
  });

  it("does not split commas inside :is(), attribute values, or strings", () => {
    expect(scopePluginCss(":is(a, b) { color: red }", SCOPE)).toBe(
      `${SCOPE} :is(a, b) { color: red }`
    );
    expect(scopePluginCss('[data-x="a,b"] { color: red }', SCOPE)).toBe(
      `${SCOPE} [data-x="a,b"] { color: red }`
    );
    expect(scopePluginCss(".a, :is(.b, .c) { color: red }", SCOPE)).toBe(
      `${SCOPE} .a, ${SCOPE} :is(.b, .c) { color: red }`
    );
  });

  it("keeps the declaration block untouched", () => {
    const result = scopePluginCss(".a { color: var(--color-primary); padding: 1rem }", SCOPE);
    expect(result).toContain(".a { color: var(--color-primary); padding: 1rem }");
  });

  it("drops a bare element selector that could only match Maibuk chrome", () => {
    // `body` is not a descendant of the surface, so the prefixed rule matches
    // nothing; it can never restyle the app shell.
    const result = scopePluginCss("body { display: none }", SCOPE);
    expect(result).toBe(`${SCOPE} body { display: none }`);
  });

  it("recurses into media queries and scopes the inner selectors", () => {
    expect(scopePluginCss("@media (min-width: 40rem) { .a { color: red } }", SCOPE)).toBe(
      `@media (min-width: 40rem) {${SCOPE} .a { color: red }}`
    );
  });

  it("recurses into supports and container queries", () => {
    expect(scopePluginCss("@supports (display: grid) { .a { display: grid } }", SCOPE)).toBe(
      `@supports (display: grid) {${SCOPE} .a { display: grid }}`
    );
    expect(scopePluginCss("@container (min-width: 20rem) { .a { color: red } }", SCOPE)).toBe(
      `@container (min-width: 20rem) {${SCOPE} .a { color: red }}`
    );
  });

  it("drops @import so a stylesheet cannot pull in a network or host resource", () => {
    expect(scopePluginCss('@import url("https://example.com/x.css"); .a { color: red }', SCOPE)).toBe(
      `${SCOPE} .a { color: red }`
    );
  });

  it("drops @keyframes so an animation name stays global and untouched", () => {
    expect(scopePluginCss("@keyframes spin { from { opacity: 0 } } .a { color: red }", SCOPE)).toBe(
      `${SCOPE} .a { color: red }`
    );
  });

  it("drops @font-face and @page", () => {
    expect(scopePluginCss("@font-face { font-family: x } .a { color: red }", SCOPE)).toBe(
      `${SCOPE} .a { color: red }`
    );
    expect(scopePluginCss("@page { margin: 0 } .a { color: red }", SCOPE)).toBe(
      `${SCOPE} .a { color: red }`
    );
  });

  it("drops a rule that uses unsupported nesting, so its inner selectors cannot escape", () => {
    // Nested selectors cannot be prefixed by a flat rewrite; dropping the rule
    // fails closed instead of leaking `.inner` into the document.
    const result = scopePluginCss(".outer { .inner { color: red } }", SCOPE);
    expect(result).not.toContain(".inner");
  });

  it("strips comments", () => {
    expect(scopePluginCss("/* a comment */ .a { color: red }", SCOPE)).toBe(
      `${SCOPE} .a { color: red }`
    );
  });

  it("keeps braces inside strings untouched", () => {
    expect(scopePluginCss('.a { content: "}" }', SCOPE)).toBe(`${SCOPE} .a { content: "}" }`);
  });

  it("returns an empty string for a stylesheet it cannot scope", () => {
    expect(scopePluginCss("", SCOPE)).toBe("");
    expect(scopePluginCss("   ", SCOPE)).toBe("");
  });

  it("scopes two surfaces to their own attribute, so neither reaches the other", () => {
    const one = scopePluginCss(".a { color: red }", '[data-plugin-ui="plugin-ui-1"]');
    const two = scopePluginCss(".a { color: rebeccapurple }", '[data-plugin-ui="plugin-ui-2"]');
    expect(one).toContain('[data-plugin-ui="plugin-ui-1"] .a');
    expect(two).toContain('[data-plugin-ui="plugin-ui-2"] .a');
    expect(two).not.toContain("plugin-ui-1");
    expect(one).not.toContain("plugin-ui-2");
  });
});
