/**
 * The Reader Frame's design tokens (#943 unit 1), held to the spec sheet one
 * value at a time: the chrome tokens and their host sources, the four Reading
 * Themes, the Highlight fills and E-ink underlines, the type scale, radii, the
 * 4 px spacing grid, scrims, motion, and the layer order. The rules are read
 * from the stylesheet as text because the contract is the token surface other
 * Reader screens consume, not this unit's implementation.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "..", "assets", "ui", "tokens.css"), "utf8");
const html = readFileSync(join(__dirname, "..", "assets", "ui", "reader.html"), "utf8");

interface Rule {
  selectors: string[];
  body: string;
}

const rules: Rule[] = [];
for (const match of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const selectors = match[1]
    .split(",")
    .map((selector) => selector.trim())
    .filter((selector) => selector !== "");
  rules.push({ selectors, body: match[2] });
}

function rule(selector: string): string {
  const found = rules.find((candidate) => candidate.selectors.includes(selector));
  if (!found) throw new Error(`tokens.css has no rule for ${selector}`);
  return found.body;
}

function token(selector: string, name: string): string {
  for (const candidate of rules) {
    if (!candidate.selectors.includes(selector)) continue;
    const match = candidate.body.match(new RegExp(`${name}\\s*:\\s*([^;]+);`));
    if (match) return match[1].replace(/\s+/g, " ").trim();
  }
  throw new Error(`tokens.css does not define ${name} in ${selector}`);
}

function declaredTokens(selector: string): string[] {
  return rules
    .filter((candidate) => candidate.selectors.includes(selector))
    .flatMap((candidate) =>
      [...candidate.body.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1])
    );
}

describe("chrome tokens", () => {
  it("maps the Reader chrome names from the host's public Frame tokens", () => {
    expect(token(":root", "--bg")).toBe("var(--maibuk-color-background)");
    expect(token(":root", "--fg")).toBe("var(--maibuk-color-foreground)");
    expect(token(":root", "--card")).toBe("var(--maibuk-color-card)");
    expect(token(":root", "--muted")).toBe("var(--maibuk-color-muted)");
    expect(token(":root", "--mfg")).toBe("var(--maibuk-color-muted-foreground)");
    expect(token(":root", "--border")).toBe("var(--maibuk-color-border)");
    expect(token(":root", "--primary")).toBe("var(--maibuk-color-primary)");
    expect(token(":root", "--pfg")).toBe("var(--maibuk-color-primary-foreground)");
    expect(token(":root", "--danger")).toBe("var(--maibuk-color-error-text)");
  });

  it("lets a Reading Theme override the chrome colors", () => {
    expect(token(":root", "--chrome-bg")).toBe(
      "var(--reading-page, var(--maibuk-color-background))"
    );
    expect(token(":root", "--chrome-fg")).toBe(
      "var(--reading-ink, var(--maibuk-color-foreground))"
    );
    expect(token(":root", "--chrome-meta")).toBe(
      "var(--reading-meta, var(--maibuk-color-muted-foreground))"
    );
    expect(token(":root", "--chrome-border")).toBe(
      "var(--reading-border, var(--maibuk-color-border))"
    );
  });

  it("gives the PDF page its own surface token", () => {
    expect(token(":root", "--pdf-page")).toBe("#ffffff");
  });
});

describe("Reading Themes", () => {
  const themes = [
    {
      name: "light",
      page: "#fbfaf8",
      ink: "#1c1917",
      meta: "#78716c",
      border: "rgba(28, 25, 23, 0.14)",
    },
    {
      name: "sepia",
      page: "#f4ecd8",
      ink: "#3b2f20",
      meta: "#76623f",
      border: "rgba(59, 47, 32, 0.14)",
    },
    {
      name: "dark",
      page: "#1c1917",
      ink: "#e7e5e4",
      meta: "#a8a29e",
      border: "rgba(231, 229, 228, 0.14)",
    },
    {
      name: "black",
      page: "#000000",
      ink: "#d6d3d1",
      meta: "#8f8a85",
      border: "rgba(214, 211, 209, 0.14)",
    },
  ];

  it.each(themes)("defines $name as page, ink, meta, and ink at 14%", (theme) => {
    const selector = `:root[data-reading-theme="${theme.name}"]`;
    expect(token(selector, "--reading-page")).toBe(theme.page);
    expect(token(selector, "--reading-ink")).toBe(theme.ink);
    expect(token(selector, "--reading-meta")).toBe(theme.meta);
    expect(token(selector, "--reading-border")).toBe(theme.border);
  });
});

describe("Highlights", () => {
  it("keeps the five stored fills, whatever the theme", () => {
    expect(token(":root", "--highlight-yellow")).toBe("rgba(250, 204, 21, 0.42)");
    expect(token(":root", "--highlight-green")).toBe("rgba(74, 222, 128, 0.36)");
    expect(token(":root", "--highlight-blue")).toBe("rgba(96, 165, 250, 0.36)");
    expect(token(":root", "--highlight-pink")).toBe("rgba(244, 114, 182, 0.34)");
    expect(token(":root", "--highlight-purple")).toBe("rgba(167, 139, 250, 0.38)");
  });

  it("keeps the five Highlights apart on an E-ink panel by underline style", () => {
    expect(token(":root", "--highlight-underline-yellow")).toBe("2px solid");
    expect(token(":root", "--highlight-underline-green")).toBe("2px dashed");
    expect(token(":root", "--highlight-underline-blue")).toBe("2px dotted");
    expect(token(":root", "--highlight-underline-pink")).toBe("3px double");
    expect(token(":root", "--highlight-underline-purple")).toBe("2px wavy");
  });
});

describe("type scale", () => {
  const scale: Array<[string, string]> = [
    ["--type-ui", "Inter, var(--maibuk-font-sans, system-ui, sans-serif)"],
    ["--type-reading", "Literata, var(--maibuk-font-serif, Georgia, serif)"],
    ["--type-code", '"JetBrains Mono", var(--maibuk-font-mono, ui-monospace, monospace)'],
    ["--type-display-size", "28px"],
    ["--type-display-line", "34px"],
    ["--type-display-weight", "600"],
    ["--type-title-size", "20px"],
    ["--type-title-line", "28px"],
    ["--type-title-weight", "600"],
    ["--type-heading-size", "16px"],
    ["--type-heading-line", "24px"],
    ["--type-heading-weight", "600"],
    ["--type-body-size", "14px"],
    ["--type-body-line", "20px"],
    ["--type-body-weight", "400"],
    ["--type-body-strong-weight", "500"],
    ["--type-small-size", "13px"],
    ["--type-small-line", "18px"],
    ["--type-small-weight", "400"],
    ["--type-label-size", "12px"],
    ["--type-label-line", "16px"],
    ["--type-label-weight", "600"],
    ["--type-label-tracking", "0.04em"],
    ["--type-label-transform", "uppercase"],
    ["--type-status-size", "12px"],
    ["--type-status-line", "16px"],
    ["--type-status-weight", "500"],
    ["--type-numeric", "tabular-nums"],
    ["--type-cover-family", "Literata, var(--maibuk-font-serif, Georgia, serif)"],
    ["--type-cover-weight", "600"],
    ["--type-cover-scale", "0.15"],
    ["--type-code-size", "13px"],
    ["--type-code-line", "20px"],
  ];

  it.each(scale)("sets %s", (name, value) => {
    expect(token(":root", name)).toBe(value);
  });
});

describe("radii and spacing", () => {
  it("sizes controls, cards, sheets, and covers", () => {
    expect(token(":root", "--radius-control")).toBe("8px");
    expect(token(":root", "--radius-card")).toBe("12px");
    expect(token(":root", "--radius-sheet")).toBe("16px 16px 0 0");
    expect(token(":root", "--radius-cover")).toBe("4px");
  });

  it("is a 4 px grid", () => {
    for (let step = 1; step <= 12; step += 1) {
      expect(token(":root", `--space-${step}`)).toBe(`${step * 4}px`);
    }
  });
});

describe("scrims", () => {
  it("uses the light scrim by default and the dark scrim in dark", () => {
    expect(token(":root", "--scrim")).toBe("rgba(28, 25, 23, 0.45)");
    expect(token('[data-color-scheme="dark"]', "--scrim")).toBe("rgba(0, 0, 0, 0.6)");
  });
});

describe("motion", () => {
  it("carries the spec sheet's durations, easing, and slide distance", () => {
    expect(token(":root", "--motion-duration-bars")).toBe("160ms");
    expect(token(":root", "--motion-duration-sheet")).toBe("200ms");
    expect(token(":root", "--motion-duration-scrim")).toBe("160ms");
    expect(token(":root", "--motion-duration-page")).toBe("180ms");
    expect(token(":root", "--motion-duration-cover")).toBe("120ms");
    expect(token(":root", "--motion-ease")).toBe("cubic-bezier(0.2, 0.8, 0.2, 1)");
    expect(token(":root", "--motion-bar-distance")).toBe("8px");
    expect(token(":root", "--motion-bars")).toBe(
      "transform var(--motion-duration-bars) var(--motion-ease), opacity var(--motion-duration-bars) var(--motion-ease)"
    );
    expect(token(":root", "--motion-sheet")).toBe(
      "transform var(--motion-duration-sheet) var(--motion-ease)"
    );
    expect(token(":root", "--motion-scrim")).toBe(
      "opacity var(--motion-duration-scrim) var(--motion-ease)"
    );
    expect(token(":root", "--motion-page")).toBe(
      "transform var(--motion-duration-page) var(--motion-ease)"
    );
    expect(token(":root", "--motion-cover")).toBe(
      "opacity var(--motion-duration-cover) var(--motion-ease)"
    );
  });

  it("stops every animation in E-ink Mode or when motion is reduced", () => {
    for (const selector of ['[data-eink="true"]', '[data-motion="reduce"]']) {
      for (const name of declaredTokens(":root").filter((name) =>
        name.startsWith("--motion-duration-")
      )) {
        expect(token(selector, name)).toBe("0ms");
      }
      expect(token(selector, "--motion-bar-distance")).toBe("0px");
      expect(token(selector, "--motion-bars")).toBe("none");
      expect(token(selector, "--motion-sheet")).toBe("none");
      expect(token(selector, "--motion-scrim")).toBe("none");
      expect(token(selector, "--motion-page")).toBe("none");
      expect(token(selector, "--motion-cover")).toBe("none");
      expect(token(selector, "--shadow-stage")).toBe("none");
      expect(token(selector, "--shadow-page")).toBe("none");
    }
  });

  it("draws borders in full ink in E-ink Mode and under reduced motion", () => {
    for (const selector of ['[data-eink="true"]', '[data-motion="reduce"]']) {
      expect(token(selector, "--border")).toBe("var(--fg)");
      expect(token(selector, "--chrome-border")).toBe("var(--chrome-fg)");
      expect(token(selector, "--reading-border")).toBe(
        "var(--reading-ink, var(--maibuk-color-foreground))"
      );
    }
  });
});

describe("layers", () => {
  it("orders the z-index tokens from page to import progress", () => {
    const layers = [...rule(":root").matchAll(/(--z-[a-z-]+)\s*:\s*(\d+);/g)].map(
      (match) => match[1]
    );
    expect(layers).toEqual([
      "--z-page",
      "--z-status",
      "--z-bars",
      "--z-panel",
      "--z-popover",
      "--z-dialog",
      "--z-import",
    ]);
  });
});

describe("Cover", () => {
  const tones: Array<[number, string, string]> = [
    [1, "#2f4a3a", "#efe9dc"],
    [2, "#7a2e2a", "#f6e7d8"],
    [3, "#1f3a5f", "#e8eef6"],
    [4, "#4a3b5c", "#efe8f4"],
    [5, "#8a5a1f", "#fbf1e1"],
    [6, "#3d3a36", "#ece7df"],
    [7, "#e8dcc4", "#3b2f20"],
    [8, "#cfd8cc", "#1f2e24"],
  ];

  it.each(tones)("defines tone %i as its surface and ink pair", (index, background, ink) => {
    expect(token(":root", `--cover-tone-${index}-bg`)).toBe(background);
    expect(token(":root", `--cover-tone-${index}-ink`)).toBe(ink);
  });

  it("draws the pending cover on the muted surface with a dashed border color", () => {
    expect(token(":root", "--cover-pending-bg")).toBe("#e7e5e4");
    expect(token(":root", "--cover-pending-ink")).toBe("#57534e");
    expect(token(":root", "--cover-pending-border")).toBe("#a8a29e");
  });

  it("carries the spine shade and the artboard's exact two-part shadow", () => {
    expect(token(":root", "--cover-spine")).toBe(
      "linear-gradient(90deg, rgba(0, 0, 0, 0.18) 0, rgba(0, 0, 0, 0) 6%)"
    );
    expect(token(":root", "--cover-shadow")).toBe(
      "0 1px 2px rgba(28, 25, 23, 0.18), 0 4px 12px rgba(28, 25, 23, 0.1)"
    );
  });

  it("drops the shade and shadow and draws the pending border in full ink", () => {
    for (const selector of ['[data-eink="true"]', '[data-motion="reduce"]']) {
      expect(token(selector, "--cover-shadow")).toBe("none");
      expect(token(selector, "--cover-spine")).toBe("none");
      expect(token(selector, "--cover-pending-border")).toBe(
        "var(--reading-ink, var(--maibuk-color-foreground))"
      );
    }
  });
});

describe("reader.html", () => {
  it("links tokens.css before the Frame's existing inline styles", () => {
    const link = html.indexOf('<link rel="stylesheet" href="tokens.css"');
    const style = html.indexOf("<style>");
    expect(link).toBeGreaterThan(-1);
    expect(style).toBeGreaterThan(-1);
    expect(link).toBeLessThan(style);
  });
});
