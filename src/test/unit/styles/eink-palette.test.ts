import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Issue #901: E-ink Mode keeps the semantic tokens but pins them to a
// three-value black/white/gray palette. Unit 1 puts class "eink" on <html>
// beside "dark", so every `.dark ...` override needs an identical `.eink`
// counterpart; equal specificity alone does not reach rules the selector text
// never matches.
const source = readFileSync(join(process.cwd(), "src/index.css"), "utf8");

interface Rule {
  selectors: string[];
  body: string;
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function normalize(selector: string): string {
  return selector.replace(/\s+/g, " ").trim();
}

/** Split a selector list on top-level commas, keeping :is(...) intact. */
function splitSelectors(prelude: string): string[] {
  const selectors: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < prelude.length; i += 1) {
    const ch = prelude[i];
    if (ch === "(" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "]") depth -= 1;
    else if (ch === "," && depth === 0) {
      selectors.push(normalize(prelude.slice(start, i)));
      start = i + 1;
    }
  }
  selectors.push(normalize(prelude.slice(start)));
  return selectors.filter(Boolean);
}

/** Every style rule in the sheet, recursing into @layer/@supports/@media. */
function parseRules(css: string): Rule[] {
  const rules: Rule[] = [];
  const walk = (from: number, to: number) => {
    let index = from;
    let preludeStart = from;
    while (index < to) {
      if (css[index] !== "{") {
        index += 1;
        continue;
      }
      const prelude = css.slice(preludeStart, index).trim();
      let depth = 1;
      let close = index + 1;
      while (close < to && depth > 0) {
        if (css[close] === "{") depth += 1;
        else if (css[close] === "}") depth -= 1;
        close += 1;
      }
      const bodyStart = index + 1;
      const bodyEnd = close - 1;
      if (prelude.startsWith("@")) {
        walk(bodyStart, bodyEnd);
      } else if (prelude) {
        rules.push({ selectors: splitSelectors(prelude), body: css.slice(bodyStart, bodyEnd) });
      }
      index = close;
      preludeStart = close;
    }
  };
  walk(0, css.length);
  return rules;
}

/** The body of the first `@name { ... }` block, brace matched. */
function atRuleBody(css: string, atRule: string): string {
  const start = css.indexOf(atRule);
  if (start === -1) return "";
  const open = css.indexOf("{", start);
  let depth = 1;
  let close = open + 1;
  while (close < css.length && depth > 0) {
    if (css[close] === "{") depth += 1;
    else if (css[close] === "}") depth -= 1;
    close += 1;
  }
  return css.slice(open + 1, close - 1);
}

/** `--color-*` custom properties declared in a rule body. */
function colorTokens(body: string): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const declaration of body.split(";")) {
    const colon = declaration.indexOf(":");
    if (colon === -1) continue;
    const name = declaration.slice(0, colon).trim();
    if (!name.startsWith("--color-")) continue;
    const value = declaration
      .slice(colon + 1)
      .replace(/!important/gi, "")
      .trim()
      .toLowerCase();
    tokens.set(name, value);
  }
  return tokens;
}

const css = stripComments(source);
const rules = parseRules(css);
const themeTokens = [...colorTokens(atRuleBody(css, "@theme")).keys()];

/** Tokens declared by every rule whose selector list contains `selector`. */
function declaredTokens(selector: string): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const rule of rules) {
    if (!rule.selectors.includes(selector)) continue;
    for (const [name, value] of colorTokens(rule.body)) tokens.set(name, value);
  }
  return tokens;
}

const ALLOWED: Record<".eink" | ".eink.dark", readonly string[]> = {
  ".eink": ["#000", "#fff", "#595959"],
  ".eink.dark": ["#fff", "#000", "#a6a6a6"],
};

describe("E-ink palette", () => {
  it("finds the theme tokens it is meant to cover", () => {
    expect(themeTokens.length).toBeGreaterThan(30);
  });

  it("redeclares every theme token under .eink and .eink.dark", () => {
    for (const selector of [".eink", ".eink.dark"] as const) {
      const declared = declaredTokens(selector);
      const missing = themeTokens.filter((token) => !declared.has(token));
      expect({ selector, missing }).toEqual({ selector, missing: [] });
    }
  });

  it("uses only the three-value palette for each polarity", () => {
    for (const selector of [".eink", ".eink.dark"] as const) {
      const declared = declaredTokens(selector);
      const bad = themeTokens
        .map((token) => [token, declared.get(token)] as const)
        .filter(([, value]) => value !== undefined && !ALLOWED[selector].includes(value));
      expect({ selector, bad }).toEqual({ selector, bad: [] });
    }
  });

  it("gives every dark-mode selector an e-ink counterpart", () => {
    const allSelectors = new Set(rules.flatMap((rule) => rule.selectors));
    const missing = new Set<string>();
    for (const rule of rules) {
      for (const selector of rule.selectors) {
        if (!/\.dark\b/.test(selector)) continue;
        // `.eink.dark` is itself a `.dark` selector; the e-ink rules are the
        // counterparts being checked, not dark sources to mirror.
        if (/\.eink\b/.test(selector)) continue;
        const counterpart = normalize(selector.replace(/\.dark\b/g, ".eink"));
        if (!allSelectors.has(counterpart)) missing.add(counterpart);
      }
    }
    expect([...missing]).toEqual([]);
  });
});
