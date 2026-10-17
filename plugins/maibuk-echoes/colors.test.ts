/**
 * Echo colors (#532): the default Okabe-Ito Palette, the stable hash from an
 * Echo's match key to one of its colors, and the contrast gate. The expected
 * values are literals computed outside this module (FNV-1a 32-bit, mod 8), so a
 * change to the hash or the Palette fails here on purpose.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_ECHO_PALETTE,
  ECHO_PALETTE,
  ECHO_PALETTE_IDS,
  ECHO_PALETTES,
  echoColor,
  parseEchoPalette,
} from "./colors";

/** WCAG relative luminance of a `#rrggbb` color. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);
  const [r, g, b] = channels.map((value) =>
    value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two `#rrggbb` colors. */
function contrast(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

/** The editor's own page backgrounds (`--color-background` in light and dark). */
const LIGHT_EDITOR_BACKGROUND = "#fafaf9";
const DARK_EDITOR_BACKGROUND = "#1c1917";

/** Machado et al. (2009) severity-1 CVD matrices, applied to linear sRGB (#532). */
const CVD_MATRICES: Readonly<Record<string, readonly (readonly number[])[]>> = {
  normal: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

/** sRGB channel (0..1) to linear light. */
function linearChannel(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** CIE L*a*b* (D65) of linear sRGB channels already clamped to 0..1. */
function linearToLab(r: number, g: number, b: number): [number, number, number] {
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(Math.max(t, 0)) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/** A `#rrggbb` color as the Lab value each CVD simulation sees it as. */
function simulatedLabs(hex: string): [number, number, number][] {
  const linear = [1, 3, 5].map((index) =>
    linearChannel(parseInt(hex.slice(index, index + 2), 16) / 255)
  );
  return Object.values(CVD_MATRICES).map((matrix) => {
    const [r, g, b] = matrix.map((row) => {
      const value = row.reduce((sum, weight, column) => sum + weight * linear[column], 0);
      return Math.min(Math.max(value, 0), 1);
    });
    return linearToLab(r, g, b);
  });
}

describe("the default Palette", () => {
  it("is Okabe-Ito (adapted): eight colors in the fixed slot order", () => {
    expect(DEFAULT_ECHO_PALETTE).toBe("okabe-ito");
    expect(ECHO_PALETTE).toHaveLength(8);
    expect(ECHO_PALETTE).toEqual([
      "#aa4b18",
      "#a929ff",
      "#2d764a",
      "#b98546",
      "#0096a2",
      "#ff4f14",
      "#b42dad",
      "#737373",
    ]);
  });
});

describe.each(ECHO_PALETTE_IDS)("the %s Palette", (id) => {
  const palette = ECHO_PALETTES[id];

  it("has eight distinct colors", () => {
    expect(palette).toHaveLength(8);
    expect(new Set(palette).size).toBe(8);
  });

  it("keeps every pair at least dE 15 apart under normal, protan, deutan, and tritan vision", () => {
    // CIE76 distance in Lab D65 between each pair, under each simulation. The
    // smallest distance across all pairs and simulations must reach 15.
    let worst = Number.POSITIVE_INFINITY;
    let worstPair = "";
    for (let i = 0; i < palette.length; i++) {
      for (let j = i + 1; j < palette.length; j++) {
        const a = simulatedLabs(palette[i]);
        const b = simulatedLabs(palette[j]);
        a.forEach((labA, simulation) => {
          const labB = b[simulation];
          const distance = Math.hypot(labA[0] - labB[0], labA[1] - labB[1], labA[2] - labB[2]);
          if (distance < worst) {
            worst = distance;
            worstPair = `${palette[i]} vs ${palette[j]} (simulation ${simulation})`;
          }
        });
      }
    }
    expect(worst, worstPair).toBeGreaterThanOrEqual(15);
  });

  it("reaches 3:1 contrast for every color against both editor backgrounds", () => {
    for (const color of palette) {
      expect(contrast(color, LIGHT_EDITOR_BACKGROUND), `${color} on light`).toBeGreaterThanOrEqual(
        3
      );
      expect(contrast(color, DARK_EDITOR_BACKGROUND), `${color} on dark`).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("parseEchoPalette()", () => {
  it("keeps a known Palette id", () => {
    for (const id of ECHO_PALETTE_IDS) expect(parseEchoPalette(id)).toBe(id);
  });

  it("falls back to the default for an unknown, missing, or malformed value", () => {
    for (const value of ["neon", "", 3, null, undefined, { id: "vivid" }]) {
      expect(parseEchoPalette(value)).toBe(DEFAULT_ECHO_PALETTE);
    }
  });
});

describe("echoColor()", () => {
  it("maps one match key to a fixed Palette slot", () => {
    expect(echoColor("door")).toBe(ECHO_PALETTE[1]);
    expect(echoColor("just")).toBe(ECHO_PALETTE[7]);
    expect(echoColor("phrase of two")).toBe(ECHO_PALETTE[3]);
    expect(echoColor("beautiful")).toBe(ECHO_PALETTE[4]);
    expect(echoColor("the quiet house")).toBe(ECHO_PALETTE[0]);
  });

  it("gives the same key the same color every time", () => {
    const first = echoColor("door");
    for (let index = 0; index < 100; index++) expect(echoColor("door")).toBe(first);
  });

  it("always returns a Palette color", () => {
    for (const key of ["a", "tea", "héroe", "x y z", "", "🙂"]) {
      expect(ECHO_PALETTE).toContain(echoColor(key));
    }
  });

  it("maps the same key to the same slot of each Palette", () => {
    for (const id of ECHO_PALETTE_IDS) {
      expect(echoColor("door", id)).toBe(ECHO_PALETTES[id][1]);
      expect(echoColor("the quiet house", id)).toBe(ECHO_PALETTES[id][0]);
    }
  });
});
