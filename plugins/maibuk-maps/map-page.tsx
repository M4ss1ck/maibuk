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
import { ui, type PluginClient } from "@/plugin-sdk";
import {
  DEFAULT_SOFT_EDGE_MM,
  MAX_ROUGHEN_STRENGTH_MM,
  MAX_SOFT_EDGE_MM,
  MIN_ROUGHEN_STRENGTH_MM,
  MIN_SOFT_EDGE_MM,
  SOFT_EDGE_STEP_MM,
  type MapEditor,
} from "./editor";
import type { MapTool } from "./frame-protocol";
import { format, translate, type MapsKey } from "./i18n";
import type { MapsRuntime } from "./runtime";
import { useLanguage } from "./maps-page";
import {
  LINE_STYLE_IDS,
  MAX_POLYGON_SIDES,
  MIN_POLYGON_SIDES,
  MIN_SHAPE_SIZE_MM,
  MIN_STAMP_SIZE_MM,
  SHAPE_KINDS,
  STAMP_SCALE_UNITS,
  isShapeKind,
  type LineStyleId,
  type MapElement,
  type ShapeKind,
  type StampScaleUnit,
} from "./maps";
import { MAX_SCATTER_SPACING_MM, MIN_SCATTER_SPACING_MM } from "./scatter";
import { BASE_STAMP_IDS, baseStampRef, stampNameKey, stampTakesColour } from "./stamps";
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
  runtime: Pick<MapsRuntime, "editor" | "currentMapId">;
  /** Flushes autosave and opens the Maps list. */
  backToMaps(): Promise<void>;
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

/**
 * The Elements list's kind label, for the kinds a Map can hold (#748: a Fill
 * joins a Map Line; #749: a Stamp joins them). A kind with no label of its own
 * says nothing, so the row falls back to its flags alone rather than calling
 * itself a Map Line.
 */
const ELEMENT_KIND_KEYS: Readonly<Partial<Record<MapElement["kind"], MapsKey>>> = {
  line: "element.kind.line",
  fill: "element.kind.fill",
  stamp: "element.kind.stamp",
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
}: {
  editor: MapEditor;
  t: (key: MapsKey) => string;
  backToMaps: () => Promise<void>;
}) {
  const snapshot = useSyncExternalStore(editor.subscribe, editor.getSnapshot);
  const [dialog, setDialog] = useState<RenameDialog | null>(null);
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
  const scatter = snapshot.selectedFillScatter;
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

  // Top of the list is the topmost Element; the document array grows upward.
  const rows = [...snapshot.elements].reverse();

  return (
    <ui.View direction="column" gap="md" grow>
      <ui.View direction="row" gap="md" align="center" justify="between" wrap>
        <ui.Text weight="semibold">{snapshot.doc.name}</ui.Text>
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
            <ui.ColorPicker
              label={t("properties.fillColor")}
              value={fillColor ?? snapshot.currentFillColor}
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
                    <ui.ColorPicker
                      label={t("properties.stamp.color")}
                      value={stamp.color}
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
              {snapshot.selectedIsLine ? (
                <ui.Switch
                  label={t("properties.enclosesFills")}
                  isSelected={snapshot.selectedEnclosesFills ?? false}
                  onChange={(event) => editor.setEnclosesFills(selected.id, event.detail)}
                />
              ) : null}
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
        </ui.View>
      </ui.View>

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
    return <MapEditorView editor={editor} t={t} backToMaps={backToMaps} />;
  };
}
