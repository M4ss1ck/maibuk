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
import { PLUGIN_UI_LIMITS, ui, type PluginClient } from "@/plugin-sdk";
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
  MAX_POLYGON_SIDES,
  MIN_LABEL_SIZE_MM,
  MIN_LABEL_WIDTH_MM,
  MIN_POLYGON_SIDES,
  MIN_SHAPE_SIZE_MM,
  MIN_STAMP_SIZE_MM,
  SHAPE_KINDS,
  STAMP_SCALE_UNITS,
  isShapeKind,
  type LineStyleId,
  type MapDocument,
  type MapElement,
  type MapLabelFont,
  type ShapeKind,
  type StampScaleUnit,
} from "./maps";
import { MAX_SCATTER_SPACING_MM, MIN_SCATTER_SPACING_MM } from "./scatter";
import { BASE_STAMP_IDS, baseStampRef, stampNameKey, stampTakesColour } from "./stamps";
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
 * fonts embedded, or a PNG rasterized in the Frame at the chosen print size and
 * DPI. A save the author cancels writes nothing and logs nothing; a saved
 * picture logs exactly one line with its format, pixel size, and bytes.
 */
async function saveMapImage(
  { client, editor, exportFonts }: MapPictureDeps,
  { format: pictureFormat, printWidthIn, dpi }: SaveImageOptions
): Promise<void> {
  const doc = editor.getSnapshot().doc;
  const fonts = await exportFonts();

  if (pictureFormat === "svg") {
    const bytes = new TextEncoder().encode(exportSvg(doc, fonts));
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
  const svg = svgAtPixelSize(exportSvg(doc, fonts), size);
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
 * The target picker's options (#753): a Library past the host's
 * {@link PLUGIN_UI_LIMITS.maxOptions} loses the tail of its list, never the
 * page, and every label is clamped, since a Chapter title is the author's text.
 * The target already picked keeps its place, the last one kept making room.
 */
function placeTargetOptions(
  targets: readonly PlaceTarget[],
  selectedId: string | null
): Array<{ value: string; label: string }> {
  const kept = targets.slice(0, PLUGIN_UI_LIMITS.maxOptions);
  const chosen =
    selectedId === null ? undefined : targets.find((target) => target.id === selectedId);
  if (chosen !== undefined && !kept.includes(chosen)) kept[kept.length - 1] = chosen;
  return kept.map((target) => ({ value: target.id, label: clampLabel(target.label) }));
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
 * URI would be over the insert cap, with the alt text escaped. Throws
 * {@link ExportTooLargeError} when even the lowest JPEG is over the cap, before
 * anything navigates.
 */
async function preparePlace(
  { editor, exportFonts }: Pick<MapPictureDeps, "editor" | "exportFonts">,
  alt: string
): Promise<PlacedImage> {
  const doc = editor.getSnapshot().doc;
  const size = placePixelSize(doc.page);
  const svg = svgAtPixelSize(exportSvg(doc, await exportFonts()), size);
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

/** The tool picker's label for each Shape it offers, in the order it offers them. */
const SHAPE_TOOL_KEYS: Readonly<Record<ShapeKind, MapsKey>> = {
  ellipse: "tools.ellipse",
  rectangle: "tools.rectangle",
  polygon: "tools.polygon",
};

/** The Place button's label for each Shape tool. */
const PLACE_SHAPE_KEYS: Readonly<Record<ShapeKind, MapsKey>> = {
  ellipse: "properties.placeShape.ellipse",
  rectangle: "properties.placeShape.rectangle",
  polygon: "properties.placeShape.polygon",
};

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

/**
 * The button that hands one Element's colour back to the Map Style (#752):
 * every Element that overrides a role offers the same path, so it is one
 * component rather than four identical copies.
 */
function UseMapStyleColor({
  label,
  isDisabled,
  onPress,
}: {
  label: string;
  isDisabled: boolean;
  onPress: () => void;
}) {
  return (
    <ui.Button variant="secondary" isDisabled={isDisabled} onPress={onPress}>
      {label}
    </ui.Button>
  );
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
 * joins a Map Line; #749: a Stamp joins them; #751: a Map Label joins them). A
 * kind with no label of its own says nothing, so the row falls back to its
 * flags alone rather than calling itself a Map Line.
 */
const ELEMENT_KIND_KEYS: Readonly<Partial<Record<MapElement["kind"], MapsKey>>> = {
  line: "element.kind.line",
  fill: "element.kind.fill",
  stamp: "element.kind.stamp",
  label: "element.kind.label",
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

function MapEditorView({
  editor,
  t,
  backToMaps,
  save,
  place,
}: {
  editor: MapEditor;
  t: (key: MapsKey) => string;
  backToMaps: () => Promise<void>;
  save(options: SaveImageOptions): Promise<void>;
  place: PlaceCallbacks;
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
  const scatter = snapshot.selectedFillScatter;
  const style = snapshot.styleId;
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

  return (
    <ui.View direction="column" gap="md" grow>
      <ui.View direction="row" gap="md" align="center" justify="between" wrap>
        <ui.Text weight="semibold">{snapshot.doc.name}</ui.Text>
        {/* The Map Style is Map-level: it recolours everything that follows a
            role, and leaves every colour an Element overrides alone (#752). */}
        <ui.Select
          label={t("properties.mapStyle")}
          options={MAP_STYLE_IDS.map((styleId) => ({
            value: styleId,
            label: t(MAP_STYLE_KEYS[styleId]),
          }))}
          selectedKey={snapshot.styleId}
          onChange={(event) => editor.setMapStyle(event.detail as MapStyleId)}
        />
        <ui.Button variant="secondary" icon="arrow-left" onPress={() => void backToMaps()}>
          {t("map.backToMaps")}
        </ui.Button>
      </ui.View>

      {snapshot.saveFailed ? <ui.Status tone="warning">{t("map.saveFailed")}</ui.Status> : null}

      <ui.View direction="row" gap="md" align="stretch" wrap grow>
        <ui.View direction="column" gap="sm">
          <ui.RadioGroup
            label={t("tools.label")}
            orientation="vertical"
            options={[
              { value: "select", label: t("tools.select") },
              { value: "pencil", label: t("tools.pencil") },
              { value: "pen", label: t("tools.pen") },
              { value: "bucket", label: t("tools.bucket") },
              { value: "area", label: t("tools.area") },
              { value: "insert", label: t("tools.insert") },
              ...SHAPE_KINDS.map((kind) => ({ value: kind, label: t(SHAPE_TOOL_KEYS[kind]) })),
              { value: "eraser", label: t("tools.eraser") },
            ]}
            selectedKey={snapshot.tool}
            onChange={(event) => editor.setTool(event.detail as MapTool)}
          />
          {/* With a Shape tool active the Frame draws a preview from a pointer
              drag; this button is the keyboard path that places one (#747). */}
          {shapeTool === null ? null : (
            <ui.Button variant="secondary" onPress={() => editor.placeShape(shapeTool)}>
              {t(PLACE_SHAPE_KEYS[shapeTool])}
            </ui.Button>
          )}
          {/* Insert picks one Stamp and drops it where the pointer lands; the
              Place button is the keyboard path that lands it at the view
              centre (#749). Custom Stamps and Upload join this picker later. */}
          {snapshot.tool === "insert" ? (
            <>
              <ui.Select
                label={t("properties.stamp")}
                options={BASE_STAMP_IDS.map((id) => ({
                  value: id,
                  label: t(stampNameKey(id)),
                }))}
                selectedKey={snapshot.currentStampId}
                onChange={(event) => editor.setStamp(event.detail)}
              />
              <ui.Button variant="secondary" onPress={() => editor.insertStamp()}>
                {format(t("properties.placeStamp"), {
                  stamp: t(stampNameKey(snapshot.currentStampId)),
                })}
              </ui.Button>
              {/* A Map Label is not a Stamp, so it takes its own button beside
                  the Stamp picker; this is its keyboard path to the view
                  centre (#751). */}
              <ui.Button variant="secondary" onPress={() => editor.insertLabel()}>
                {t("properties.mapLabel.place")}
              </ui.Button>
            </>
          ) : null}
          <ui.Text weight="semibold">{t("elements.label")}</ui.Text>
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
        </ui.View>

        <ui.Frame src={MAP_FRAME_SRC} title={t("map.frameTitle")} fill />

        <ui.View direction="column" gap="sm">
          <ui.Text weight="semibold">{t("properties.label")}</ui.Text>
          {/* With no Map Line selected the select shows the style a new Pen line
              takes; picking one then only sets that current style (#746). */}
          <ui.Select
            label={t("properties.lineStyle")}
            options={LINE_STYLE_IDS.map((style) => ({
              value: style,
              label: t(LINE_STYLE_KEYS[style]),
            }))}
            selectedKey={snapshot.selectedLineStyle ?? snapshot.currentLineStyle}
            onChange={(event) => editor.setLineStyle(event.detail as LineStyleId)}
          />
          {/* One Fill color control (#748): while the Bucket is active it holds
              the colour the next pour uses, and otherwise it edits the selected
              Fill, which a locked Fill refuses. */}
          {showFillColor ? (
            <>
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
              {/* The Bucket's next pour holds no Element's override, so only a
                  selected Fill offers the path back to the Style's colour. */}
              {pouring || selected === null ? null : (
                <UseMapStyleColor
                  label={t("properties.useMapStyleColor")}
                  isDisabled={selected.locked || followsStyle(fillColor ?? undefined)}
                  onPress={() => editor.clearElementColor(selected.id)}
                />
              )}
            </>
          ) : null}
          {selected === null ? (
            <ui.Text tone="muted">{t("properties.empty")}</ui.Text>
          ) : (
            <>
              <ui.TextField
                key={`properties-name-${propertiesFocus}`}
                label={t("properties.name")}
                value={selected.name}
                isRequired
                autoFocus={propertiesFocus > 0}
                onChange={(event) => editor.rename(selected.id, event.detail)}
              />
              <ui.Switch
                label={t("properties.hidden")}
                isSelected={selected.hidden}
                onChange={(event) => editor.setHidden(selected.id, event.detail)}
              />
              <ui.Switch
                label={t("properties.locked")}
                isSelected={selected.locked}
                onChange={(event) => editor.setLocked(selected.id, event.detail)}
              />
              {shape === null ? null : (
                <>
                  <ui.NumberField
                    label={t("properties.shape.centerX")}
                    value={shape.cx}
                    isDisabled={selected.locked}
                    onChange={(event) => editor.setShapeGeometry(selected.id, { cx: event.detail })}
                  />
                  <ui.NumberField
                    label={t("properties.shape.centerY")}
                    value={shape.cy}
                    isDisabled={selected.locked}
                    onChange={(event) => editor.setShapeGeometry(selected.id, { cy: event.detail })}
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
                <ui.Text tone="muted">{t(CONVERTED_KEYS[snapshot.selectedConvertedFrom])}</ui.Text>
              )}
              {stamp === null ? null : (
                <>
                  <ui.NumberField
                    label={t("properties.stamp.x")}
                    value={stamp.transform.x}
                    isDisabled={selected.locked}
                    onChange={(event) => editor.setStampTransform(selected.id, { x: event.detail })}
                  />
                  <ui.NumberField
                    label={t("properties.stamp.y")}
                    value={stamp.transform.y}
                    isDisabled={selected.locked}
                    onChange={(event) => editor.setStampTransform(selected.id, { y: event.detail })}
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
                  {stampTakesColour(stamp.stampRef) ? (
                    <>
                      <ui.ColorPicker
                        label={t("properties.stamp.color")}
                        value={resolveColor(style, stamp.color, "ink")}
                        swatches={styleSwatches(style)}
                        isDisabled={selected.locked}
                        onChange={(event) => editor.setStampColor(selected.id, event.detail)}
                      />
                      <UseMapStyleColor
                        label={t("properties.useMapStyleColor")}
                        isDisabled={selected.locked || followsStyle(stamp.color)}
                        onPress={() => editor.clearElementColor(selected.id)}
                      />
                    </>
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
                            : format(t("font.pdfInstalled"), { family: snapshot.pdfFontFamily })
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
                    onChange={(event) => editor.setLabelLayout(selected.id, { size: event.detail })}
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
                    onChange={(event) => editor.setLabelLayout(selected.id, { halo: event.detail })}
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
                  <UseMapStyleColor
                    label={t("properties.useMapStyleColor")}
                    isDisabled={selected.locked || followsStyle(label.color)}
                    onPress={() => editor.clearElementColor(selected.id)}
                  />
                  <ui.NumberField
                    label={t("properties.mapLabel.x")}
                    value={label.x}
                    isDisabled={selected.locked}
                    onChange={(event) => editor.setLabelLayout(selected.id, { x: event.detail })}
                  />
                  <ui.NumberField
                    label={t("properties.mapLabel.y")}
                    value={label.y}
                    isDisabled={selected.locked}
                    onChange={(event) => editor.setLabelLayout(selected.id, { y: event.detail })}
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
                    onChange={(event) => editor.setLabelLayout(selected.id, { bend: event.detail })}
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
                <>
                  <ui.ColorPicker
                    label={t("properties.mapLine.color")}
                    value={resolveColor(style, selectedLine.color, lineRole(selectedLine.style))}
                    swatches={styleSwatches(style)}
                    isDisabled={selected.locked}
                    onChange={(event) => editor.setLineColor(selectedLine.id, event.detail)}
                  />
                  <UseMapStyleColor
                    label={t("properties.useMapStyleColor")}
                    isDisabled={selected.locked || followsStyle(selectedLine.color)}
                    onPress={() => editor.clearElementColor(selectedLine.id)}
                  />
                </>
              )}
              {snapshot.selectedIsLine || snapshot.selectedIsFill ? (
                <>
                  <ui.Switch
                    label={t("properties.softEdge")}
                    isSelected={snapshot.selectedSoftEdge !== null}
                    isDisabled={selected.locked}
                    onChange={(event) =>
                      editor.setSoftEdge(selected.id, event.detail ? DEFAULT_SOFT_EDGE_MM : null)
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
                    <>
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
                      {/* The same Stamps land in new spots, so the author can
                          scatter again without picking a different Stamp. */}
                      <ui.Button
                        variant="secondary"
                        onPress={() => editor.reseedFillScatter(selected.id)}
                      >
                        {t("properties.reseed")}
                      </ui.Button>
                    </>
                  )}
                </>
              ) : null}
              {snapshot.selectedIsLine || snapshot.selectedIsAreaFill ? (
                <>
                  <ui.Slider
                    label={t("properties.roughenStrength")}
                    value={snapshot.roughenStrength}
                    minValue={MIN_ROUGHEN_STRENGTH_MM}
                    maxValue={MAX_ROUGHEN_STRENGTH_MM}
                    step={0.1}
                    onChange={(event) => editor.setRoughenStrength(event.detail)}
                  />
                  <ui.Button variant="secondary" onPress={() => editor.roughen()}>
                    {t("properties.roughen")}
                  </ui.Button>
                </>
              ) : null}
            </>
          )}

          {/* Export (#753): PNG at a chosen print size and DPI, drawn by the
              Frame which alone has a canvas, or the SVG itself. The panel is
              the keyboard path that saves either picture. */}
          <ui.Text weight="semibold">{t("export.label")}</ui.Text>
          {/* Place copies the Map into a Chapter or Note as an image (#753);
              the dialog holds the target picker and the alt text. */}
          <ui.Button variant="secondary" onPress={() => void openPlace()}>
            {t("place.label")}
          </ui.Button>
          {placeFailed ? <ui.Status tone="warning">{t("place.failed")}</ui.Status> : null}
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
      </ui.View>

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
    </ui.View>
  );
}

export function createMapPage(deps: MapPageDeps): ComponentType {
  const { client, runtime, backToMaps } = deps;

  return function MapPage() {
    const language = useLanguage(client);
    const t = (key: MapsKey) => translate(language, key);
    const editor = runtime.editor;
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
      />
    );
  };
}
