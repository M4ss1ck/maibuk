/**
 * The Maps Stamps (#749): the built-in Stamp art, and the scale bar's maths.
 *
 * A Stamp names the art it draws with a ref: `base:<id>` is the built-in set,
 * and a ref this build does not know draws nothing. The art is paths in its own
 * viewBox, which the Element's size scales; a part with no fill of its own takes
 * the Stamp's colour, so one-colour art recolours with the Element. The scale
 * bar has no art: it is drawn from the page's scale, by `scaleBarLayout`.
 *
 * Pure functions and data, with no imports, so the model, the scene, and the
 * Frame's protocol can all read them.
 */

/** One path of a Stamp's art, in the art's own viewBox. */
export interface StampPart {
  /** The SVG path `d`. */
  d: string;
  /** The part's own colour, or null to paint it in the Stamp's colour. */
  fill: string | null;
}

/** The art one built-in Stamp draws. */
export interface StampArt {
  id: string;
  /** The art box: its left, top, width, and height, which the Stamp's size scales. */
  viewBox: [number, number, number, number];
  parts: StampPart[];
}

/** The ref prefix every built-in Stamp art carries. */
const BASE_REF_PREFIX = "base:";

/** The scale bar Stamp's ref: its picture comes from the page's scale, not from a path. */
export const SCALE_BAR_STAMP_REF = `${BASE_REF_PREFIX}scale-bar`;

/** A map pin: a round head on a point, drawn in one colour. */
const MARKER: StampArt = {
  id: "marker",
  viewBox: [0, 0, 10, 14],
  parts: [
    {
      d: "M 5 0 C 2.24 0 0 2.6 0 5.4 C 0 9.4 5 14 5 14 C 5 14 10 9.4 10 5.4 C 10 2.6 7.76 0 5 0 Z",
      fill: null,
    },
  ],
};

/** The scale bar: the scene draws it from `scaleBarLayout`, so it carries no art. */
const SCALE_BAR: StampArt = { id: "scale-bar", viewBox: [0, 0, 100, 20], parts: [] };

/** The built-in Stamps, in the order the art set lists them. */
const ARTS: readonly StampArt[] = [MARKER, SCALE_BAR];

/** The ids of the built-in Stamps, in the order the art set lists them. */
export const BASE_STAMP_IDS: readonly string[] = ARTS.map((art) => art.id);

/** The art `ref` names, or undefined for a ref this build does not know. */
export function stampArt(ref: string): StampArt | undefined {
  if (!ref.startsWith(BASE_REF_PREFIX)) return undefined;
  const id = ref.slice(BASE_REF_PREFIX.length);
  return ARTS.find((art) => art.id === id);
}

/** One scale bar's reading: the distance it labels and its length on the page. */
export interface ScaleBarLayout {
  distance: number;
  lengthMm: number;
}

/** The round steps a scale bar's distance picks from, largest first. */
const NICE_STEPS = [5, 2, 1] as const;

/**
 * The scale bar's reading: the largest distance of the form 1, 2, or 5 times a
 * power of ten whose bar fits `maxLengthMm`, and how long that bar is. The page's
 * full width stands for `span`, so a distance that fits the room the Element
 * leaves is the one the bar can label honestly. A page, span, or length with no
 * room reads nothing, so a broken Element draws no bar.
 */
export function scaleBarLayout(
  pageWidthMm: number,
  span: number,
  maxLengthMm: number
): ScaleBarLayout {
  if (!(pageWidthMm > 0) || !(span > 0) || !(maxLengthMm > 0)) {
    return { distance: 0, lengthMm: 0 };
  }
  const unitsPerMm = span / pageWidthMm;
  const longest = maxLengthMm * unitsPerMm;
  const power = 10 ** Math.floor(Math.log10(longest));
  const step = NICE_STEPS.find((candidate) => candidate * power <= longest) ?? 1;
  // One significant figure drops the noise a power of ten can leave behind.
  const distance = Number((step * power).toPrecision(1));
  return { distance, lengthMm: distance / unitsPerMm };
}
