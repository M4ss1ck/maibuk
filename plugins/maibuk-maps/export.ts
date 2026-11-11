/**
 * The Maps export core (#753): pure, DOM-free functions that turn a Map into a
 * picture the author can place in a Chapter or Note or save beside their Book.
 *
 * Four jobs, none of them needing a canvas:
 *
 * - **Sizes.** A print size in inches and a DPI give the PNG's pixel size, a
 *   placement gives about 2000 px on the long side, and both keep the page's
 *   aspect (`page.widthMm`/`heightMm`, `maps.ts`).
 * - **Fitting.** What the author inserts travels to Maibuk as one message, and
 *   the message carries the data URI string, so {@link fitUnderCap} measures
 *   that URI: PNG first, then JPEG at falling quality, and a typed error when
 *   nothing fits.
 * - **SVG.** {@link exportSvg} serializes the scene with no editor marks, the
 *   print size in millimetres, and one `@font-face` per font the picture asks
 *   for, so Inkscape and a browser draw what the Frame drew.
 * - **Placing.** {@link imageHtml} builds the `<img>` one Place inserts and
 *   {@link insertWhenReady} retries the insert until the opened Chapter or
 *   Note's editor is mounted.
 *
 * `fitUnderCap` takes its encoder, so this module never touches a canvas: the
 * Worker hands it one that rasterizes the scene. This module imports only its
 * own files and the SDK's protocol constants.
 */

import { PLUGIN_MESSAGE_MAX_BYTES } from "@/plugin-sdk/protocol";
import { roundedMm } from "./geometry";
import type { MapDocument, MapPage } from "./maps";
import { sceneToSvg } from "./scene";

/** Millimetres in an inch, so a page's physical width reads in inches. */
const MM_PER_INCH = 25.4;

/** The DPI a print export uses unless the author picks another. */
export const DEFAULT_DPI = 300;

/** The long side a placed Map is drawn at, in pixels. */
export const PLACE_LONG_SIDE_PX = 2000;

/**
 * The room the insert message leaves free for the HTML wrapper, the alt text,
 * and the message envelope, below Maibuk's 4 MB message cap: only the data URI
 * that rides in it has to fit under the rest.
 */
export const INSERT_ENVELOPE_MARGIN_BYTES = 64 * 1024;

/** The longest data URI an inserted Map may carry, in UTF-8 bytes. */
export const INSERT_IMAGE_CAP_BYTES = PLUGIN_MESSAGE_MAX_BYTES - INSERT_ENVELOPE_MARGIN_BYTES;

/** How long a Place waits between insert attempts, in milliseconds. */
export const PLACE_RETRY_DELAY_MS = 150;

/** How long a Place keeps retrying before it reports that no editor answered. */
export const PLACE_RETRY_TIMEOUT_MS = 5000;

/**
 * The JPEG qualities {@link fitUnderCap} falls through, highest first: each step
 * is visibly coarser than the one before, so the first that fits is the best
 * the cap allows.
 */
export const JPEG_QUALITIES = [0.92, 0.85, 0.75, 0.6, 0.45, 0.3] as const;

/** The pixel size a PNG is drawn at. */
export interface PixelSize {
  widthPx: number;
  heightPx: number;
}

/** What {@link fitUnderCap} answers: the picture that fits, and how it was made. */
export interface FittedImage {
  mime: "image/png" | "image/jpeg";
  bytes: Uint8Array;
  /** The JPEG quality the encoder was asked for; absent for a PNG. */
  quality?: number;
}

/** How {@link fitUnderCap} asks for one picture: PNG, or JPEG at a quality. */
export type EncodeImage = (format: "png" | { jpeg: number }) => Promise<Uint8Array>;

/** What one `editor.insert` answers. */
export interface InsertOutcome {
  status: "applied" | "no-target";
}

/** A font an SVG export can embed: its family name and the file's bytes. */
export interface ExportFont {
  family: string;
  bytes: Uint8Array;
  mime: string;
}

/** A Map picture is everything `sceneToSvg` reads: the page and its elements. */
export type ExportMap = Pick<MapDocument, "page" | "elements"> & { styleId?: string };

/** The one line an export or an insert logs. */
export interface ExportLogEntry {
  action: "save" | "insert";
  format: "png" | "jpeg" | "svg";
  widthPx: number;
  heightPx: number;
  bytes: number;
}

/** Raised when no picture the encoder makes fits under the insert message cap. */
export class ExportTooLargeError extends Error {
  readonly code = "export-too-large";
  /** The cap the picture had to fit, in bytes. */
  readonly capBytes: number;

  constructor(capBytes: number) {
    super(`no picture fits under the ${capBytes}-byte insert cap`);
    this.name = "ExportTooLargeError";
    this.capBytes = capBytes;
  }
}

/**
 * The pixel size a page takes at a print width and DPI: the height follows the
 * page's own aspect, and both round to whole pixels because a raster has no
 * half pixel.
 */
export function printPixelSize(page: MapPage, printWidthIn: number, dpi: number): PixelSize {
  const widthPx = Math.round(printWidthIn * dpi);
  return {
    widthPx,
    heightPx: Math.round((widthPx * page.heightMm) / page.widthMm),
  };
}

/**
 * The print width a new export starts at: the page's own physical width in
 * inches, so a 12x9 in spread prints at 12 in and a 6x9 in page at 6 in.
 */
export function defaultPrintWidthIn(page: MapPage): number {
  return Math.round((page.widthMm / MM_PER_INCH) * 1000) / 1000;
}

/** The DPI a browser draws an SVG at, which its log line reads as pixels. */
export const SVG_DPI = 96;

/**
 * The pixel size an exported SVG is read at, for its log line: the page's
 * millimetres at {@link SVG_DPI}, since an SVG itself has no fixed pixels. The
 * line still names a size, so every export's log line can be compared alike.
 */
export function svgPixelSize(page: MapPage): PixelSize {
  return {
    widthPx: Math.round((page.widthMm / MM_PER_INCH) * SVG_DPI),
    heightPx: Math.round((page.heightMm / MM_PER_INCH) * SVG_DPI),
  };
}

/**
 * The pixel size a placed Map is drawn at: {@link PLACE_LONG_SIDE_PX} on the
 * long side, the short side following the page's aspect.
 */
export function placePixelSize(page: MapPage): PixelSize {
  const longSide = PLACE_LONG_SIDE_PX;
  return page.widthMm >= page.heightMm
    ? { widthPx: longSide, heightPx: Math.round((longSide * page.heightMm) / page.widthMm) }
    : { widthPx: Math.round((longSide * page.widthMm) / page.heightMm), heightPx: longSide };
}

/**
 * The one picture that fits under `capBytes`: the PNG when its data URI fits,
 * else the first JPEG quality that does. Throws {@link ExportTooLargeError}
 * when even the lowest quality is over the cap.
 */
export async function fitUnderCap(
  encode: EncodeImage,
  capBytes: number = INSERT_IMAGE_CAP_BYTES
): Promise<FittedImage> {
  const png = await encode("png");
  if (dataUri("image/png", png).length <= capBytes) {
    return { mime: "image/png", bytes: png };
  }
  for (const quality of JPEG_QUALITIES) {
    const bytes = await encode({ jpeg: quality });
    if (dataUri("image/jpeg", bytes).length <= capBytes) {
      return { mime: "image/jpeg", bytes, quality };
    }
  }
  throw new ExportTooLargeError(capBytes);
}

/** The bytes packed as one base64 data URI; no `Buffer`, so a Worker can call it. */
export function dataUri(mime: string, bytes: Uint8Array): string {
  // `String.fromCharCode` takes its arguments on the stack, so a big picture
  // goes in chunks rather than in one spread.
  const chunk = 0x8000;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

/**
 * The HTML one Place inserts (#753): the Map's picture as one image, with the
 * alt text escaped so a Map name holding a quote cannot break the tag.
 */
export function imageHtml(alt: string, src: string): string {
  const escaped = alt
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
  return `<img src="${src}" alt="${escaped}">`;
}

/**
 * Inserts once the target editor is mounted (#753): the Maps page is its own
 * route, so the editor `navigation.openEntity` opens is not there on the first
 * try. A `no-target` answer is retried every `delayMs` until `timeoutMs` has
 * passed, and the last answer returns. Takes its insert and its sleep, so a
 * test waits no real time.
 */
export async function insertWhenReady(
  insert: () => Promise<InsertOutcome>,
  sleep: (ms: number) => Promise<void>,
  { delayMs = PLACE_RETRY_DELAY_MS, timeoutMs = PLACE_RETRY_TIMEOUT_MS } = {}
): Promise<InsertOutcome> {
  let outcome = await insert();
  for (
    let waited = 0;
    outcome.status === "no-target" && waited + delayMs <= timeoutMs;
    waited += delayMs
  ) {
    await sleep(delayMs);
    outcome = await insert();
  }
  return outcome;
}

/** One `@font-face` rule, drawing `font` by its family name from its bytes. */
function fontFace(font: ExportFont): string {
  return `@font-face{font-family:"${font.family}";src:url(${dataUri(font.mime, font.bytes)})}`;
}

/**
 * Every font family an SVG names, in its `font-family` attributes and style
 * declarations. A family is read out of a list one comma-separated name at a
 * time, so `system-ui, -apple-system, sans-serif` names each of the three.
 */
function usedFontFamilies(svg: string): Set<string> {
  const families = new Set<string>();
  const patterns = [/font-family="([^"]*)"/g, /font-family\s*:\s*([^;"']*)/g];
  for (const pattern of patterns) {
    for (const match of svg.matchAll(pattern)) {
      for (const name of match[1].split(",")) {
        const family = name.trim().replace(/^["']|["']$/g, "");
        if (family !== "") families.add(family.toLowerCase());
      }
    }
  }
  return families;
}

/** The opening `<svg …>` tag `sceneToSvg` writes. */
const SVG_OPEN_TAG = /<svg\b[^>]*>/;

/**
 * The same SVG with one `<style>` holding an `@font-face` per font the picture
 * names, so a renderer with no host theme draws the same letterforms the Frame
 * did. Fonts the SVG never asks for are left out, and an SVG that asks for none
 * of `fonts` comes back unchanged. The block goes into the existing `<defs>`
 * when there is one, else right after the opening `<svg …>` tag.
 */
export function embedFonts(svg: string, fonts: readonly ExportFont[]): string {
  const used = usedFontFamilies(svg);
  const faces = fonts
    .filter((font) => used.has(font.family.toLowerCase()))
    .map((font) => fontFace(font));
  if (faces.length === 0) return svg;
  const style = `<style>${faces.join("")}</style>`;

  if (svg.includes("<defs>")) return svg.replace("<defs>", `<defs>${style}`);

  const opening = SVG_OPEN_TAG.exec(svg);
  if (opening === null) throw new Error("an export SVG must open with an <svg> tag");
  const end = opening.index + opening[0].length;
  return `${svg.slice(0, end)}${style}${svg.slice(end)}`;
}

/** The same SVG with the page's print size added to its root tag, in millimetres. */
function withPrintSize(svg: string, page: MapPage): string {
  return svg.replace(
    SVG_OPEN_TAG,
    (tag) =>
      `${tag.slice(0, -1)} width="${roundedMm(page.widthMm)}mm" height="${roundedMm(
        page.heightMm
      )}mm">`
  );
}

/**
 * A whole Map as an export SVG: what the Frame draws, with no editor marks
 * (`data-element-id`/`data-selected`), the page size in millimetres so Inkscape
 * prints it at the right size, and the fonts it asks for embedded.
 */
export function exportSvg(map: ExportMap, fonts: readonly ExportFont[]): string {
  const picture = sceneToSvg(map)
    .replace(/ data-element-id="[^"]*"/g, "")
    .replace(/ data-selected="true"/g, "")
    .replace(/<g >/g, "<g>");
  return embedFonts(withPrintSize(picture, map.page), fonts);
}

/**
 * The same SVG with its root width and height in pixels, which a rasterizer
 * draws at full resolution (#753). The viewBox stays in page millimetres, so
 * every shape keeps its page-space size; only the frame it fills changes.
 */
export function svgAtPixelSize(svg: string, size: PixelSize): string {
  return svg.replace(SVG_OPEN_TAG, (tag) =>
    tag
      .replace(/\swidth="[^"]*"/, ` width="${size.widthPx}"`)
      .replace(/\sheight="[^"]*"/, ` height="${size.heightPx}"`)
  );
}

/**
 * The one line an export or an insert logs, so Settings' per-Plugin data size
 * and a bug report can both tell what was written and how heavy it was.
 */
export function exportLogLine(entry: ExportLogEntry): string {
  const { action, format, widthPx, heightPx, bytes } = entry;
  return `[maibuk-maps] export ${action} ${format} ${widthPx}x${heightPx} ${bytes} bytes`;
}

/**
 * A file name that saves the Map under its own name: path separators and the
 * characters Windows refuses go, runs of whitespace collapse, and a name with
 * nothing left becomes `map`.
 */
export function exportFileName(mapName: string, ext: string): string {
  const base = mapName
    // Control characters in a file name are exactly what has to go.
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[. ]+|[. ]+$/g, "");
  return `${base === "" ? "map" : base}.${ext}`;
}
