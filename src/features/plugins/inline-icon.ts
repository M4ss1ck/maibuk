/**
 * The inline icon form a manifest `icon` may take (Plugin API 0.1.1, #531): a
 * list of SVG elements on a 24x24 grid, instead of a Lucide name or a `.svg`
 * path. This module holds the allowlist both the validator and the renderer
 * read, so a refusal and a render can never disagree. It imports nothing, so
 * the renderer does not load the manifest schema.
 */

export const MAX_INLINE_ICON_ELEMENTS = 16;

export const INLINE_ICON_TAGS = [
  "path",
  "circle",
  "rect",
  "line",
  "polyline",
  "polygon",
  "ellipse",
] as const;

export const INLINE_ICON_ATTRIBUTES = [
  "d",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "x",
  "y",
  "width",
  "height",
  "x1",
  "y1",
  "x2",
  "y2",
  "points",
] as const;

export type InlineIconTag = (typeof INLINE_ICON_TAGS)[number];

export interface InlineIcon {
  elements: Array<[string, Record<string, string>]>;
}

/** A manifest icon: a Lucide name or a relative `.svg` path, or inline elements. */
export type PluginIconSpec = string | InlineIcon;

const TAG_SET: ReadonlySet<string> = new Set(INLINE_ICON_TAGS);
const ATTRIBUTE_SET: ReadonlySet<string> = new Set(INLINE_ICON_ATTRIBUTES);

export function isInlineIcon(icon: PluginIconSpec): icon is InlineIcon {
  return typeof icon === "object" && icon !== null;
}

/**
 * The elements the renderer may draw, with any tag or attribute outside the
 * allowlist dropped. The validator refuses those first; this keeps a manifest
 * that reached the renderer by another path from drawing them.
 */
export function allowedInlineElements(
  elements: InlineIcon["elements"]
): Array<[InlineIconTag, Record<string, string>]> {
  const out: Array<[InlineIconTag, Record<string, string>]> = [];
  for (const [tag, attrs] of elements) {
    if (!TAG_SET.has(tag)) continue;
    const kept: Record<string, string> = {};
    for (const [name, value] of Object.entries(attrs)) {
      if (ATTRIBUTE_SET.has(name)) kept[name] = value;
    }
    out.push([tag as InlineIconTag, kept]);
  }
  return out;
}

/** The validator's reason an inline icon is refused, or null when it is allowed. */
export function inlineIconProblem(icon: InlineIcon): string | null {
  if (icon.elements.length > MAX_INLINE_ICON_ELEMENTS) {
    return `an inline icon may have at most ${MAX_INLINE_ICON_ELEMENTS} elements, found ${icon.elements.length}`;
  }
  for (const [index, [tag, attrs]] of icon.elements.entries()) {
    if (!TAG_SET.has(tag)) {
      return `elements[${index}] tag "${tag}" is not allowed in an inline icon; use one of ${INLINE_ICON_TAGS.join(", ")}`;
    }
    for (const name of Object.keys(attrs)) {
      if (!ATTRIBUTE_SET.has(name)) {
        return `elements[${index}] attribute "${name}" is not allowed in an inline icon; use only ${INLINE_ICON_ATTRIBUTES.join(", ")}`;
      }
    }
  }
  return null;
}
