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

/** The default Palette: "Okabe-Ito (adapted)", in its fixed slot order (#532). */
export const ECHO_PALETTE: readonly string[] = [
  "#aa4b18",
  "#a929ff",
  "#2d764a",
  "#b98546",
  "#0096a2",
  "#ff4f14",
  "#b42dad",
  "#737373",
];

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

/** The Palette color an Echo with this match key is painted in. */
export function echoColor(matchKey: string): string {
  return ECHO_PALETTE[fnv1a(matchKey) % ECHO_PALETTE.length];
}
