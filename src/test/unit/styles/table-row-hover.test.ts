import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// A hovered table row was filled with --color-table-border, the color of the
// cell borders, so every border inside the row disappeared on hover.
const css = readFileSync(join(process.cwd(), "src/index.css"), "utf8");

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  return match?.[1] ?? "";
}

describe("table row hover", () => {
  const hover = ruleBody(".editor-content table tr:hover td");
  const background = hover.match(/background-color:\s*([^;]+);/)?.[1].trim();

  it("highlights the hovered row", () => {
    expect(background).toBeTruthy();
  });

  it("keeps the cell borders visible by never filling with the border color itself", () => {
    expect(background).not.toBe("var(--color-table-border)");
  });

  it("derives the fill from a theme token at partial strength, so every theme keeps the contrast", () => {
    expect(background).toMatch(
      /^color-mix\(in srgb, var\(--color-[a-z-]+\) \d{1,2}%, transparent\)$/
    );
  });
});
