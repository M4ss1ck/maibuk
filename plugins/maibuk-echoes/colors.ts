/**
 * Echo colors (#532): the default Palette and the stable mapping from an Echo's
 * match key to one of its colors. The Palette lives in the Plugin, so the host
 * never sees a Palette name, only the `#rrggbb` each range carries.
 *
 * The default Palette is "Okabe-Ito (adapted)": it is Okabe-Ito adapted so every
 * color reaches 3:1 on both editor backgrounds (`--color-background`, light and
 * dark) and stays distinct under color vision deficiency simulation. The colors
 * were optimized for worst-case distance under normal, protan, deutan, and tritan
 * vision (Machado et al. 2009, severity 1); the gate test in `colors.test.ts`
 * keeps every pair at least dE 15 apart under each of them. The teal is `#0096a2`
 * rather than `#00a3a3`: the lighter teal sat at 2.97:1 on the light background,
 * and darkening it along its lightness broke the dE gate, so the hue moved instead.
 *
 * The mapping is FNV-1a (32-bit) over the key's UTF-8 bytes, mod the Palette
 * size. It is a pure function, so an Echo keeps its color across Chapters,
 * sessions, and recomputes, and two Echoes may share a color.
 *
 * Imports nothing.
 */

/** The Palettes the author can pick from (#533), by stable id. */
export const ECHO_PALETTE_IDS = ["okabe-ito", "vivid", "soft"] as const;

export type EchoPaletteId = (typeof ECHO_PALETTE_IDS)[number];

/** The Palette a Library starts with: colorblind-safe Okabe-Ito (#532). */
export const DEFAULT_ECHO_PALETTE: EchoPaletteId = "okabe-ito";

/**
 * Every Palette's eight colors, in fixed slot order. Each color reaches 3:1 on
 * both editor backgrounds, and every pair stays at least dE 15 apart under
 * normal, protan, deutan, and tritan vision (`colors.test.ts` gates both).
 *
 * - okabe-ito: "Okabe-Ito (adapted)" (#532), the colorblind-safe default.
 * - vivid: Tableau 10 without its grey (#533). Tableau's yellow is dropped (it
 *   cannot reach 3:1 on the light background) and the other hues are moved
 *   within 25 degrees to the nearest colors that pass.
 * - soft: muted hues, HLS saturation 0.15 to 0.45, for long sessions (#533).
 *
 * Vivid and Soft were found by a worst-case dE search over the 3:1 band (the
 * same objective the gate tests check); no color was tuned by eye.
 */
export const ECHO_PALETTES: Readonly<Record<EchoPaletteId, readonly string[]>> = {
  "okabe-ito": [
    "#aa4b18",
    "#a929ff",
    "#2d764a",
    "#b98546",
    "#0096a2",
    "#ff4f14",
    "#b42dad",
    "#737373",
  ],
  vivid: ["#3d51ff", "#ff470a", "#ea5c63", "#0072a3", "#0aa411", "#c969d3", "#d36993", "#9e552e"],
  soft: ["#6360c3", "#54979c", "#5d6e35", "#759749", "#7a5e8d", "#c37974", "#a37ece", "#8a5c6a"],
};

/** The default Palette's colors, kept under their 0.2.0 name (#532). */
export const ECHO_PALETTE: readonly string[] = ECHO_PALETTES[DEFAULT_ECHO_PALETTE];

/** The stored id as a Palette id, or the default for anything unknown or malformed (#533). */
export function parseEchoPalette(value: unknown): EchoPaletteId {
  return typeof value === "string" && (ECHO_PALETTE_IDS as readonly string[]).includes(value)
    ? (value as EchoPaletteId)
    : DEFAULT_ECHO_PALETTE;
}

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** FNV-1a, 32-bit, over the UTF-8 bytes of `text`. */
function fnv1a(text: string): number {
  const bytes = new TextEncoder().encode(text);
  let hash = FNV_OFFSET;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

/** The color an Echo with this match key is painted in, from the chosen Palette. */
export function echoColor(
  matchKey: string,
  palette: EchoPaletteId = DEFAULT_ECHO_PALETTE
): string {
  const colors = ECHO_PALETTES[palette];
  return colors[fnv1a(matchKey) % colors.length];
}
