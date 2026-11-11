/**
 * The Maps textures (#750): the few base textures a Fill can paint its area
 * with, drawn by us in code as one-colour SVG `<pattern>`s.
 *
 * A texture repeats one tile over the Fill's area. In Atlas every mark takes
 * the texture's own ink, so an Atlas Fill with a texture and no colour reads on
 * a blank page exactly as it always has; in every other Map Style the marks
 * take that Style's `ink` role, so a textured Fill belongs to the Map it is
 * drawn in (#752). A Fill that carries a colour too paints it under the
 * pattern, so the ground shows between the marks.
 *
 * The patterns are plain strings: `sceneToSvg` writes them into the SVG's
 * `<defs>`, and the pattern id a Fill references comes from the Style and the
 * texture, so two Fills of one texture in one Style share it. These textures
 * are original to Maibuk, drawn in-house for this Plugin.
 *
 * This module imports only its own files.
 */

import { MAP_STYLES, type MapStyleId } from "./styles";

/** Every base texture a Fill's content can take. */
export const TEXTURE_IDS = ["grass", "sand", "marsh", "hatching", "dots"] as const;
export type TextureId = (typeof TEXTURE_IDS)[number];

/** One texture's art: the tile it repeats and the ink its marks draw in in Atlas. */
interface TextureArt {
  /** The tile's width and height on the page, in millimetres. */
  tileMm: number;
  /** The ink every mark of the texture takes in Atlas. */
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
 * The id a texture's `<pattern>` takes in `style`, which a Fill's paint
 * references. It comes from the Style and the texture, so two Fills of one
 * texture in one Style share it. Atlas keeps the texture id alone, the id every
 * texture had before Map Styles existed, so an Atlas Map's markup is unchanged.
 */
export function texturePatternId(id: TextureId, style: MapStyleId): string {
  return style === "atlas" ? `texture-${id}` : `texture-${id}-${style}`;
}

/** One texture as an SVG `<pattern>` definition, in page millimetres and the Style's ink. */
export function texturePattern(id: TextureId, style: MapStyleId): string {
  const art = TEXTURES[id];
  const ink = style === "atlas" ? art.ink : MAP_STYLES[style].ink;
  return `<pattern id="${texturePatternId(id, style)}" patternUnits="userSpaceOnUse" width="${String(
    art.tileMm
  )}" height="${String(art.tileMm)}">${art.marks(ink)}</pattern>`;
}
