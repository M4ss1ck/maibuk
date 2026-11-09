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
import type { MapEditor } from "./editor";
import type { MapsRuntime } from "./runtime";
import { translate, type MapsKey } from "./i18n";
import { useLanguage } from "./maps-page";
import type { MapElement } from "./maps";

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

interface RenameDialog {
  id: string;
  name: string;
}

/** The element's kind, then the flags it carries, for the row's description. */
function describe(element: MapElement, t: (key: MapsKey) => string): string {
  const parts = [t("element.kind.line")];
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
  const selected =
    snapshot.selectedId === null
      ? null
      : (snapshot.elements.find((element) => element.id === snapshot.selectedId) ?? null);

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
            orientation="horizontal"
            options={[
              { value: "select", label: t("tools.select") },
              { value: "pencil", label: t("tools.pencil") },
            ]}
            selectedKey={snapshot.tool}
            onChange={(event) => editor.setTool(event.detail as "select" | "pencil")}
          />
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
          {selected === null ? (
            <ui.Text tone="muted">{t("properties.empty")}</ui.Text>
          ) : (
            <>
              <ui.TextField
                label={t("properties.name")}
                value={selected.name}
                isRequired
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
