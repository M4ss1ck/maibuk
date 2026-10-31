// @vitest-environment node
//
// Plugin CSS scoping (#439): a Plugin's stylesheet reaches its own host-rendered
// surface and nothing else. The scoper prefixes every selector with the
// surface's own attribute, recurses into conditional at-rules, and drops
// anything that cannot be scoped safely (imports, keyframes, page rules, and
// nested rule syntax), so a Plugin can never style Maibuk chrome or another
// Plugin.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  everySelectorScoped,
  scopePluginCss,
  splitSelectorList,
} from "@/features/plugins/remote-ui/css-scope";

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
      `@media (min-width: 40rem) { ${SCOPE} .a { color: red } }`
    );
  });

  it("recurses into supports and container queries", () => {
    expect(scopePluginCss("@supports (display: grid) { .a { display: grid } }", SCOPE)).toBe(
      `@supports (display: grid) { ${SCOPE} .a { display: grid } }`
    );
    expect(scopePluginCss("@container (min-width: 20rem) { .a { color: red } }", SCOPE)).toBe(
      `@container (min-width: 20rem) { ${SCOPE} .a { color: red } }`
    );
  });

  it("drops @import so a stylesheet cannot pull in a network or host resource", () => {
    expect(
      scopePluginCss('@import url("https://example.com/x.css"); .a { color: red }', SCOPE)
    ).toBe(`${SCOPE} .a { color: red }`);
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

  describe("hostile selectors (#439)", () => {
    // A hand-rolled scanner that does not tokenize `url()` per CSS Syntax Level
    // 3 reads the `}` inside it as the rule's end, so the rest of the
    // stylesheet — here the `body` rule — lands unscoped (#439). The real
    // parser keeps `url(} )` one value and scopes both rules.
    it("does not let a `}` inside url() break out of the declaration block", () => {
      const result = scopePluginCss(".a{b:url(} ) } body{display:none}", SCOPE);
      expect(result).toContain(`${SCOPE} .a`);
      // `body` is itself prefixed, so it can only match a descendant of the
      // surface and can never hide the app shell. Every `body` occurrence is
      // part of a `[scope] body` selector.
      expect(result).toContain(`${SCOPE} body`);
      expect(result.split("body").length).toBe(result.split(`${SCOPE} body`).length);
    });

    it("drops a selector led by a sibling combinator, which the prefix would turn into a Maibuk sibling", () => {
      // `[scope] ~ .x` matches a `.x` preceded by the surface: a sibling of the
      // surface, i.e. Maibuk chrome. Drop it rather than scope it.
      expect(scopePluginCss("~ .x{color:red}", SCOPE)).toBe("");
      expect(scopePluginCss("+ .x{color:red}", SCOPE)).toBe("");
      expect(scopePluginCss("> .x{color:red}", SCOPE)).toBe("");
    });

    it("keeps the safe selectors of a list and drops the combinator-led ones", () => {
      expect(scopePluginCss(".a, ~ .b{color:red}", SCOPE)).toBe(`${SCOPE} .a{color:red}`);
    });

    it("drops @scope, which would override the surface prefix with the Plugin's own root", () => {
      const result = scopePluginCss("@scope (body) { p { color: red } }", SCOPE);
      expect(result).toBe("");
    });

    it("strips an escaped brace in a selector instead of misreading it", () => {
      // `\}` is an escaped code point, not a block terminator; the rule scopes
      // normally and the following rule stays scoped too.
      const result = scopePluginCss(".a\\} { color: red } body { display: none }", SCOPE);
      expect(result).toContain(`${SCOPE} body`);
    });

    it("returns an empty string when the stylesheet does not parse", () => {
      expect(scopePluginCss(".a { color: red", SCOPE)).toBe("");
      expect(scopePluginCss(".a { color: red } } .b { color: blue }", SCOPE)).toBe("");
      expect(scopePluginCss("/* unclosed", SCOPE)).toBe("");
    });

    it("keeps :root, html, and body inert by prefixing them under the surface", () => {
      // None of them can be a descendant of the surface, so the prefixed rule
      // matches nothing; the Plugin cannot restyle the app shell.
      expect(scopePluginCss(":root { color: red }", SCOPE)).toBe(`${SCOPE} :root { color: red }`);
      expect(scopePluginCss("html { color: red }", SCOPE)).toBe(`${SCOPE} html { color: red }`);
      expect(scopePluginCss("body { display: none }", SCOPE)).toBe(
        `${SCOPE} body { display: none }`
      );
    });

    it("scopes :has() as a descendant query", () => {
      expect(scopePluginCss(":has(p) { color: red }", SCOPE)).toBe(
        `${SCOPE} :has(p) { color: red }`
      );
    });

    it("drops a nesting selector, which would refer to a parent the surface never provided", () => {
      expect(scopePluginCss("& .x { color: red }", SCOPE)).toBe("");
      expect(scopePluginCss(".a { & { color: red } }", SCOPE)).toBe("");
    });

    // PostCSS accepts a string that runs across a raw newline, but the browser
    // ends it there (a CSS Syntax Level 3 bad-string), so the rest of the
    // stylesheet — including a `body` rule — would land unscoped. The scoper
    // must not trust PostCSS's tokenizer to match the browser's (#484).
    it("drops a double-quoted bad string that runs across a newline", () => {
      expect(scopePluginCss('.a{b:"x\n} body{display:none} .z{c:"}', SCOPE)).toBe("");
    });

    it("drops a single-quoted bad string that runs across a newline", () => {
      expect(scopePluginCss(".a{b:'x\n} body{display:none} .z{c:'}", SCOPE)).toBe("");
    });

    it("keeps a valid backslash-newline continuation", () => {
      const result = scopePluginCss('.a{b:"x\\\n y"}', SCOPE);
      // The continuation is a single string value, so the rule scopes normally.
      expect(result).toContain(`${SCOPE} .a`);
      expect(result).toContain("\\\n");
    });

    it("keeps a valid backslash-CRLF continuation", () => {
      const result = scopePluginCss('.a{b:"x\\\r\n y"}', SCOPE);
      expect(result).toContain(`${SCOPE} .a`);
    });

    it("drops a carriage return or form feed inside a string", () => {
      expect(scopePluginCss('.a{b:"x\r} body{}', SCOPE)).toBe("");
      expect(scopePluginCss('.a{b:"x\f} body{}', SCOPE)).toBe("");
    });

    it("drops an unclosed string and an unclosed comment", () => {
      expect(scopePluginCss('.a{b:"x}', SCOPE)).toBe("");
      expect(scopePluginCss(".a{b:c/*x", SCOPE)).toBe("");
    });
  });
});

describe("splitSelectorList (#484)", () => {
  it("splits a plain selector list on its top-level commas", () => {
    expect(splitSelectorList("a, b")).toHaveLength(2);
    expect(splitSelectorList("a, b")).toEqual(["a", " b"]);
  });

  it("keeps a comma inside a functional pseudo-class in one selector", () => {
    expect(splitSelectorList(":is(.a, .b) .c")).toHaveLength(1);
  });

  it("splits after a functional pseudo-class but not inside it", () => {
    expect(splitSelectorList(".x:not(.a, .b), .y")).toHaveLength(2);
    expect(splitSelectorList(".x:not(.a, .b), .y")).toEqual([".x:not(.a, .b)", " .y"]);
  });

  it("keeps a comma inside an attribute value in one selector", () => {
    expect(splitSelectorList('[title="a,b"]')).toHaveLength(1);
  });

  it("splits an attribute selector from the next one", () => {
    expect(splitSelectorList("[title='a,b'], p")).toHaveLength(2);
  });

  it("treats an escaped comma as a literal, not a separator", () => {
    expect(splitSelectorList(".a\\,b")).toHaveLength(1);
  });

  it("tracks nested functional pseudo-classes", () => {
    expect(splitSelectorList(":is(:not(.a, .b), .c), d")).toHaveLength(2);
  });

  it("does not let an escaped quote inside a string end the string", () => {
    expect(splitSelectorList('[data-x="\\"",]')).toHaveLength(1);
  });
});

describe("everySelectorScoped (#484)", () => {
  const S = '[data-plugin-ui="s1"]';

  it("passes a list selector whose commas sit inside :is()", () => {
    expect(everySelectorScoped([{ selectorText: `${S} :is(.a, body)` }], S)).toBe(true);
  });

  it("passes every part of a scoped list selector", () => {
    expect(everySelectorScoped([{ selectorText: `${S} .x:not(.a, .b), ${S} .y` }], S)).toBe(true);
  });

  it("recurses into a grouping rule's nested style rules", () => {
    const grouping = { cssRules: [{ selectorText: `${S} p` }] };
    expect(everySelectorScoped([grouping], S)).toBe(true);
  });

  it("fails a selector that cannot be a surface descendant", () => {
    expect(everySelectorScoped([{ selectorText: "body" }], S)).toBe(false);
  });

  it("fails when one part of a list is not scoped", () => {
    expect(everySelectorScoped([{ selectorText: `${S} .a, .b` }], S)).toBe(false);
  });

  it("fails a grouping rule holding an unscoped selector", () => {
    const grouping = { cssRules: [{ selectorText: "body" }] };
    expect(everySelectorScoped([grouping], S)).toBe(false);
  });
});

describe("scopePluginCss layer 2 with a browser-like CSSStyleSheet (#484)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // A stand-in for Chromium's parser: `replaceSync` stores the scoped text and
  // `cssRules` exposes each rule's selector, the way the engine would.
  class SplitStyleSheet {
    cssRules: { selectorText?: string }[] = [];
    replaceSync(text: string): void {
      this.cssRules = text
        .split("}")
        .map((chunk) => chunk.split("{")[0]?.trim() ?? "")
        .filter((selector) => selector !== "")
        .map((selector) => ({ selectorText: selector }));
    }
  }

  it("keeps a :not() list selector instead of dropping the sheet", () => {
    vi.stubGlobal("CSSStyleSheet", SplitStyleSheet);
    const kept = scopePluginCss(".x:not(.a, .b){color:red}", '[data-plugin-ui="s1"]');
    expect(kept).toBe('[data-plugin-ui="s1"] .x:not(.a, .b){color:red}');
  });

  it("keeps an :is() list selector instead of dropping the sheet", () => {
    vi.stubGlobal("CSSStyleSheet", SplitStyleSheet);
    const kept = scopePluginCss(":is(h1, h2){font-weight:600}", '[data-plugin-ui="s1"]');
    expect(kept).toBe('[data-plugin-ui="s1"] :is(h1, h2){font-weight:600}');
  });

  it("returns an empty string when layer 2 reports an unscoped selector", () => {
    vi.stubGlobal(
      "CSSStyleSheet",
      class {
        cssRules = [{ selectorText: "body" }];
        replaceSync(): void {}
      }
    );
    expect(scopePluginCss(".x:not(.a, .b){color:red}", '[data-plugin-ui="s1"]')).toBe("");
  });
});

describe("scopePluginCss onDrop reasons (#484)", () => {
  it("reports a removed at-rule and keeps the safe rule", () => {
    const reasons: string[] = [];
    const out = scopePluginCss("@import url(x); .a{b:c}", SCOPE, (reason) => reasons.push(reason));
    expect(out).toBe(`${SCOPE} .a{b:c}`);
    expect(reasons.some((reason) => reason.includes("@import"))).toBe(true);
  });

  it("reports a dropped unsafe selector", () => {
    const reasons: string[] = [];
    expect(scopePluginCss("~ .x{c:d}", SCOPE, (reason) => reasons.push(reason))).toBe("");
    expect(reasons.some((reason) => reason.includes("~ .x"))).toBe(true);
  });

  it("reports the whole sheet dropped by layer 1", () => {
    const reasons: string[] = [];
    expect(
      scopePluginCss('.a{b:"x\n} body{display:none} .z{c:"}', SCOPE, (reason) =>
        reasons.push(reason)
      )
    ).toBe("");
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain("line break");
  });

  it("reports a removed nested rule", () => {
    const reasons: string[] = [];
    expect(scopePluginCss(".a{.b{c:d}}", SCOPE, (reason) => reasons.push(reason))).toBe("");
    expect(reasons.some((reason) => reason.includes("nested"))).toBe(true);
  });

  it("reports nothing for a rule it scopes cleanly", () => {
    const reasons: string[] = [];
    expect(scopePluginCss(".a{b:c}", SCOPE, (reason) => reasons.push(reason))).toBe(
      `${SCOPE} .a{b:c}`
    );
    expect(reasons).toEqual([]);
  });
});
