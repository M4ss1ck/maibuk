/**
 * The Maps textures (#750): the few base textures a Fill can paint its area
 * with, drawn by us in code as one-colour SVG `<pattern>`s.
 *
 * A texture repeats one tile over the Fill's area, and every mark of it takes
 * the texture's own ink, so a Fill with a texture and no colour reads on a blank
 * page. A Fill that carries a colour too paints it under the pattern, so the
 * ground shows between the marks.
 *
 * The patterns are plain strings: `sceneToSvg` writes them into the SVG's
 * `<defs>`, and the pattern id a Fill references comes from the texture id alone,
 * so the same texture is defined once however many Fills use it. These textures
 * are original to Maibuk, drawn in-house for this Plugin.
 *
 * This module imports nothing.
 */

/** Every base texture a Fill's content can take. */
export const TEXTURE_IDS = ["grass", "sand", "marsh", "hatching", "dots"] as const;
export type TextureId = (typeof TEXTURE_IDS)[number];

/** One texture's art: the tile it repeats and the ink its marks draw in. */
interface TextureArt {
  /** The tile's width and height on the page, in millimetres. */
  tileMm: number;
  /** The ink every mark of the texture takes. */
  ink: string;
  /** One tile's marks, in the tile's own millimetre coordinates. */
  marks: (ink: string) => string;
}

/** The five base textures: a tile of marks, and the ink they draw in. */
const TEXTURES: Readonly<Record<TextureId, TextureArt>> = {
  // Short blades of grass, a few per tile.
  grass: {
    tileMm: 4,
    ink: "#5c7a3f",
    marks: (ink) =>
      `<path d="M 0.6 3.6 L 1.2 1.7 M 1.5 3.6 L 2.2 1.9 M 2.7 3.6 L 3.4 1.5" fill="none" stroke="${ink}" stroke-width="0.22" stroke-linecap="round"/>`,
  },
  // A scatter of grains, denser and finer than the dots texture.
  sand: {
    tileMm: 3,
    ink: "#b39a63",
    marks: (ink) =>
      `<circle cx="0.6" cy="0.7" r="0.16" fill="${ink}"/><circle cx="2.1" cy="1.3" r="0.13" fill="${ink}"/><circle cx="1.1" cy="2.3" r="0.15" fill="${ink}"/><circle cx="2.5" cy="2.6" r="0.11" fill="${ink}"/>`,
  },
  // Broken water lines between reeds.
  marsh: {
    tileMm: 5,
    ink: "#4f7a72",
    marks: (ink) =>
      `<path d="M 0.4 1 H 2 M 2.8 1.9 H 4.6 M 1.1 3 H 2.6 M 3.4 3.6 H 4.2" fill="none" stroke="${ink}" stroke-width="0.24" stroke-linecap="round"/>`,
  },
  // One diagonal per tile, which joins its neighbours into straight hatching.
  hatching: {
    tileMm: 3,
    ink: "#1f2933",
    marks: (ink) => `<path d="M 0 3 L 3 0" fill="none" stroke="${ink}" stroke-width="0.2"/>`,
  },
  // A pair of dots per tile, for a stippled ground.
  dots: {
    tileMm: 4,
    ink: "#1f2933",
    marks: (ink) =>
      `<circle cx="1" cy="1" r="0.3" fill="${ink}"/><circle cx="3" cy="3" r="0.3" fill="${ink}"/>`,
  },
};

/** Whether a value names a texture this build draws. */
export function isTextureId(value: unknown): value is TextureId {
  return typeof value === "string" && (TEXTURE_IDS as readonly string[]).includes(value);
}

/**
 * The id a texture's `<pattern>` takes, which a Fill's paint references. It
 * comes from the texture id alone, so two Fills of one texture share it.
 */
export function texturePatternId(id: TextureId): string {
  return `texture-${id}`;
}

/** One texture as an SVG `<pattern>` definition, in page millimetres and its own ink. */
export function texturePattern(id: TextureId): string {
  const art = TEXTURES[id];
  return `<pattern id="${texturePatternId(id)}" patternUnits="userSpaceOnUse" width="${String(
    art.tileMm
  )}" height="${String(art.tileMm)}">${art.marks(art.ink)}</pattern>`;
}
