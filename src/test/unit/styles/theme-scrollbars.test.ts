import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Issue #671: in the dark theme the browser drew every scrollbar and native
// control light, because nothing told it the page was dark and the themed
// scrollbar was an opt-in class most scroll boxes never took.
const root = process.cwd();
const css = readFileSync(join(root, "src/index.css"), "utf8");

/** The declarations of the first top-level rule whose selector is exactly `selector`. */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  return match?.[1] ?? "";
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "test" ? [] : sourceFiles(path);
    return /\.(tsx?|css)$/.test(entry.name) ? [path] : [];
  });
}

describe("theme color scheme", () => {
  it("tells the browser the page is light by default", () => {
    expect(ruleBody(":root")).toMatch(/color-scheme:\s*light;/);
  });

  it("tells the browser the page is dark under .dark", () => {
    expect(ruleBody(".dark")).toMatch(/color-scheme:\s*dark;/);
  });

  it("lets .dark win over :root, which has the same specificity", () => {
    expect(css.search(/\n:root\s*\{[^}]*color-scheme/)).toBeLessThan(css.search(/\n\.dark\s*\{/));
  });
});

describe("themed scrollbars", () => {
  it("style every scroll container in WebKit and Chromium, corner included", () => {
    for (const part of ["", "-track", "-thumb", "-corner"]) {
      expect(css, `::-webkit-scrollbar${part}`).toMatch(
        new RegExp(`\\n\\s*::-webkit-scrollbar${part}\\s*\\{`),
      );
    }
  });

  it("give Firefox the standard properties only where ::-webkit-scrollbar is unsupported", () => {
    const gated = css.match(/@supports not selector\(::-webkit-scrollbar\)\s*\{\s*\*\s*\{([^}]*)\}/);
    expect(gated?.[1]).toMatch(/scrollbar-width:\s*thin;/);
    expect(gated?.[1]).toMatch(/scrollbar-color:/);
  });

  it("are global, so no scroll box opts in through a class", () => {
    const optIns = sourceFiles(join(root, "src")).filter((file) =>
      readFileSync(file, "utf8").includes("scrollbar-themed"),
    );
    expect(optIns).toEqual([]);
  });
});
