/**
 * The Maps Map Styles (#752): the named sets of colours a Map is drawn in.
 * Every colour an Element holds may be absent (the kind's default role), a
 * role name (which follows the Style), or a `#rrggbb` override (which does
 * not). Rendering resolves each one through `resolveColor`, so switching a
 * Map's Style recolours everything that follows its roles and leaves every
 * override alone.
 *
 * This module imports only its own files.
 */

import type { LineStyleId } from "./maps";

/** The Map Styles a Map can be drawn in. */
export const MAP_STYLE_IDS = ["atlas", "parchment", "ink", "night"] as const;
export type MapStyleId = (typeof MAP_STYLE_IDS)[number];

/** The colour roles every Map Style names. */
export const STYLE_ROLES = [
  "water",
  "land",
  "forest",
  "desert",
  "ink",
  "river",
  "label",
  "halo",
] as const;
export type StyleRole = (typeof STYLE_ROLES)[number];

/**
 * Every Map Style's colours, all `#rrggbb`. Atlas is the original Maps palette,
 * so an existing Map renders unchanged; Parchment is warm, Ink is black on
 * white for print, and Night is dark navy with light ink and labels.
 */
export const MAP_STYLES: Readonly<Record<MapStyleId, Readonly<Record<StyleRole, string>>>> = {
  atlas: {
    water: "#d7e6ec",
    land: "#c8d5a3",
    forest: "#7fa36b",
    desert: "#e3cf9c",
    ink: "#1f2933",
    river: "#3b6e8f",
    label: "#1f2933",
    halo: "#d7e6ec",
  },
  parchment: {
    water: "#e9ddc4",
    land: "#dcc9a4",
    forest: "#9aa873",
    desert: "#e6ca95",
    ink: "#4a3b2a",
    river: "#7890a3",
    label: "#3d3022",
    halo: "#f4ecdd",
  },
  ink: {
    water: "#ffffff",
    land: "#e6e6e6",
    forest: "#c9c9c9",
    desert: "#f0f0f0",
    ink: "#000000",
    river: "#000000",
    label: "#000000",
    halo: "#ffffff",
  },
  night: {
    water: "#14202b",
    land: "#2d3b2f",
    forest: "#3c5244",
    desert: "#4a4130",
    ink: "#e8edf2",
    river: "#78a8c8",
    label: "#f0f4f8",
    halo: "#14202b",
  },
};

/** The `#rrggbb` form a colour override takes. */
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** Whether a value names one of the colour roles a Map Style holds. */
export function isStyleRole(value: unknown): value is StyleRole {
  return typeof value === "string" && (STYLE_ROLES as readonly string[]).includes(value);
}

/** Whether a value is a Map Style id this build knows. */
export function isMapStyleId(value: unknown): value is MapStyleId {
  return typeof value === "string" && (MAP_STYLE_IDS as readonly string[]).includes(value);
}

/** The Map Style an id names; an id this build does not know reads as Atlas. */
export function styleOf(styleId: string | undefined): MapStyleId {
  return isMapStyleId(styleId) ? styleId : "atlas";
}

/**
 * Whether a stored colour field is one the model accepts: a role name, which
 * follows the Map Style, or a `#rrggbb` override.
 */
export function isMapColor(value: unknown): value is string {
  return isStyleRole(value) || (typeof value === "string" && HEX_COLOR.test(value));
}

/**
 * The colour a field settles on in `style`: absent takes the kind's fallback
 * role, a role name takes that role's colour, and a hex override is itself.
 */
export function resolveColor(
  style: MapStyleId,
  value: string | undefined,
  fallbackRole: StyleRole
): string {
  if (value === undefined) return MAP_STYLES[style][fallbackRole];
  if (isStyleRole(value)) return MAP_STYLES[style][value];
  return value;
}

/**
 * The role a Map Line draws in until it takes a colour of its own: a river its
 * `river` ink, every other line style the `ink` role.
 */
export function lineRole(style: LineStyleId): StyleRole {
  return style === "river" ? "river" : "ink";
}

/** The Style's colours in role order, deduped, for a colour picker's swatches. */
export function styleSwatches(style: MapStyleId): string[] {
  return [...new Set(STYLE_ROLES.map((role) => MAP_STYLES[style][role]))];
}

/**
 * The role whose colour is `color` in `style`, or null when it is none of them.
 * A pick that lands on a Style colour stores this role name instead, so it
 * follows a Style switch. `preferred` is the kind's own role, so a Style where
 * two roles share a colour still stores the meaningful one.
 */
export function roleForColor(
  style: MapStyleId,
  color: string,
  preferred: StyleRole
): StyleRole | null {
  const wanted = color.toLowerCase();
  if (MAP_STYLES[style][preferred].toLowerCase() === wanted) return preferred;
  return STYLE_ROLES.find((role) => MAP_STYLES[style][role].toLowerCase() === wanted) ?? null;
}
