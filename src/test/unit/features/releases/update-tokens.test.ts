import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "@/lib/color";

// The New chip sits on the Settings wordmark: its fill must be opaque (no
// glyph shows through) and its text must read at WCAG AA in both themes.
const css = readFileSync(`${process.cwd()}/src/index.css`, "utf8");

function tokensIn(block: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const match of block.matchAll(/--color-(update-[\w-]+):\s*([^;]+);/g)) {
    tokens[match[1]] = match[2].trim();
  }
  return tokens;
}

const darkStart = css.indexOf(".dark {");
const themes = {
  light: tokensIn(css.slice(0, darkStart)),
  dark: tokensIn(css.slice(darkStart)),
};

describe.each(Object.entries(themes))("update tokens, %s theme", (_theme, tokens) => {
  it("are opaque hex colors", () => {
    for (const name of ["update-bg", "update-text", "update-border"]) {
      expect(tokens[name], name).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("give the New chip text at least 4.5:1 against its fill", () => {
    expect(contrastRatio(tokens["update-text"], tokens["update-bg"])).toBeGreaterThanOrEqual(4.5);
  });
});
