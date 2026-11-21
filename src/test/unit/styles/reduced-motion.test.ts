import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Issue #900: reduced motion is one root attribute (src/lib/motion.ts) rather
// than a CSS media query, so the stylesheet must key off data-motion="reduce".
const css = readFileSync(join(process.cwd(), "src/index.css"), "utf8");

/** The declarations of the first rule whose selector line contains `selector`. */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`(?:^|\\n)[ \\t]*${escaped}[^{}]*\\{([^}]*)\\}`));
  return match?.[1] ?? "";
}

describe("reduced motion reset", () => {
  it("no longer reads the media query", () => {
    expect(css).not.toContain("prefers-reduced-motion");
  });

  it("stops animation, transition and smooth scrolling under the root attribute", () => {
    const body = ruleBody('[data-motion="reduce"] *');
    expect(body).toMatch(/animation-duration:\s*0\.01ms\s*!important;/);
    expect(body).toMatch(/transition-duration:\s*0\.01ms\s*!important;/);
    expect(body).toMatch(/scroll-behavior:\s*auto\s*!important;/);
  });

  it("leaves the indeterminate progress bar a still band", () => {
    const body = ruleBody('[data-motion="reduce"] .progress-update:indeterminate');
    expect(body).toMatch(/animation:\s*none;/);
  });

  it("redefines the motion variants on data-motion rather than the media query", () => {
    expect(css).toMatch(
      /@custom-variant\s+motion-reduce\s*\(&:where\(\[data-motion="reduce"\],\s*\[data-motion="reduce"\]\s*\*\)\)/
    );
    expect(css).toMatch(
      /@custom-variant\s+motion-safe\s*\(&:where\(:not\(\[data-motion="reduce"\],\s*\[data-motion="reduce"\]\s*\*\)\)\)/
    );
  });
});
