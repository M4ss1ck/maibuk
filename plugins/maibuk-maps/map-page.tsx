/**
 * The Map editor page (#745): host-rendered tool picker, Elements list, and
 * properties panel around the embedded drawing Frame. The page owns no Map
 * state; the open Map's `MapEditor` in the runtime does, so a page that renders
 * after a Worker restart (no open Map) shows an EmptyState instead.
 *
 * Every action here goes through the editor, which commits history and
 * schedules autosave. This module imports only `@/plugin-sdk` and its own files.
 */

import { useEffect, useState, useSyncExternalStore, type ComponentType } from "react";
import {
  FILE_READ_MAX_BYTES,
  PLUGIN_UI_LIMITS,
  bytesToBase64,
  ui,
  type PluginClient,
} from "@/plugin-sdk";
import {
  DEFAULT_SOFT_EDGE_MM,
  MAX_ROUGHEN_STRENGTH_MM,
  MAX_SOFT_EDGE_MM,
  MIN_ROUGHEN_STRENGTH_MM,
  MIN_SOFT_EDGE_MM,
  SOFT_EDGE_STEP_MM,
  type MapEditor,
} from "./editor";
import {
  ASSET_MAX_BYTES,
  AssetTooLargeError,
  assetName,
  createAssetStore,
  customStampRef,
  parseCustomStampRef,
  type AssetStore,
  type AssetUse,
  type CustomFill,
  type MapAsset,
  type MapAssetMime,
} from "./assets";
import {
  ALT_TEXT_MAX_CHARS,
  DEFAULT_DPI,
  MAX_DPI,
  MAX_PRINT_WIDTH_IN,
  MIN_DPI,
  MIN_PRINT_WIDTH_IN,
  dataUri,
  defaultPrintWidthIn,
  exportFileName,
  exportLogLine,
  exportSvg,
  fitUnderCap,
  imageHtml,
  insertWhenReady,
  maxDpiForPrint,
  placePixelSize,
  printPixelSize,
  resolveAssetHrefs,
  svgAtPixelSize,
  svgPixelSize,
  type ExportFont,
} from "./export";
import type { MapTool } from "./frame-protocol";
import { format, translate, type MapsKey } from "./i18n";
import type { MapsRuntime } from "./runtime";
import { useLanguage } from "./maps-page";
import {
  LABEL_FONT_IDS,
  LINE_STYLE_IDS,
  MAX_IMAGE_OPACITY,
  MAX_POLYGON_SIDES,
  MIN_IMAGE_OPACITY,
  MIN_LABEL_SIZE_MM,
  MIN_LABEL_WIDTH_MM,
  MIN_POLYGON_SIDES,
  MIN_SHAPE_SIZE_MM,
  MIN_STAMP_SIZE_MM,
  STAMP_SCALE_UNITS,
  isShapeKind,
  randomMapId,
  type LineStyleId,
  type MapDocument,
  type MapElement,
  type MapLabelFont,
  type ShapeKind,
  type StampScaleUnit,
} from "./maps";
import { MAX_SCATTER_SPACING_MM, MIN_SCATTER_SPACING_MM } from "./scatter";
import { mapLibrary } from "./scene";
import {
  BASE_STAMP_IDS,
  baseStampRef,
  isBaseStampId,
  stampNameKey,
  stampTakesColour,
} from "./stamps";
import {
  MAP_STYLE_IDS,
  isStyleRole,
  lineRole,
  resolveColor,
  styleSwatches,
  type MapStyleId,
} from "./styles";
import { TEXTURE_IDS, type TextureId } from "./textures";

/** The editor page id, exactly as the manifest declares it. */
export const MAP_PAGE_ID = "map";

/**
 * The drawing Frame's HTML, relative to the Plugin folder. The build copies
 * `assets/` verbatim, so the path the Frame loader looks up keeps that prefix,
 * exactly as a page's `frame` contribution does (`docs/plugins/frame-ui.md`).
 */
export const MAP_FRAME_SRC = "assets/ui/map.html";

export interface MapPageDeps {
  client: PluginClient;
  runtime: Pick<MapsRuntime, "editor" | "currentMapId" | "exportFonts">;
  /** Flushes autosave and opens the Maps list. */
  backToMaps(): Promise<void>;
}

/** What the Export panel asks for: the format, and a PNG's print size and DPI. */
interface SaveImageOptions {
  format: "png" | "svg";
  printWidthIn: number;
  dpi: number;
}

/**
 * The host calls and fonts one picture needs, so the save and place paths stay
 * presentational: the client writes or navigates, the editor draws the page, and
 * `exportFonts` embeds the faces it asks for.
 */
interface MapPictureDeps {
  client: PluginClient;
  editor: MapEditor;
  exportFonts(): Promise<readonly ExportFont[]>;
}

/**
 * Saves the open Map through `files.save` (#753): an SVG of the page with its
 * fonts embedded and its pictures inlined, or a PNG rasterized in the Frame at
 * the chosen print size and DPI, where the Frame swaps each picture's id for
 * the bytes it holds. A save the author cancels writes nothing and logs nothing;
 * a saved picture logs exactly one line with its format, pixel size, and bytes.
 */
async function saveMapImage(
  { client, editor, exportFonts }: MapPictureDeps,
  { format: pictureFormat, printWidthIn, dpi }: SaveImageOptions
): Promise<void> {
  const doc = editor.getSnapshot().doc;
  const fonts = await exportFonts();
  const library = editor.getSnapshot().library;

  if (pictureFormat === "svg") {
    // A saved SVG carries its pictures, so it reads in Inkscape or a browser
    // with no Library beside it (#756).
    const uris = await editor.assetUris();
    const svg = resolveAssetHrefs(exportSvg(doc, fonts, { library }), (id) => uris.get(id) ?? null);
    const bytes = new TextEncoder().encode(svg);
    const result = await client.files.save({
      name: exportFileName(doc.name, "svg"),
      mimeType: "image/svg+xml",
      bytes,
    });
    if (result.status !== "saved") return;
    // An SVG itself has no pixels; the log names the size a browser draws it.
    const size = svgPixelSize(doc.page);
    console.info(
      exportLogLine({
        action: "save",
        format: "svg",
        widthPx: size.widthPx,
        heightPx: size.heightPx,
        bytes: bytes.length,
      })
    );
    return;
  }

  const size = printPixelSize(doc.page, printWidthIn, dpi);
  // The rasterize request keeps the ids alone, and the Frame draws the pictures
  // it was sent: a picture's bytes never ride in a message (#756).
  const svg = svgAtPixelSize(exportSvg(doc, fonts, { library }), size);
  const bytes = await editor.rasterize(svg, size, "png");
  const result = await client.files.save({
    name: exportFileName(doc.name, "png"),
    mimeType: "image/png",
    bytes,
  });
  if (result.status !== "saved") return;
  console.info(
    exportLogLine({
      action: "save",
      format: "png",
      widthPx: size.widthPx,
      heightPx: size.heightPx,
      bytes: bytes.length,
    })
  );
}

/** One editor a Map can be placed in: a Chapter or a Note. */
interface PlaceTarget {
  id: string;
  kind: "chapter" | "note";
  label: string;
}

/**
 * The editors one Place can reach (#753): the Chapters and Notes of the Map's
 * own Book, or, for a Map with no Book, every Book's Chapters and Notes labelled
 * by their Book. The Library lists are the public handle on them.
 */
async function listPlaceTargets(
  client: PluginClient,
  map: Pick<MapDocument, "bookId">
): Promise<PlaceTarget[]> {
  if (map.bookId !== null) {
    const [chapters, notes] = await Promise.all([
      client.library.chapters.list({ bookId: map.bookId }),
      client.library.notes.list({ bookId: map.bookId }),
    ]);
    return [
      ...chapters.map((chapter) => ({
        id: chapter.id,
        kind: "chapter" as const,
        label: chapter.title,
      })),
      ...notes.map((note) => ({ id: note.id, kind: "note" as const, label: note.title })),
    ];
  }

  const books = await client.library.books.list();
  const titles = new Map(books.map((book) => [book.id, book.title]));
  const label = (title: string, bookId: string | null): string => {
    const bookTitle = bookId === null ? undefined : titles.get(bookId);
    return bookTitle === undefined ? title : `${bookTitle} — ${title}`;
  };
  const chapters = await Promise.all(
    books.map(async (book) => {
      const list = await client.library.chapters.list({ bookId: book.id });
      return list.map((chapter) => ({
        id: chapter.id,
        kind: "chapter" as const,
        label: label(chapter.title, book.id),
      }));
    })
  );
  const notes = await client.library.notes.list({});
  return [
    ...chapters.flat(),
    ...notes.map((note) => ({
      id: note.id,
      kind: "note" as const,
      label: label(note.title, note.bookId),
    })),
  ];
}

/**
 * The host's cap on one UI string, in UTF-16 code units (`maibuk-select`'s
 * `label` and `selectedKey` in the SDK's UI table). A longer one is refused and
 * the Plugin stopped, so a label built from Library data is cut to it.
 */
const PLACE_LABEL_MAX = 512;

/**
 * `text` cut to at most {@link PLACE_LABEL_MAX} code units, ending in "…" when
 * it was cut. A cut never splits a surrogate pair, so the result is well-formed.
 */
function clampLabel(text: string): string {
  if (text.length <= PLACE_LABEL_MAX) return text;
  const end = PLACE_LABEL_MAX - 1;
  const last = text.charCodeAt(end - 1);
  return `${text.slice(0, last >= 0xd800 && last <= 0xdbff ? end - 1 : end)}…`;
}

/**
 * `options` fitted to the host's {@link PLUGIN_UI_LIMITS.maxOptions} (#753,
 * #756): a Library past the cap loses the tail of its list, never the page, and
 * every label is clamped, since a Library name is the author's own text. The
 * value already picked keeps its place, the last one kept making room.
 */
function fitOptions(
  options: readonly { value: string; label: string }[],
  selectedValue?: string | null
): Array<{ value: string; label: string }> {
  const kept = options.slice(0, PLUGIN_UI_LIMITS.maxOptions);
  const chosen =
    selectedValue === null || selectedValue === undefined
      ? undefined
      : options.find((option) => option.value === selectedValue);
  if (chosen !== undefined && !kept.includes(chosen)) kept[kept.length - 1] = chosen;
  return kept.map((option) => ({ value: option.value, label: clampLabel(option.label) }));
}

/** The target picker's options (#753): the Library's Chapters and Notes, fitted to the cap. */
function placeTargetOptions(
  targets: readonly PlaceTarget[],
  selectedId: string | null
): Array<{ value: string; label: string }> {
  return fitOptions(
    targets.map((target) => ({ value: target.id, label: target.label })),
    selectedId
  );
}

/** The alt text the dialog holds: at most {@link ALT_TEXT_MAX_CHARS} characters (#753). */
function altText(text: string): string {
  return text.slice(0, ALT_TEXT_MAX_CHARS);
}

/** The picture one Place inserts, and what its one log line names. */
interface PlacedImage {
  html: string;
  format: "png" | "jpeg";
  widthPx: number;
  heightPx: number;
  bytes: number;
}

/** The three steps the Place dialog drives, so each failure reaches its own surface. */
interface PlaceCallbacks {
  listTargets(): Promise<PlaceTarget[]>;
  prepare(alt: string): Promise<PlacedImage>;
  finish(target: PlaceTarget, image: PlacedImage): Promise<void>;
  notifyFailed(): Promise<void>;
}

/** Waits before one insert retry, so a Place does not busy-loop on the host. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Rasterizes the open Map into the HTML one Place inserts (#753): at
 * {@link placePixelSize}, PNG first and JPEG at falling quality when the data
 * URI would be over the insert cap, with the alt text escaped. The SVG names its
 * pictures by id, and the Frame draws the bytes it holds, so no picture rides in
 * the rasterize message (#756). Throws {@link ExportTooLargeError} when even the
 * lowest JPEG is over the cap, before anything navigates.
 */
async function preparePlace(
  { editor, exportFonts }: Pick<MapPictureDeps, "editor" | "exportFonts">,
  alt: string
): Promise<PlacedImage> {
  const doc = editor.getSnapshot().doc;
  const size = placePixelSize(doc.page);
  const library = editor.getSnapshot().library;
  const svg = svgAtPixelSize(exportSvg(doc, await exportFonts(), { library }), size);
  const fitted = await fitUnderCap((format) => editor.rasterize(svg, size, format));
  return {
    html: imageHtml(alt, dataUri(fitted.mime, fitted.bytes)),
    format: fitted.mime === "image/png" ? "png" : "jpeg",
    widthPx: size.widthPx,
    heightPx: size.heightPx,
    bytes: fitted.bytes.length,
  };
}

/**
 * Opens the target, inserts the picture once its editor is mounted, and logs
 * exactly one line (#753). Throws when no editor answers within the retry
 * window; nothing is inserted then.
 */
async function finishPlace(
  client: PluginClient,
  target: PlaceTarget,
  image: PlacedImage
): Promise<void> {
  await client.navigation.openEntity({ entity: { kind: target.kind, id: target.id } });
  const outcome = await insertWhenReady(
    () => client.editor.insert({ content: { html: image.html } }),
    sleep
  );
  if (outcome.status !== "applied") throw new Error("no editor answered the insert");
  console.info(
    exportLogLine({
      action: "insert",
      format: image.format,
      widthPx: image.widthPx,
      heightPx: image.heightPx,
      bytes: image.bytes,
    })
  );
}

/** One Element's row menu values. */
const RENAME = "rename";
const MOVE_UP = "moveUp";
const MOVE_DOWN = "moveDown";
const HIDE = "hide";
const SHOW = "show";
const LOCK = "lock";
const UNLOCK = "unlock";
const DELETE = "delete";
const PROPERTIES = "properties";

/** The no-texture and no-scatter choice of the Fill content selects. */
const NONE = "none";

/** The Line style select's label for each style the model accepts, in its order. */
const LINE_STYLE_KEYS: Readonly<Record<LineStyleId, MapsKey>> = {
  coast: "properties.style.coast",
  river: "properties.style.river",
  road: "properties.style.road",
  border: "properties.style.border",
  coastRipple: "properties.style.coastRipple",
  plain: "properties.style.plain",
};

/** The Place button's label for each Shape tool. */
const PLACE_SHAPE_KEYS: Readonly<Record<ShapeKind, MapsKey>> = {
  ellipse: "properties.placeShape.ellipse",
  rectangle: "properties.placeShape.rectangle",
  polygon: "properties.placeShape.polygon",
};

/** The icon each Shape tool's Place button shows, so the footer's action reads as the shape. */
const SHAPE_TOOL_ICONS: Readonly<Record<ShapeKind, string>> = {
  ellipse: "circle",
  rectangle: "square",
  polygon: "pentagon",
};

/**
 * The tool belt's tools, in the order #775 Decision 3 fixes: the drawing and
 * pouring tools, the three Shape tools, then Insert and Eraser (#778). Each is a
 * `ui.IconButton` with `isSelected`, so the belt is one control per tool.
 */
const TOOL_BELT: ReadonlyArray<{ tool: MapTool; label: MapsKey; icon: string }> = [
  { tool: "select", label: "tools.select", icon: "mouse-pointer-2" },
  { tool: "pencil", label: "tools.pencil", icon: "pencil" },
  { tool: "pen", label: "tools.pen", icon: "pen-tool" },
  { tool: "bucket", label: "tools.bucket", icon: "paint-bucket" },
  { tool: "area", label: "tools.area", icon: "lasso-select" },
  { tool: "ellipse", label: "tools.ellipse", icon: "circle" },
  { tool: "rectangle", label: "tools.rectangle", icon: "square" },
  { tool: "polygon", label: "tools.polygon", icon: "pentagon" },
  { tool: "insert", label: "tools.insert", icon: "stamp" },
  { tool: "eraser", label: "tools.eraser", icon: "eraser" },
];

/**
 * The floating editor's CSS (#778): the drawing fills the page body and every
 * control floats over it as a card, the way the app's own Canvas does. A host
 * `ui.View` carries no nameable class or attribute, so the root is the editor's
 * own nested `ui.Surface` (the one host element every engine marks with
 * `data-plugin-ui`) and each card is one of its slots: its children in the order
 * #775 Decision 7 fixes the tab order in. A shut card keeps its slot and empties
 * it, so a card's place never depends on another card's state, and the Frame's
 * box never changes when one opens or closes. `layout-css.test.tsx` mounts the
 * page through the host renderer and holds every selector here to the element it
 * is meant for.
 */
export const MAP_EDITOR_CSS = `
div[data-plugin-ui] { position: relative; display: block; height: 100%; min-height: 0; overflow: hidden; }
div[data-plugin-ui] > div:nth-child(5) { position: absolute; inset: 0; }
div[data-plugin-ui] > div:nth-child(5) > [data-plugin-frame="embedded"] { height: 100%; min-height: 0; }
div[data-plugin-ui] > div:nth-child(5) > [data-plugin-frame="embedded"] > div { height: 100%; min-height: 0; border-width: 0; border-radius: 0; }
div[data-plugin-ui] > div:nth-child(1),
div[data-plugin-ui] > div:nth-child(2),
div[data-plugin-ui] > div:nth-child(7),
div[data-plugin-ui] > div:nth-child(8) { position: absolute; z-index: 2; padding: 0.25rem; border: 1px solid var(--color-border); border-radius: 0.5rem; background: var(--color-card); box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1); }
div[data-plugin-ui] > div:nth-child(3),
div[data-plugin-ui] > div:nth-child(4),
div[data-plugin-ui] > div:nth-child(6) { position: absolute; z-index: 2; padding: 0.75rem; border: 1px solid var(--color-border); border-radius: 0.5rem; background: var(--color-card); box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1); max-height: calc(100% - 1.5rem); overflow-y: auto; }
div[data-plugin-ui] > div:nth-child(3):empty,
div[data-plugin-ui] > div:nth-child(4):empty,
div[data-plugin-ui] > div:nth-child(6):empty { display: none; }
div[data-plugin-ui] > div:nth-child(1) { top: 0.75rem; left: 0.75rem; }
div[data-plugin-ui] > div:nth-child(2) { top: 50%; left: 0.75rem; transform: translateY(-50%); }
div[data-plugin-ui] > div:nth-child(3) { top: 50%; left: 3.75rem; width: 15rem; transform: translateY(-50%); }
div[data-plugin-ui] > div:nth-child(4) { top: 50%; left: 3.75rem; width: 15rem; transform: translateY(-50%); }
div[data-plugin-ui] > div:nth-child(6) { top: 4.5rem; right: 0.75rem; width: 18.5rem; }
div[data-plugin-ui] > div:nth-child(7) { top: 0.75rem; right: 0.75rem; }
div[data-plugin-ui] > div:nth-child(8) { right: 0.75rem; bottom: 0.75rem; }
/* The narrow page (#779, #775 Decision 6): the drawing still fills the page,
   but the chrome turns into bars. The two top pills become one top bar, the
   belt runs along the bottom and scrolls sideways with 44px targets, and
   Properties and Layers become bottom regions at most half the page tall. The
   overflow popover and the full-height toggle are chunk 2's, not this block's. */
@media (max-width: 639px) {
  /* The left pill spans the bar; the right pill gives up its own box, so the
     bar shows through and the two read as one. */
  div[data-plugin-ui] > div:nth-child(1) { top: 0; left: 0; right: 0; padding: 0.5rem; border-width: 0 0 1px; border-radius: 0; }
  div[data-plugin-ui] > div:nth-child(7) { top: 0; right: 0.5rem; left: auto; padding: 0.5rem 0; border-width: 0; border-radius: 0; background: none; box-shadow: none; }
  /* The belt lies along the bottom, one row that scrolls sideways. */
  div[data-plugin-ui] > div:nth-child(2) { top: auto; bottom: 0; left: 0; right: 0; flex-direction: row; overflow-x: auto; overflow-y: hidden; transform: none; padding: 0.5rem; border-width: 1px 0 0; border-radius: 0; }
  /* Every tool is a 44px target that never shrinks inside the scrolling row. */
  div[data-plugin-ui] > div:nth-child(2) > button { flex: 0 0 auto; min-width: 2.75rem; min-height: 2.75rem; }
  /* Layers and Properties are bottom regions, each at most half the page tall. */
  div[data-plugin-ui] > div:nth-child(4) { top: auto; bottom: 4.25rem; left: 0.5rem; right: 0.5rem; width: auto; transform: none; max-height: calc(50% - 4.25rem); }
  div[data-plugin-ui] > div:nth-child(6) { top: auto; bottom: 4.25rem; left: 0.5rem; right: 0.5rem; width: auto; max-height: calc(50% - 4.25rem); }
  /* The zoom cluster moves under the bar, clear of the belt and the regions. */
  div[data-plugin-ui] > div:nth-child(8) { top: 3.25rem; right: 0.5rem; bottom: auto; }
}
`;

/** What a line converted from a Shape says it was, one string per kind. */
const CONVERTED_KEYS: Readonly<Record<ShapeKind, MapsKey>> = {
  ellipse: "properties.convertedFrom.ellipse",
  rectangle: "properties.convertedFrom.rectangle",
  polygon: "properties.convertedFrom.polygon",
};

/** The scale bar's unit picker's label for each unit it reads in. */
const STAMP_UNIT_KEYS: Readonly<Record<StampScaleUnit, MapsKey>> = {
  km: "properties.stamp.unit.km",
  mi: "properties.stamp.unit.mi",
};

/** The Texture select's label for each texture a Fill takes, in the order it offers them. */
const TEXTURE_KEYS: Readonly<Record<TextureId, MapsKey>> = {
  grass: "properties.texture.grass",
  sand: "properties.texture.sand",
  marsh: "properties.texture.marsh",
  hatching: "properties.texture.hatching",
  dots: "properties.texture.dots",
};

/** The Map Style picker's label for each Style the model accepts, in its order. */
const MAP_STYLE_KEYS: Readonly<Record<MapStyleId, MapsKey>> = {
  atlas: "properties.mapStyle.atlas",
  parchment: "properties.mapStyle.parchment",
  ink: "properties.mapStyle.ink",
  night: "properties.mapStyle.night",
};

/** Whether a colour field already follows the Map Style, so it has no override to clear. */
function followsStyle(color: string | undefined): boolean {
  return color === undefined || isStyleRole(color);
}

/** The Font select's label for each bundled face a Map Label takes, in the order it offers them. */
const LABEL_FONT_KEYS: Readonly<Record<Exclude<MapLabelFont, "pdf">, MapsKey>> = {
  "im-fell-english": "font.imFellEnglish",
  cinzel: "font.cinzel",
  "uncial-antiqua": "font.uncialAntiqua",
  "medieval-sharp": "font.medievalSharp",
};

/**
 * The Elements list's kind label, for the kinds a Map can hold (#748: a Fill
 * joins a Map Line; #749: a Stamp joins them; #751: a Map Label joins them;
 * #756: a Map Image joins them). A kind with no label of its own says nothing,
 * so the row falls back to its flags alone rather than calling itself a Map Line.
 */
const ELEMENT_KIND_KEYS: Readonly<Partial<Record<MapElement["kind"], MapsKey>>> = {
  line: "element.kind.line",
  fill: "element.kind.fill",
  stamp: "element.kind.stamp",
  label: "element.kind.label",
  image: "element.kind.image",
};

interface RenameDialog {
  id: string;
  name: string;
}

/** The element's kind, then the flags it carries, for the row's description. */
function describe(element: MapElement, t: (key: MapsKey) => string): string {
  const parts: string[] = [];
  const kindKey = ELEMENT_KIND_KEYS[element.kind];
  if (kindKey !== undefined) parts.push(t(kindKey));
  if (element.hidden) parts.push(t("elements.hidden"));
  if (element.locked) parts.push(t("elements.locked"));
  return parts.join(" · ");
}

/** The picture types an upload accepts, in the host picker's own spelling. */
const UPLOAD_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "svg"] as const;

/** The picture type each accepted file extension names. */
const UPLOAD_MIMES: Readonly<Record<string, MapAssetMime>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  svg: "image/svg+xml",
};

/** The picture type `name`'s extension names, or null when Maps cannot draw it. */
function uploadMime(name: string): MapAssetMime | null {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return null;
  return UPLOAD_MIMES[name.slice(dot + 1).toLowerCase()] ?? null;
}

/** A file name without its extension, which names the Library picture. */
function fileStem(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? name : name.slice(0, dot);
}

/** The message an upload failure shows: the size limit, or that the picture is unusable. */
function uploadErrorMessage(error: unknown, t: (key: MapsKey) => string): string {
  if (error instanceof AssetTooLargeError) {
    return format(t("upload.tooLarge"), {
      limit: (ASSET_MAX_BYTES / (1024 * 1024)).toFixed(1),
    });
  }
  return t("upload.invalid");
}

/** Every byte behind `grant`, read in the ranges the host accepts. */
async function readAllBytes(
  client: PluginClient,
  grant: { grant: string; size: number }
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (let offset = 0; offset < grant.size; ) {
    const bytes = new Uint8Array(
      await client.files.read({ grant: grant.grant, offset, length: FILE_READ_MAX_BYTES })
    );
    // A short read is the end of a file that shrank since it was picked.
    if (bytes.length === 0) break;
    chunks.push(bytes);
    total += bytes.length;
    offset += bytes.length;
    if (bytes.length < FILE_READ_MAX_BYTES) break;
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.length;
  }
  return all;
}

/**
 * Picks one picture, cleans and measures it in the Frame, and saves it to the
 * Library under `use` (#756). Null means the author closed the picker. Throws
 * {@link AssetTooLargeError} before reading an upload the size cap already
 * refuses, and any other failure when the picture cannot be ingested or saved.
 */
async function pickAndSaveAsset(
  client: PluginClient,
  editor: MapEditor,
  assets: AssetStore,
  use: AssetUse
): Promise<MapAsset | null> {
  const picked = await client.files.pick({ extensions: [...UPLOAD_EXTENSIONS] });
  if (picked === null) return null;
  const mime = uploadMime(picked.name);
  if (mime === null) throw new Error("unsupported-image");
  // Base64 grows bytes by a third before the index adds anything, so a file
  // already over the cap is refused without reading it.
  if (picked.size * (4 / 3) > ASSET_MAX_BYTES) throw new AssetTooLargeError(ASSET_MAX_BYTES);
  const bytes = await readAllBytes(client, picked);
  const ingested = await editor.ingestAsset(mime, bytesToBase64(bytes));
  const asset: MapAsset = {
    id: randomMapId(),
    // A file name is the author's, and as long as a path allows: the Library
    // keeps it under the same bound a Map's own name has (#756).
    name: assetName(fileStem(picked.name)),
    mime,
    data: ingested.data,
    width: ingested.width,
    height: ingested.height,
    recolorable: ingested.recolorable,
  };
  await assets.saveAsset(asset, use);
  return asset;
}

function MapEditorView({
  editor,
  t,
  backToMaps,
  save,
  place,
  pickAsset,
  saveCustomFill,
}: {
  editor: MapEditor;
  t: (key: MapsKey) => string;
  backToMaps: () => Promise<void>;
  save(options: SaveImageOptions): Promise<void>;
  place: PlaceCallbacks;
  /** Picks, ingests, saves, and lists one uploaded picture for `use`; null when cancelled. */
  pickAsset(use: AssetUse): Promise<MapAsset | null>;
  /** Saves one Custom Fill and lists it, so every Map draws it. */
  saveCustomFill(fill: CustomFill): Promise<void>;
}) {
  const snapshot = useSyncExternalStore(editor.subscribe, editor.getSnapshot);
  const [dialog, setDialog] = useState<RenameDialog | null>(null);
  // The Export panel's own state (#753): a new Map opens on PNG at its own
  // physical width and the default print DPI.
  const [exportFormat, setExportFormat] = useState<"png" | "svg">("png");
  const [printWidthIn, setPrintWidthIn] = useState(() =>
    defaultPrintWidthIn(editor.getSnapshot().doc.page)
  );
  const [dpi, setDpi] = useState(DEFAULT_DPI);
  const [exportFailed, setExportFailed] = useState(false);
  // The Insert panel's upload: whether the picture is a Map Image, and the one
  // localized error the last upload left behind.
  const [asMapImage, setAsMapImage] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // The Custom Stamps picked for a new Custom Fill in the Fill properties.
  const [fillStampRefs, setFillStampRefs] = useState<string[]>([]);
  // The Place dialog's state: the targets it lists, the one picked, the alt
  // text, and whether the last Place failed.
  const [placeOpen, setPlaceOpen] = useState(false);
  const [placeTargets, setPlaceTargets] = useState<PlaceTarget[] | null>(null);
  const [placeTargetId, setPlaceTargetId] = useState<string | null>(null);
  const [placeAlt, setPlaceAlt] = useState("");
  const [placeFailed, setPlaceFailed] = useState(false);
  // Each Properties request remounts the Name field with `autoFocus`, so the
  // menu entry visibly lands focus on the panel even when the row already is
  // the selection (#745).
  const [propertiesFocus, setPropertiesFocus] = useState(0);
  // The floating chrome's own state (#778): whether the Layers card shows, and
  // whether the Properties card is shrunk to its restore icon.
  const [layersOpen, setLayersOpen] = useState(false);
  const [propertiesMinimised, setPropertiesMinimised] = useState(false);
  // The Map's own name while its rename dialog holds it, or null when it is shut.
  const [mapRename, setMapRename] = useState<string | null>(null);
  const selected =
    snapshot.selectedId === null
      ? null
      : (snapshot.elements.find((element) => element.id === snapshot.selectedId) ?? null);
  // The Shape tool whose Place button the picker shows, or null for any other tool.
  const shapeTool = isShapeKind(snapshot.tool) ? snapshot.tool : null;
  const shape = snapshot.selectedShape;
  const stamp = snapshot.selectedStamp;
  const label = selected?.kind === "label" ? selected : null;
  const selectedLine = selected?.kind === "line" ? selected : null;
  const selectedFill = selected?.kind === "fill" ? selected : null;
  const image = selected?.kind === "image" ? selected : null;
  const scatter = snapshot.selectedFillScatter;
  const style = snapshot.styleId;
  // The Custom Stamps the Library holds: the Insert picker names them after
  // the base Stamps, and a new Custom Fill picks among them.
  const customStamps = [...snapshot.library.assets.values()]
    .filter((asset) => asset.use === "stamp")
    .map((asset) => ({ ref: customStampRef(asset.id), name: asset.name }));
  // Every Library picture the author uploaded grows these lists, so each one is
  // fitted to the host's caps: a Select's options to `maxOptions`, and the
  // Custom Stamps' rows (one node each) to the same list cap.
  const stampOptions = fitOptions(
    [
      ...BASE_STAMP_IDS.map((id) => ({ value: id, label: t(stampNameKey(id)) })),
      ...customStamps.map((one) => ({ value: one.ref, label: one.name })),
    ],
    snapshot.currentStampId
  );
  const fillStampRows = customStamps.slice(0, PLUGIN_UI_LIMITS.maxOptions);
  // The scatter select offers the base Stamps, so it reads the one the Fill
  // scatters back from its art ref.
  const scatterStampId =
    scatter === null
      ? null
      : (BASE_STAMP_IDS.find((id) => baseStampRef(id) === scatter.stamp) ?? null);
  // The Bucket's colour is what the next pour uses, so it wins while the Bucket
  // is active; with any other tool the one control edits the selected Fill.
  const pouring = snapshot.tool === "bucket";
  const fillColor = pouring ? snapshot.currentFillColor : snapshot.selectedFillColor;
  const showFillColor = pouring || snapshot.selectedIsFill;
  // The one colour override the footer can hand back to the Map Style (#752):
  // whichever Element the selection is, its own colour is the one it clears.
  const useMapStyleColorTarget: { color: string | undefined } | null =
    selected === null
      ? null
      : showFillColor && !pouring && fillColor !== null
        ? { color: fillColor }
        : stamp !== null && stampRecolours(stamp.stampRef)
          ? { color: stamp.color }
          : label !== null
            ? { color: label.color }
            : selectedLine !== null
              ? { color: selectedLine.color }
              : null;

  // Leaving the page writes whatever the quiet period still holds; the Back
  // button already flushed, so this is a no-op there.
  useEffect(() => () => void editor.flush(), [editor]);

  function menuItems(element: MapElement) {
    return [
      { value: RENAME, label: t("elements.rename") },
      { value: MOVE_UP, label: t("elements.moveUp") },
      { value: MOVE_DOWN, label: t("elements.moveDown") },
      {
        value: element.hidden ? SHOW : HIDE,
        label: element.hidden ? t("elements.show") : t("elements.hide"),
      },
      {
        value: element.locked ? UNLOCK : LOCK,
        label: element.locked ? t("elements.unlock") : t("elements.lock"),
      },
      { value: DELETE, label: t("elements.delete") },
      { value: PROPERTIES, label: t("elements.properties") },
    ];
  }

  function menuAction(element: MapElement, value: string): void {
    switch (value) {
      case RENAME:
        setDialog({ id: element.id, name: element.name });
        break;
      case MOVE_UP:
        editor.moveUp(element.id);
        break;
      case MOVE_DOWN:
        editor.moveDown(element.id);
        break;
      case HIDE:
        editor.setHidden(element.id, true);
        break;
      case SHOW:
        editor.setHidden(element.id, false);
        break;
      case LOCK:
        editor.setLocked(element.id, true);
        break;
      case UNLOCK:
        editor.setLocked(element.id, false);
        break;
      case DELETE:
        editor.deleteElement(element.id);
        break;
      case PROPERTIES:
        editor.select(element.id);
        setPropertiesFocus((count) => count + 1);
        break;
    }
  }

  function submitRename(): void {
    if (dialog === null) return;
    editor.rename(dialog.id, dialog.name);
    setDialog(null);
  }

  function submitMapRename(): void {
    if (mapRename === null) return;
    editor.renameMap(mapRename);
    setMapRename(null);
  }

  /** What the Insert picker's current Stamp is called: a base Stamp or a Library picture. */
  function stampLabel(pick: string): string {
    if (isBaseStampId(pick)) return t(stampNameKey(pick));
    const assetId = parseCustomStampRef(pick);
    const asset = assetId === null ? undefined : snapshot.library.assets.get(assetId);
    return asset?.name ?? t("element.kind.stamp");
  }

  /** Whether a Stamp pick offers a colour: base one-paint art, or a one-paint picture. */
  function stampRecolours(pick: string): boolean {
    const assetId = parseCustomStampRef(pick);
    if (assetId !== null) return snapshot.library.assets.get(assetId)?.recolorable === true;
    return stampTakesColour(pick);
  }

  /** The name a new Custom Fill takes: the next free "Custom Fill N". */
  function newCustomFillName(): string {
    return format(t("customFill.name"), { number: snapshot.library.customFills.size + 1 });
  }

  /**
   * The Insert panel's Upload (#756): pick a picture, ingest it in the Frame,
   * keep it in the Library, then place it at the view centre as the Custom
   * Stamp or the Map Image the panel asked for.
   */
  async function uploadPicture(): Promise<void> {
    setUploadError(null);
    try {
      const asset = await pickAsset(asMapImage ? "image" : "stamp");
      if (asset === null) return;
      if (asMapImage) editor.insertImage(asset.id);
      else editor.insertCustomStamp(asset.id);
    } catch (error) {
      setUploadError(uploadErrorMessage(error, t));
    }
  }

  /** Builds a Custom Fill from an uploaded texture and gives it to the selected Fill. */
  async function createFillFromTexture(): Promise<void> {
    if (selectedFill === null) return;
    setUploadError(null);
    try {
      const asset = await pickAsset("texture");
      if (asset === null) return;
      const fill: CustomFill = {
        id: randomMapId(),
        name: newCustomFillName(),
        texture: asset.id,
      };
      await saveCustomFill(fill);
      editor.setFillCustomFill(selectedFill.id, fill.id);
    } catch (error) {
      setUploadError(uploadErrorMessage(error, t));
    }
  }

  /** Builds a Custom Fill from the chosen Custom Stamps and gives it to the selected Fill. */
  async function createFillFromStamps(): Promise<void> {
    if (selectedFill === null || fillStampRefs.length === 0) return;
    setUploadError(null);
    try {
      const fill: CustomFill = {
        id: randomMapId(),
        name: newCustomFillName(),
        stamps: [...fillStampRefs],
      };
      await saveCustomFill(fill);
      editor.setFillCustomFill(selectedFill.id, fill.id);
      setFillStampRefs([]);
    } catch {
      setUploadError(t("customFill.failed"));
    }
  }

  // The pixel size the PNG will be, and the print height it comes to, so the
  // author sees both before saving.
  const exportSize = printPixelSize(snapshot.doc.page, printWidthIn, dpi);
  const printHeightIn = Math.round((exportSize.heightPx / Math.max(dpi, 1)) * 10) / 10;
  const dpiLimit = dpiLimitAt(printWidthIn);

  /** The most DPI a print width may be drawn at (#753): the canvas limit under the panel's own cap. */
  function dpiLimitAt(widthIn: number): number {
    return Math.min(MAX_DPI, maxDpiForPrint(snapshot.doc.page, widthIn));
  }

  /** Picks a print width, lowering the DPI with it when the page outgrows it. */
  function setPrintWidth(widthIn: number): void {
    setPrintWidthIn(widthIn);
    setDpi((current) => Math.min(current, dpiLimitAt(widthIn)));
  }

  async function saveExport(): Promise<void> {
    setExportFailed(false);
    try {
      await save({ format: exportFormat, printWidthIn, dpi });
    } catch {
      // A refused save or a Frame that could not draw shows one localized line.
      setExportFailed(true);
    }
  }

  async function openPlace(): Promise<void> {
    setPlaceFailed(false);
    setPlaceTargets(null);
    setPlaceTargetId(null);
    setPlaceAlt(altText(snapshot.doc.name));
    setPlaceOpen(true);
    try {
      const targets = await place.listTargets();
      setPlaceTargets(targets);
      setPlaceTargetId(targets[0]?.id ?? null);
    } catch {
      setPlaceOpen(false);
      setPlaceFailed(true);
    }
  }

  async function submitPlace(): Promise<void> {
    const target = placeTargets?.find((candidate) => candidate.id === placeTargetId);
    if (target === undefined) return;
    setPlaceFailed(false);
    let image: PlacedImage;
    try {
      image = await place.prepare(placeAlt);
    } catch {
      // Nothing navigated yet, so the panel can still show the failure.
      setPlaceFailed(true);
      return;
    }
    setPlaceOpen(false);
    try {
      await place.finish(target, image);
    } catch {
      // The Map page is gone once the target opened: the host toast reports it.
      await place.notifyFailed();
    }
  }

  // Top of the list is the topmost Element; the document array grows upward.
  const rows = [...snapshot.elements].reverse();
  // With nothing selected the Properties card still shows the defaults the
  // active tool offers: the Pen's line style, a Shape's Place path, or the
  // colour the Bucket pours (#778).
  const showProperties =
    selected !== null || snapshot.tool === "pen" || shapeTool !== null || pouring;
  const zoomPercent = Math.round(snapshot.zoom * 100);

  return (
    <ui.Surface css={MAP_EDITOR_CSS}>
      {/* The editor's root: a Surface of its own, because a host `ui.View`
          carries no attribute an engine can reach and this one carries the
          Surface marker, so the stylesheet and its guard both find it. Its
          children keep these eight slots whatever is open or shut, and a closed
          card empties its own slot, which is what keeps the Frame's box the
          same however the author opens and closes the chrome (#778). */}
      <ui.Surface>
        {/* 1: the top-left pill */}
        <ui.View direction="row" gap="sm" align="center">
          <ui.Button variant="ghost" icon="arrow-left" onPress={() => void backToMaps()}>
            {t("map.backToMaps")}
          </ui.Button>
          {/* The Map's own name: pressing it renames the Map, not an Element. */}
          <ui.Button variant="ghost" onPress={() => setMapRename(snapshot.doc.name)}>
            {snapshot.doc.name}
          </ui.Button>
          <ui.IconButton
            label={t("chrome.undo")}
            icon="undo-2"
            isDisabled={!snapshot.canUndo}
            onPress={() => editor.undo()}
          />
          <ui.IconButton
            label={t("chrome.redo")}
            icon="redo-2"
            isDisabled={!snapshot.canRedo}
            onPress={() => editor.redo()}
          />
          {snapshot.saveFailed ? <ui.Status tone="warning">{t("map.saveFailed")}</ui.Status> : null}
        </ui.View>

        {/* 2: the tool belt. Every tool sits in it, with the Layers toggle last
            (#778): no flyouts, so each tool is one control. */}
        <ui.View direction="column" gap="sm" align="center">
          {TOOL_BELT.map((entry) => (
            <ui.IconButton
              key={entry.tool}
              label={t(entry.label)}
              icon={entry.icon}
              isSelected={snapshot.tool === entry.tool}
              onPress={() => editor.setTool(entry.tool)}
            />
          ))}
          <ui.IconButton
            label={t("chrome.layers")}
            icon="layers"
            isSelected={layersOpen}
            onPress={() => setLayersOpen((open) => !open)}
          />
        </ui.View>

        {/* 3: the Insert card. It is a positioned card beside the belt, not a
            Popover, so the Insert tool stays picked while it shows (#778). */}
        <ui.View direction="column" gap="sm">
          {snapshot.tool === "insert" ? (
            <>
              <ui.Select
                label={t("properties.stamp")}
                options={stampOptions}
                selectedKey={snapshot.currentStampId}
                onChange={(event) => editor.setStamp(event.detail)}
              />
              <ui.NumberField
                label={t("properties.stamp.newSize")}
                value={snapshot.currentStampSize}
                minValue={MIN_STAMP_SIZE_MM}
                onChange={(event) => editor.setStampSize(event.detail)}
              />
              {/* The keyboard paths: the Stamp lands at the view centre (#749),
                  and a Map Label is not a Stamp, so it takes its own (#751). */}
              <ui.IconButton
                label={format(t("properties.placeStamp"), {
                  stamp: stampLabel(snapshot.currentStampId),
                })}
                icon="stamp"
                onPress={() => editor.insertStamp()}
              />
              <ui.IconButton
                label={t("properties.mapLabel.place")}
                icon="type"
                onPress={() => editor.insertLabel()}
              />
              {/* An upload joins the Library, then lands at the view centre as a
                  Custom Stamp or a Map Image (#756). */}
              <ui.Checkbox
                label={t("properties.asMapImage")}
                isSelected={asMapImage}
                onChange={(event) => setAsMapImage(event.detail)}
              />
              <ui.IconButton
                label={t("properties.upload")}
                icon="upload"
                onPress={() => void uploadPicture()}
              />
              {uploadError === null ? null : <ui.Status tone="warning">{uploadError}</ui.Status>}
            </>
          ) : null}
        </ui.View>

        {/* 4: the Layers card, closed until the author asks for it (#778). It
            keeps the Elements list's row menus as they were. */}
        <ui.View direction="column" gap="sm">
          {layersOpen ? (
            <ui.Collection
              label={t("elements.label")}
              selectionMode="single"
              selectedKeys={snapshot.selectedId === null ? [] : [snapshot.selectedId]}
              onSelectionChange={(event) => editor.select(event.detail[0] ?? null)}
            >
              {rows.map((element) => (
                <ui.CollectionRow
                  key={element.id}
                  id={element.id}
                  label={element.name}
                  description={describe(element, t)}
                  menuItems={menuItems(element)}
                  onMenuAction={(event) => menuAction(element, event.detail)}
                />
              ))}
            </ui.Collection>
          ) : null}
        </ui.View>

        {/* 5: the drawing, which fills the page body under the cards. It sits
            in a View of its own so the eight slots hold their places even where
            the host draws no Frame (a kit mount, or a platform with Frames off),
            which is what the stylesheet's slot rules and their guard rely on. */}
        <ui.View direction="column" gap="none">
          <ui.Frame src={MAP_FRAME_SRC} title={t("map.frameTitle")} fill />
        </ui.View>

        {/* 6: the Properties card, under the top-right pill. */}
        <ui.View direction="column" gap="sm">
          {showProperties ? (
            propertiesMinimised ? (
              <ui.IconButton
                label={t("chrome.restoreProperties")}
                icon="panel-right-open"
                onPress={() => setPropertiesMinimised(false)}
              />
            ) : (
              <>
                <ui.Text weight="semibold">{t("properties.label")}</ui.Text>
                {/* The header (#778): the selection's name, its Hidden and Locked
                    switches, and the Minimise button. */}
                <ui.View direction="row" gap="sm" align="center" justify="between" wrap>
                  <ui.View direction="row" gap="sm" align="center" wrap>
                    {selected === null ? null : (
                      <ui.TextField
                        key={`properties-name-${propertiesFocus}`}
                        label={t("properties.name")}
                        value={selected.name}
                        isRequired
                        autoFocus={propertiesFocus > 0}
                        onChange={(event) => editor.rename(selected.id, event.detail)}
                      />
                    )}
                    {selected === null ? null : (
                      <ui.Switch
                        label={t("properties.hidden")}
                        isSelected={selected.hidden}
                        onChange={(event) => editor.setHidden(selected.id, event.detail)}
                      />
                    )}
                    {selected === null ? null : (
                      <ui.Switch
                        label={t("properties.locked")}
                        isSelected={selected.locked}
                        onChange={(event) => editor.setLocked(selected.id, event.detail)}
                      />
                    )}
                  </ui.View>
                  <ui.IconButton
                    label={t("chrome.minimiseProperties")}
                    icon="chevrons-up"
                    onPress={() => setPropertiesMinimised(true)}
                  />
                </ui.View>

                {/* With no Map Line selected the select shows the style a new Pen
                    line takes; picking one then only sets that current style (#746). */}
                <ui.Select
                  label={t("properties.lineStyle")}
                  options={LINE_STYLE_IDS.map((style) => ({
                    value: style,
                    label: t(LINE_STYLE_KEYS[style]),
                  }))}
                  selectedKey={snapshot.selectedLineStyle ?? snapshot.currentLineStyle}
                  onChange={(event) => editor.setLineStyle(event.detail as LineStyleId)}
                />
                {/* One Fill color control (#748): while the Bucket is active it
                    holds the colour the next pour uses, and otherwise it edits the
                    selected Fill, which a locked Fill refuses. */}
                {showFillColor ? (
                  <ui.ColorPicker
                    label={t("properties.fillColor")}
                    value={fillColor === null ? undefined : resolveColor(style, fillColor, "land")}
                    swatches={styleSwatches(style)}
                    isDisabled={!pouring && selected?.locked === true}
                    onChange={(event) =>
                      pouring || selected === null
                        ? editor.setFillColor(event.detail)
                        : editor.setElementFillColor(selected.id, event.detail)
                    }
                  />
                ) : null}
                {selected === null ? (
                  <ui.Text tone="muted">{t("properties.empty")}</ui.Text>
                ) : (
                  <>
                    {shape === null ? null : (
                      <>
                        <ui.NumberField
                          label={t("properties.shape.centerX")}
                          value={shape.cx}
                          isDisabled={selected.locked}
                          onChange={(event) =>
                            editor.setShapeGeometry(selected.id, { cx: event.detail })
                          }
                        />
                        <ui.NumberField
                          label={t("properties.shape.centerY")}
                          value={shape.cy}
                          isDisabled={selected.locked}
                          onChange={(event) =>
                            editor.setShapeGeometry(selected.id, { cy: event.detail })
                          }
                        />
                        <ui.NumberField
                          label={t("properties.shape.width")}
                          value={shape.width}
                          minValue={MIN_SHAPE_SIZE_MM}
                          isDisabled={selected.locked}
                          onChange={(event) =>
                            editor.setShapeGeometry(selected.id, { width: event.detail })
                          }
                        />
                        <ui.NumberField
                          label={t("properties.shape.height")}
                          value={shape.height}
                          minValue={MIN_SHAPE_SIZE_MM}
                          isDisabled={selected.locked}
                          onChange={(event) =>
                            editor.setShapeGeometry(selected.id, { height: event.detail })
                          }
                        />
                        <ui.NumberField
                          label={t("properties.shape.rotation")}
                          value={shape.rotation}
                          isDisabled={selected.locked}
                          onChange={(event) =>
                            editor.setShapeGeometry(selected.id, { rotation: event.detail })
                          }
                        />
                        {shape.kind === "polygon" ? (
                          <ui.NumberField
                            label={t("properties.shape.sides")}
                            value={shape.sides}
                            minValue={MIN_POLYGON_SIDES}
                            maxValue={MAX_POLYGON_SIDES}
                            step={1}
                            isDisabled={selected.locked}
                            onChange={(event) =>
                              editor.setShapeGeometry(selected.id, { sides: event.detail })
                            }
                          />
                        ) : null}
                        {shape.kind === "rectangle" ? (
                          <ui.NumberField
                            label={t("properties.shape.cornerRadius")}
                            value={shape.cornerRadius}
                            minValue={0}
                            isDisabled={selected.locked}
                            onChange={(event) =>
                              editor.setShapeGeometry(selected.id, { cornerRadius: event.detail })
                            }
                          />
                        ) : null}
                      </>
                    )}
                    {snapshot.selectedConvertedFrom === null ? null : (
                      <ui.Text tone="muted">
                        {t(CONVERTED_KEYS[snapshot.selectedConvertedFrom])}
                      </ui.Text>
                    )}
                    {stamp === null ? null : (
                      <>
                        <ui.NumberField
                          label={t("properties.stamp.x")}
                          value={stamp.transform.x}
                          isDisabled={selected.locked}
                          onChange={(event) =>
                            editor.setStampTransform(selected.id, { x: event.detail })
                          }
                        />
                        <ui.NumberField
                          label={t("properties.stamp.y")}
                          value={stamp.transform.y}
                          isDisabled={selected.locked}
                          onChange={(event) =>
                            editor.setStampTransform(selected.id, { y: event.detail })
                          }
                        />
                        {/* The scale bar's size is the room its bar may draw in, so
                            that field reads as the longest bar it can label. */}
                        <ui.NumberField
                          label={
                            stamp.scale === undefined
                              ? t("properties.stamp.size")
                              : t("properties.stamp.maxLength")
                          }
                          value={stamp.transform.size}
                          minValue={MIN_STAMP_SIZE_MM}
                          isDisabled={selected.locked}
                          onChange={(event) =>
                            editor.setStampTransform(selected.id, { size: event.detail })
                          }
                        />
                        <ui.NumberField
                          label={t("properties.stamp.rotation")}
                          value={stamp.transform.rotation}
                          isDisabled={selected.locked}
                          onChange={(event) =>
                            editor.setStampTransform(selected.id, { rotation: event.detail })
                          }
                        />
                        {/* Only art that leaves its fill to the Stamp recolours. */}
                        {stampRecolours(stamp.stampRef) ? (
                          <ui.ColorPicker
                            label={t("properties.stamp.color")}
                            value={resolveColor(style, stamp.color, "ink")}
                            swatches={styleSwatches(style)}
                            isDisabled={selected.locked}
                            onChange={(event) => editor.setStampColor(selected.id, event.detail)}
                          />
                        ) : null}
                        {stamp.scale === undefined ? null : (
                          <>
                            <ui.RadioGroup
                              label={t("properties.stamp.unit")}
                              orientation="horizontal"
                              options={STAMP_SCALE_UNITS.map((unit) => ({
                                value: unit,
                                label: t(STAMP_UNIT_KEYS[unit]),
                              }))}
                              selectedKey={stamp.scale.unit}
                              isDisabled={selected.locked}
                              onChange={(event) =>
                                editor.setStampScale(selected.id, {
                                  unit: event.detail as StampScaleUnit,
                                })
                              }
                            />
                            {/* A page width standing for no distance reads no bar, so
                                the field's minimum is the smallest span the model keeps. */}
                            <ui.NumberField
                              label={t("properties.stamp.span")}
                              value={stamp.scale.span}
                              minValue={1}
                              isDisabled={selected.locked}
                              onChange={(event) =>
                                editor.setStampScale(selected.id, { span: event.detail })
                              }
                            />
                          </>
                        )}
                      </>
                    )}
                    {image === null ? null : (
                      <>
                        <ui.NumberField
                          label={t("properties.image.size")}
                          value={image.transform.size}
                          minValue={MIN_STAMP_SIZE_MM}
                          isDisabled={selected.locked}
                          onChange={(event) => editor.setImageSize(selected.id, event.detail)}
                        />
                        {/* The slider reads a whole percentage; the model keeps a
                            fraction from 0.05 to 1. */}
                        <ui.Slider
                          label={t("properties.image.opacity")}
                          value={Math.round(image.opacity * 100)}
                          minValue={Math.round(MIN_IMAGE_OPACITY * 100)}
                          maxValue={Math.round(MAX_IMAGE_OPACITY * 100)}
                          step={1}
                          isDisabled={selected.locked}
                          onChange={(event) =>
                            editor.setImageOpacity(selected.id, event.detail / 100)
                          }
                        />
                        <ui.Switch
                          label={t("properties.image.exportable")}
                          isSelected={image.exportable}
                          isDisabled={selected.locked}
                          onChange={(event) => editor.setImageExportable(selected.id, event.detail)}
                        />
                      </>
                    )}
                    {label === null ? null : (
                      <>
                        <ui.TextField
                          label={t("properties.mapLabel.text")}
                          value={label.text}
                          isDisabled={selected.locked}
                          onChange={(event) => editor.setLabelText(selected.id, event.detail)}
                        />
                        <ui.Select
                          label={t("properties.mapLabel.font")}
                          options={LABEL_FONT_IDS.map((font) => ({
                            value: font,
                            label:
                              font === "pdf"
                                ? snapshot.pdfFontFamily === null
                                  ? t("font.pdfNotInstalled")
                                  : format(t("font.pdfInstalled"), {
                                      family: snapshot.pdfFontFamily,
                                    })
                                : t(LABEL_FONT_KEYS[font]),
                          }))}
                          selectedKey={label.font}
                          isDisabled={selected.locked}
                          onChange={(event) =>
                            editor.setLabelFont(selected.id, event.detail as MapLabelFont)
                          }
                        />
                        <ui.NumberField
                          label={t("properties.mapLabel.size")}
                          value={label.size}
                          minValue={MIN_LABEL_SIZE_MM}
                          isDisabled={selected.locked}
                          onChange={(event) =>
                            editor.setLabelLayout(selected.id, { size: event.detail })
                          }
                        />
                        <ui.NumberField
                          label={t("properties.mapLabel.letterSpacing")}
                          value={label.letterSpacing}
                          isDisabled={selected.locked}
                          onChange={(event) =>
                            editor.setLabelLayout(selected.id, { letterSpacing: event.detail })
                          }
                        />
                        <ui.NumberField
                          label={t("properties.mapLabel.halo")}
                          value={label.halo}
                          minValue={0}
                          isDisabled={selected.locked}
                          onChange={(event) =>
                            editor.setLabelLayout(selected.id, { halo: event.detail })
                          }
                        />
                        {/* With no colour of its own the label draws in the Style's
                            label ink, which is what the picker shows until the author
                            picks. */}
                        <ui.ColorPicker
                          label={t("properties.mapLabel.color")}
                          value={resolveColor(style, label.color, "label")}
                          swatches={styleSwatches(style)}
                          isDisabled={selected.locked}
                          onChange={(event) => editor.setLabelColor(selected.id, event.detail)}
                        />
                        <ui.NumberField
                          label={t("properties.mapLabel.x")}
                          value={label.x}
                          isDisabled={selected.locked}
                          onChange={(event) =>
                            editor.setLabelLayout(selected.id, { x: event.detail })
                          }
                        />
                        <ui.NumberField
                          label={t("properties.mapLabel.y")}
                          value={label.y}
                          isDisabled={selected.locked}
                          onChange={(event) =>
                            editor.setLabelLayout(selected.id, { y: event.detail })
                          }
                        />
                        <ui.NumberField
                          label={t("properties.mapLabel.rotation")}
                          value={label.rotation}
                          isDisabled={selected.locked}
                          onChange={(event) =>
                            editor.setLabelLayout(selected.id, { rotation: event.detail })
                          }
                        />
                        <ui.NumberField
                          label={t("properties.mapLabel.width")}
                          value={label.width}
                          minValue={MIN_LABEL_WIDTH_MM}
                          isDisabled={selected.locked}
                          onChange={(event) =>
                            editor.setLabelLayout(selected.id, { width: event.detail })
                          }
                        />
                        {/* Bend is the curve: 0 draws the baseline straight. */}
                        <ui.NumberField
                          label={t("properties.mapLabel.bend")}
                          value={label.bend}
                          isDisabled={selected.locked}
                          onChange={(event) =>
                            editor.setLabelLayout(selected.id, { bend: event.detail })
                          }
                        />
                      </>
                    )}
                    {snapshot.selectedIsLine ? (
                      <ui.Switch
                        label={t("properties.enclosesFills")}
                        isSelected={snapshot.selectedEnclosesFills ?? false}
                        onChange={(event) => editor.setEnclosesFills(selected.id, event.detail)}
                      />
                    ) : null}
                    {selectedLine === null ? null : (
                      <ui.ColorPicker
                        label={t("properties.mapLine.color")}
                        value={resolveColor(
                          style,
                          selectedLine.color,
                          lineRole(selectedLine.style)
                        )}
                        swatches={styleSwatches(style)}
                        isDisabled={selected.locked}
                        onChange={(event) => editor.setLineColor(selectedLine.id, event.detail)}
                      />
                    )}
                    {snapshot.selectedIsLine || snapshot.selectedIsFill ? (
                      <>
                        <ui.Switch
                          label={t("properties.softEdge")}
                          isSelected={snapshot.selectedSoftEdge !== null}
                          isDisabled={selected.locked}
                          onChange={(event) =>
                            editor.setSoftEdge(
                              selected.id,
                              event.detail ? DEFAULT_SOFT_EDGE_MM : null
                            )
                          }
                        />
                        {/* The amount stays mounted while an Element is selected, so a
                            change of selection updates it in place; the host keeps the
                            value it mounted with when a control is replaced at its
                            slot. Moving it also turns the Soft Edge on. */}
                        <ui.Slider
                          label={t("properties.softEdgeAmount")}
                          value={snapshot.selectedSoftEdge ?? DEFAULT_SOFT_EDGE_MM}
                          minValue={MIN_SOFT_EDGE_MM}
                          maxValue={MAX_SOFT_EDGE_MM}
                          step={SOFT_EDGE_STEP_MM}
                          isDisabled={selected.locked}
                          onChange={(event) => editor.setSoftEdge(selected.id, event.detail)}
                        />
                      </>
                    ) : null}
                    {snapshot.selectedIsFill ? (
                      <>
                        {/* A Fill covers some of a colour, a texture, and a scatter of
                            Stamps, in any combination; the last kind cannot go. */}
                        <ui.Select
                          label={t("properties.fillTexture")}
                          options={[
                            { value: NONE, label: t("properties.none") },
                            ...TEXTURE_IDS.map((id) => ({ value: id, label: t(TEXTURE_KEYS[id]) })),
                          ]}
                          selectedKey={snapshot.selectedFillTexture ?? NONE}
                          isDisabled={selected.locked}
                          onChange={(event) =>
                            editor.setFillTexture(
                              selected.id,
                              event.detail === NONE ? null : event.detail
                            )
                          }
                        />
                        <ui.Select
                          label={t("properties.fillScatter")}
                          options={[
                            { value: NONE, label: t("properties.none") },
                            ...BASE_STAMP_IDS.map((id) => ({
                              value: id,
                              label: t(stampNameKey(id)),
                            })),
                          ]}
                          selectedKey={scatterStampId ?? NONE}
                          isDisabled={selected.locked}
                          onChange={(event) =>
                            editor.setFillScatter(
                              selected.id,
                              event.detail === NONE ? null : event.detail
                            )
                          }
                        />
                        {scatter === null ? null : (
                          <ui.Slider
                            label={t("properties.scatterSpacing")}
                            value={scatter.spacing}
                            minValue={MIN_SCATTER_SPACING_MM}
                            maxValue={MAX_SCATTER_SPACING_MM}
                            isDisabled={selected.locked}
                            onChange={(event) =>
                              editor.setFillScatterSpacing(selected.id, event.detail)
                            }
                          />
                        )}
                        {/* A Custom Fill paints a Library texture or scatters Custom
                            Stamps over the area (#756). */}
                        <ui.Select
                          label={t("properties.customFill")}
                          options={fitOptions(
                            [
                              { value: NONE, label: t("properties.none") },
                              ...[...snapshot.library.customFills.values()].map((customFill) => ({
                                value: customFill.id,
                                label: customFill.name,
                              })),
                            ],
                            selectedFill?.content.customFill ?? NONE
                          )}
                          selectedKey={selectedFill?.content.customFill ?? NONE}
                          isDisabled={selected.locked}
                          onChange={(event) =>
                            editor.setFillCustomFill(
                              selected.id,
                              event.detail === NONE ? null : event.detail
                            )
                          }
                        />
                        <ui.Text weight="semibold">{t("properties.newCustomFill")}</ui.Text>
                        <ui.Button
                          variant="secondary"
                          isDisabled={selected.locked}
                          onPress={() => void createFillFromTexture()}
                        >
                          {t("properties.customFill.texture")}
                        </ui.Button>
                        {customStamps.length === 0 ? null : (
                          <>
                            <ui.Collection
                              label={t("properties.customFill.stamps")}
                              selectionMode="multiple"
                              selectedKeys={fillStampRefs}
                              onSelectionChange={(event) => setFillStampRefs([...event.detail])}
                            >
                              {fillStampRows.map((customStamp) => (
                                <ui.CollectionRow
                                  key={customStamp.ref}
                                  id={customStamp.ref}
                                  label={clampLabel(customStamp.name)}
                                />
                              ))}
                            </ui.Collection>
                            <ui.Button
                              variant="secondary"
                              isDisabled={selected.locked || fillStampRefs.length === 0}
                              onPress={() => void createFillFromStamps()}
                            >
                              {t("properties.customFill.create")}
                            </ui.Button>
                          </>
                        )}
                      </>
                    ) : null}
                  </>
                )}

                {/* The footer: the card's one-off actions, as icons (#778). */}
                <ui.View direction="row" gap="sm" align="center" wrap>
                  {/* The path back to the Map Style's colour (#752), offered by
                      every Element that overrides a role. */}
                  {useMapStyleColorTarget === null ? null : (
                    <ui.IconButton
                      label={t("properties.useMapStyleColor")}
                      icon="paintbrush"
                      isDisabled={
                        selected?.locked === true || followsStyle(useMapStyleColorTarget.color)
                      }
                      onPress={() =>
                        selected === null ? undefined : editor.clearElementColor(selected.id)
                      }
                    />
                  )}
                  {/* The keyboard path that places a Shape (#747). */}
                  {shapeTool === null ? null : (
                    <ui.IconButton
                      label={t(PLACE_SHAPE_KEYS[shapeTool])}
                      icon={SHAPE_TOOL_ICONS[shapeTool]}
                      onPress={() => editor.placeShape(shapeTool)}
                    />
                  )}
                  {/* The same Stamps land in new spots, so the author can scatter
                      again without picking a different Stamp. */}
                  {scatter === null || selected === null ? null : (
                    <ui.IconButton
                      label={t("properties.reseed")}
                      icon="dices"
                      isDisabled={selected.locked}
                      onPress={() => editor.reseedFillScatter(selected.id)}
                    />
                  )}
                  {snapshot.selectedIsLine || snapshot.selectedIsAreaFill ? (
                    <>
                      <ui.IconButton
                        label={t("properties.roughen")}
                        icon="waves"
                        onPress={() => editor.roughen()}
                      />
                      <ui.Slider
                        label={t("properties.roughenStrength")}
                        value={snapshot.roughenStrength}
                        minValue={MIN_ROUGHEN_STRENGTH_MM}
                        maxValue={MAX_ROUGHEN_STRENGTH_MM}
                        step={0.1}
                        onChange={(event) => editor.setRoughenStrength(event.detail)}
                      />
                    </>
                  ) : null}
                </ui.View>
              </>
            )
          ) : null}
        </ui.View>

        {/* 7: the top-right pill. Map Style and Export are icon-only Popovers;
            Place opens its dialog (#778). */}
        <ui.View direction="row" gap="sm" align="center">
          <ui.Popover label={t("properties.mapStyle")} icon="palette" iconOnly>
            {/* The Map Style is Map-level: it recolours everything that follows a
                role, and leaves every colour an Element overrides alone (#752). */}
            <ui.RadioGroup
              label={t("properties.mapStyle")}
              orientation="vertical"
              options={MAP_STYLE_IDS.map((styleId) => ({
                value: styleId,
                label: t(MAP_STYLE_KEYS[styleId]),
              }))}
              selectedKey={snapshot.styleId}
              onChange={(event) => editor.setMapStyle(event.detail as MapStyleId)}
            />
          </ui.Popover>
          {/* Place copies the Map into a Chapter or Note as an image (#753);
              the dialog holds the target picker and the alt text. */}
          <ui.IconButton
            label={t("place.label")}
            icon="file-image"
            onPress={() => void openPlace()}
          />
          {placeFailed ? <ui.Status tone="warning">{t("place.failed")}</ui.Status> : null}
          {/* Export (#753): PNG at a chosen print size and DPI, drawn by the
              Frame which alone has a canvas, or the SVG itself. The panel is
              the keyboard path that saves either picture. */}
          <ui.Popover label={t("export.label")} icon="download" iconOnly>
            <ui.View direction="column" gap="sm">
              <ui.RadioGroup
                label={t("export.format")}
                orientation="horizontal"
                options={[
                  { value: "png", label: t("export.format.png") },
                  { value: "svg", label: t("export.format.svg") },
                ]}
                selectedKey={exportFormat}
                onChange={(event) => setExportFormat(event.detail as "png" | "svg")}
              />
              {exportFormat === "png" ? (
                <>
                  <ui.NumberField
                    label={t("export.printWidth")}
                    value={printWidthIn}
                    minValue={MIN_PRINT_WIDTH_IN}
                    maxValue={MAX_PRINT_WIDTH_IN}
                    step={0.1}
                    onChange={(event) => setPrintWidth(event.detail)}
                  />
                  {/* The DPI the canvas can still encode at this print width: 40 in
                      at 1200 DPI would be 48000x72000 px, which nothing draws. */}
                  <ui.NumberField
                    label={t("export.dpi")}
                    value={dpi}
                    minValue={MIN_DPI}
                    maxValue={dpiLimit}
                    step={1}
                    onChange={(event) => setDpi(event.detail)}
                  />
                  <ui.Text tone="muted">
                    {format(t("export.size"), {
                      width: exportSize.widthPx,
                      height: exportSize.heightPx,
                      heightIn: printHeightIn,
                    })}
                  </ui.Text>
                </>
              ) : null}
              <ui.Button variant="secondary" onPress={() => void saveExport()}>
                {t("export.save")}
              </ui.Button>
              {exportFailed ? <ui.Status tone="warning">{t("export.failed")}</ui.Status> : null}
            </ui.View>
          </ui.Popover>
        </ui.View>

        {/* 8: the zoom cluster. Reset zoom is fit, so the design's separate Fit
            button is dropped (#778). */}
        <ui.View direction="row" gap="sm" align="center">
          <ui.IconButton
            label={t("chrome.zoomOut")}
            icon="zoom-out"
            onPress={() => editor.zoomOut()}
          />
          <ui.Button variant="ghost" onPress={() => editor.zoomReset()}>
            {format(t("chrome.zoom"), { percent: zoomPercent })}
          </ui.Button>
          <ui.IconButton
            label={t("chrome.zoomIn")}
            icon="zoom-in"
            onPress={() => editor.zoomIn()}
          />
        </ui.View>
      </ui.Surface>

      <ui.Modal
        title={t("place.title")}
        isOpen={placeOpen}
        onOpenChange={(event) => {
          if (!event.detail) setPlaceOpen(false);
        }}
      >
        {placeOpen ? (
          <ui.View direction="column" gap="md">
            {placeTargets === null ? (
              <ui.Text tone="muted">{t("place.loading")}</ui.Text>
            ) : (
              <ui.Select
                label={t("place.target")}
                options={placeTargetOptions(placeTargets, placeTargetId)}
                selectedKey={placeTargetId ?? undefined}
                onChange={(event) => setPlaceTargetId(event.detail)}
              />
            )}
            {/* The alt text is bounded (#753): its escaped form then always fits
                the insert message's envelope margin beside the picture. */}
            <ui.TextField
              label={t("place.alt")}
              value={placeAlt}
              onInput={(event) => setPlaceAlt(altText(event.detail))}
            />
            <ui.View direction="row" gap="sm" justify="end">
              <ui.Button variant="secondary" onPress={() => setPlaceOpen(false)}>
                {t("place.cancel")}
              </ui.Button>
              <ui.Button
                variant="primary"
                isDisabled={placeTargets === null || placeTargetId === null}
                onPress={() => void submitPlace()}
              >
                {t("place.submit")}
              </ui.Button>
            </ui.View>
          </ui.View>
        ) : null}
      </ui.Modal>

      <ui.Modal
        title={t("properties.renameTitle")}
        isOpen={dialog !== null}
        onOpenChange={(event) => {
          if (!event.detail) setDialog(null);
        }}
      >
        {dialog === null ? null : (
          <ui.View direction="column" gap="md">
            <ui.TextField
              label={t("properties.name")}
              value={dialog.name}
              autoFocus
              isRequired
              onInput={(event) =>
                setDialog((current) =>
                  current === null ? null : { ...current, name: event.detail }
                )
              }
            />
            <ui.View direction="row" gap="sm" justify="end">
              <ui.Button variant="secondary" onPress={() => setDialog(null)}>
                {t("properties.cancel")}
              </ui.Button>
              <ui.Button variant="primary" onPress={submitRename}>
                {t("properties.renameSubmit")}
              </ui.Button>
            </ui.View>
          </ui.View>
        )}
      </ui.Modal>

      {/* The Map's own name, renamed from the top-left pill (#778). */}
      <ui.Modal
        title={t("rename.title")}
        isOpen={mapRename !== null}
        onOpenChange={(event) => {
          if (!event.detail) setMapRename(null);
        }}
      >
        {mapRename === null ? null : (
          <ui.View direction="column" gap="md">
            <ui.TextField
              label={t("properties.name")}
              value={mapRename}
              autoFocus
              isRequired
              onInput={(event) => setMapRename(event.detail)}
            />
            <ui.View direction="row" gap="sm" justify="end">
              <ui.Button variant="secondary" onPress={() => setMapRename(null)}>
                {t("dialog.cancel")}
              </ui.Button>
              <ui.Button
                variant="primary"
                isDisabled={mapRename.trim() === ""}
                onPress={submitMapRename}
              >
                {t("rename.submit")}
              </ui.Button>
            </ui.View>
          </ui.View>
        )}
      </ui.Modal>
    </ui.Surface>
  );
}

export function createMapPage(deps: MapPageDeps): ComponentType {
  const { client, runtime, backToMaps } = deps;
  /**
   * The Library's uploaded pictures (#756), read and written through the same
   * Plugin storage the Maps store uses. The page holds one, so every Map opened
   * while it is mounted draws from the same Library.
   */
  const assets = createAssetStore(client.storage);

  return function MapPage() {
    const language = useLanguage(client);
    const editor = runtime.editor;

    // The pictures, and the Custom Fills built from them, reach the editor once
    // the Library has loaded: it draws them, sends a Frame the bytes of the few
    // the Map names, and embeds them in an exported SVG (#756).
    useEffect(() => {
      if (editor === null) return;
      let live = true;
      void Promise.all([assets.listAssets(), assets.listCustomFills()])
        .then(([index, customFills]) => {
          if (!live) return;
          editor.setAssetLibrary({
            library: mapLibrary(index, customFills),
            load: (id) => assets.getAsset(id),
          });
        })
        .catch(() => {
          // A Library that will not load leaves the pictures out; the Map still
          // draws everything else.
        });
      return () => {
        live = false;
      };
    }, [editor]);

    /** Lists the Library again, so an upload or a new Custom Fill reaches every Map. */
    async function refreshLibrary(): Promise<void> {
      if (editor === null) return;
      const [index, customFills] = await Promise.all([
        assets.listAssets(),
        assets.listCustomFills(),
      ]);
      editor.setAssetLibrary({
        library: mapLibrary(index, customFills),
        load: (id) => assets.getAsset(id),
      });
    }

    async function pickAsset(use: AssetUse): Promise<MapAsset | null> {
      if (editor === null) return null;
      const asset = await pickAndSaveAsset(client, editor, assets, use);
      if (asset !== null) await refreshLibrary();
      return asset;
    }

    async function saveCustomFill(fill: CustomFill): Promise<void> {
      await assets.saveCustomFill(fill);
      await refreshLibrary();
    }

    const t = (key: MapsKey) => translate(language, key);
    if (editor === null) {
      return (
        <ui.EmptyState
          title={t("map.emptyTitle")}
          description={t("map.emptyDescription")}
          icon="map"
        >
          <ui.Button variant="primary" onPress={() => void backToMaps()}>
            {t("map.backToMaps")}
          </ui.Button>
        </ui.EmptyState>
      );
    }
    return (
      <MapEditorView
        editor={editor}
        t={t}
        backToMaps={backToMaps}
        save={(options) =>
          saveMapImage({ client, editor, exportFonts: runtime.exportFonts }, options)
        }
        place={{
          listTargets: () => listPlaceTargets(client, editor.getSnapshot().doc),
          prepare: (alt) => preparePlace({ editor, exportFonts: runtime.exportFonts }, alt),
          finish: (target, image) => finishPlace(client, target, image),
          notifyFailed: async () => {
            await client.notifications.show({ variant: "error", message: t("place.failed") });
          },
        }}
        pickAsset={pickAsset}
        saveCustomFill={saveCustomFill}
      />
    );
  };
}
