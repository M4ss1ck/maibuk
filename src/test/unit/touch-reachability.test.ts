import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Touch screens have no hover. Tailwind 4 only applies `hover:` and
// `group-hover:` under `(hover: hover)`, so a control hidden until hover never
// appears on Android: notes once had no way to be deleted there. A class
// string that hides something and reveals it on hover must also say what
// happens on a coarse pointer (a `pointer-coarse:` class), or be listed below
// with the touch path that replaces it.

const SRC = join(process.cwd(), "src");

const HIDDEN = /(?:^|\s)(?:opacity-0|invisible|pointer-events-none|hidden)(?=\s|$)/;
const REVEALED_ON_HOVER =
  /(?:^|\s)(?:group-)?hover:(?:opacity-100|visible|pointer-events-auto|flex|block|inline-flex)(?=\s|$)/;
const TOUCH_FALLBACK = /(?:^|\s)pointer-coarse:/;

interface Exemption {
  file: string;
  snippet: string;
  touchPath: string;
}

const EXEMPTIONS: Exemption[] = [
  {
    file: "features/canvas/nodes/LightweightNode.tsx",
    snippet: '"opacity-0 group-hover:opacity-100"',
    touchPath: "Resize lines show on the selected node; a tap selects it.",
  },
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === "test" ? [] : sourceFiles(path);
    return entry.endsWith(".tsx") ? [path] : [];
  });
}

function classStrings(source: string): string[] {
  const quoted = [...source.matchAll(/"([^"\n]*)"/g)].map((match) => match[1]);
  const templates = [...source.matchAll(/`([^`]*)`/g)].map((match) => match[1]);
  return [...quoted, ...templates];
}

function isHoverOnlyReveal(classes: string): boolean {
  return HIDDEN.test(classes) && REVEALED_ON_HOVER.test(classes) && !TOUCH_FALLBACK.test(classes);
}

describe("touch reachability", () => {
  it("recognizes a hover-only reveal and accepts one with a touch fallback", () => {
    expect(isHoverOnlyReveal("rounded opacity-0 group-hover:opacity-100")).toBe(true);
    expect(isHoverOnlyReveal("pointer-events-none group-hover:pointer-events-auto")).toBe(true);
    expect(isHoverOnlyReveal("invisible group-hover:visible")).toBe(true);
    expect(isHoverOnlyReveal("opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100")).toBe(
      false
    );
    expect(isHoverOnlyReveal("opacity-0 hover:opacity-100 pointer-coarse:hidden")).toBe(false);
    expect(isHoverOnlyReveal("hover:bg-muted opacity-50")).toBe(false);
    expect(isHoverOnlyReveal("h-3 opacity-0")).toBe(false);
  });

  it("never hides a control until hover without a touch path", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const name = relative(SRC, file);
      const source = readFileSync(file, "utf8");
      for (const classes of classStrings(source)) {
        if (!isHoverOnlyReveal(classes)) continue;
        const exempt = EXEMPTIONS.some(
          (exemption) => exemption.file === name && exemption.snippet === `"${classes}"`
        );
        if (!exempt) offenders.push(`${name}: "${classes.trim()}"`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("keeps every exemption pointing at code that still exists", () => {
    for (const exemption of EXEMPTIONS) {
      const source = readFileSync(join(SRC, exemption.file), "utf8");
      expect(source, exemption.file).toContain(exemption.snippet);
      expect(exemption.touchPath).not.toBe("");
    }
  });
});
