/**
 * The focused-editor registry the Plugin editor API reads (#441), the concept
 * the dictation hub already uses for its targets. A Chapter or Note editor
 * registers itself with its entity and its TipTap instance; the host resolves
 * "the focused editor" as the last editor to take focus that is still mounted
 * and not behind a modal. Reads, reveal, and highlights all address that one
 * editor, in the plain-text offsets the Library reads share (#396).
 *
 * Highlights live in a per-editor ProseMirror plugin, keyed by Plugin id, so
 * each Plugin replaces only its own set, several coexist, and disabling one
 * removes only its own. They are view-only decorations: they never enter the
 * document, so they never become saved formatting.
 *
 * Editor events are invalidation-only (`editor.contentChanged`,
 * `editor.focusChanged`); the lifecycle forwards them to subscribed Plugins.
 */

import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import {
  buildPlainTextMap,
  plainOffsetToPm,
  plainRangeToPmRange,
  pmRangeToPlainRange,
  type PlainTextMap,
} from "@/components/editor/plain-text-offsets";
import { sanitizePluginHtml } from "@/features/plugins/library";
import type {
  PluginApiInput,
  PluginEditorApplied,
  PluginEditorContentResult,
  PluginEditorSelectionResult,
  PluginEntityTarget,
  PluginHighlightSet,
  PluginRevealRange,
} from "@/features/plugins/types";
import { isOutsideLayer } from "@/lib/top-layer";

/** How long a burst of keystrokes coalesces into one `editor.contentChanged`. */
export const EDITOR_CONTENT_EVENT_MS = 300;

export interface PluginEditorRegistration {
  /** A stable id for one editor instance across entity changes. */
  id: string;
  editor: Editor;
  entity: PluginEntityTarget;
}

type HighlightMeta =
  | { type: "set"; pluginId: string; set: PluginHighlightSet }
  | { type: "clear"; pluginId: string }
  | { type: "clearAll" };

interface HighlightsState {
  sets: Map<string, PluginHighlightSet>;
}

interface EditorEntry {
  id: string;
  entity: PluginEntityTarget;
  editor: Editor;
  key: PluginKey<HighlightsState>;
  contentTimer: ReturnType<typeof setTimeout> | null;
  blurTimer: ReturnType<typeof setTimeout> | null;
  dispose: () => void;
}

const editors = new Map<string, EditorEntry>();
const pendingReveals = new Map<string, PluginRevealRange>();
const contentListeners = new Set<(entity: PluginEntityTarget) => void>();
const focusListeners = new Set<(entity: PluginEntityTarget | null) => void>();

let focusedId: string | null = null;
let lastFocusId: string | null = null;

function entityKey(entity: PluginEntityTarget): string {
  return `${entity.kind}:${entity.id}`;
}

function isUsable(entry: EditorEntry): boolean {
  return !entry.editor.isDestroyed && !isOutsideLayer(entry.editor.view.dom);
}

function resolveFocusedEditor(): EditorEntry | null {
  const focused = focusedId === null ? null : editors.get(focusedId);
  if (focused && isUsable(focused)) return focused;
  for (const entry of editors.values()) {
    if (entry.editor.isFocused && isUsable(entry)) return entry;
  }
  return null;
}

function findEditorForEntity(entity: PluginEntityTarget): EditorEntry | null {
  const key = entityKey(entity);
  for (const entry of editors.values()) {
    if (entityKey(entry.entity) === key && isUsable(entry)) return entry;
  }
  return null;
}

function setFocused(id: string | null): void {
  focusedId = id;
  if (lastFocusId === id) return;
  lastFocusId = id;
  const entity = id === null ? null : (editors.get(id)?.entity ?? null);
  for (const listener of [...focusListeners]) listener(entity);
}

function notifyContentChanged(entry: EditorEntry): void {
  if (contentListeners.size === 0) return;
  if (entry.contentTimer !== null) clearTimeout(entry.contentTimer);
  entry.contentTimer = setTimeout(() => {
    entry.contentTimer = null;
    if (!editors.has(entry.id)) return;
    for (const listener of [...contentListeners]) listener(entry.entity);
  }, EDITOR_CONTENT_EVENT_MS);
}

function createHighlightsPlugin(entryId: string): {
  key: PluginKey<HighlightsState>;
  plugin: Plugin<HighlightsState>;
} {
  const key = new PluginKey<HighlightsState>(`pluginHighlights-${entryId}`);
  let cachedDoc: ProseMirrorNode | null = null;
  let cachedMap: PlainTextMap | null = null;

  const plugin = new Plugin<HighlightsState>({
    key,
    state: {
      init: () => ({ sets: new Map() }),
      apply: (tr, value) => {
        const meta = tr.getMeta(key) as HighlightMeta | undefined;
        if (!meta) return value;
        if (meta.type === "clearAll") return { sets: new Map() };
        const sets = new Map(value.sets);
        if (meta.type === "clear") sets.delete(meta.pluginId);
        else sets.set(meta.pluginId, meta.set);
        return { sets };
      },
    },
    props: {
      decorations(state) {
        const sets = key.getState(state)?.sets;
        if (!sets || sets.size === 0) return null;
        // The map is O(document); cache it so a selection-only transaction on
        // an unchanged document does not walk the text again.
        if (cachedDoc !== state.doc) {
          cachedDoc = state.doc;
          cachedMap = buildPlainTextMap(state.doc);
        }
        const map = cachedMap as PlainTextMap;
        const decorations: Decoration[] = [];
        for (const [pluginId, set] of sets) {
          for (const range of set.ranges) {
            const pm = plainRangeToPmRange(map, range.from, range.to);
            if (pm === null) continue;
            decorations.push(
              Decoration.inline(pm.from, pm.to, {
                class: `plugin-highlight plugin-highlight--${set.kind}`,
                "data-plugin-highlight": pluginId,
                ...(range.label ? { "data-plugin-highlight-label": range.label } : {}),
              })
            );
          }
        }
        return decorations.length > 0 ? DecorationSet.create(state.doc, decorations) : null;
      },
    },
  });
  return { key, plugin };
}

function applyReveal(entry: EditorEntry, range: PluginRevealRange): void {
  const map = buildPlainTextMap(entry.editor.state.doc);
  const pos = plainOffsetToPm(map, range.from, "start");
  entry.editor.chain().focus().setTextSelection(pos).scrollIntoView().run();
}

function consumePendingReveal(entry: EditorEntry): void {
  const key = entityKey(entry.entity);
  const range = pendingReveals.get(key);
  if (range === undefined) return;
  pendingReveals.delete(key);
  applyReveal(entry, range);
}

/**
 * Registers one focused editor. Re-registering the same id (the entity moved)
 * replaces the old entry; the returned function unregisters it.
 */
export function registerPluginEditor(input: PluginEditorRegistration): () => void {
  editors.get(input.id)?.dispose();
  const { key, plugin } = createHighlightsPlugin(input.id);
  const entry: EditorEntry = {
    id: input.id,
    entity: input.entity,
    editor: input.editor,
    key,
    contentTimer: null,
    blurTimer: null,
    dispose: () => {},
  };

  const onUpdate = () => notifyContentChanged(entry);
  const onFocus = () => {
    if (entry.blurTimer !== null) {
      clearTimeout(entry.blurTimer);
      entry.blurTimer = null;
    }
    setFocused(entry.id);
  };
  const onBlur = () => {
    if (entry.blurTimer !== null) clearTimeout(entry.blurTimer);
    // Another editor's focus lands in the same tick; only report "none" once
    // no registered editor holds focus.
    entry.blurTimer = setTimeout(() => {
      entry.blurTimer = null;
      if (focusedId !== entry.id) return;
      for (const other of editors.values()) if (other.editor.isFocused) return;
      setFocused(null);
    }, 0);
  };

  input.editor.on("update", onUpdate);
  input.editor.on("focus", onFocus);
  input.editor.on("blur", onBlur);
  input.editor.registerPlugin(plugin);
  editors.set(entry.id, entry);
  if (input.editor.isFocused) onFocus();
  consumePendingReveal(entry);

  entry.dispose = () => {
    if (entry.contentTimer !== null) clearTimeout(entry.contentTimer);
    if (entry.blurTimer !== null) clearTimeout(entry.blurTimer);
    input.editor.off("update", onUpdate);
    input.editor.off("focus", onFocus);
    input.editor.off("blur", onBlur);
    if (!input.editor.isDestroyed) input.editor.unregisterPlugin(key);
    editors.delete(entry.id);
    if (focusedId === entry.id) setFocused(null);
  };
  return entry.dispose;
}

/**
 * Queues a reveal for an entity: applied now when its editor is open, or when
 * that editor registers (a Chapter or Note route mounting under it).
 */
export function requestEditorReveal(entity: PluginEntityTarget, range: PluginRevealRange): void {
  const entry = findEditorForEntity(entity);
  if (entry) {
    applyReveal(entry, range);
    return;
  }
  pendingReveals.set(entityKey(entity), range);
}

/** Applies a reveal queued for this editor's entity, once its content is ready. */
export function flushPendingEditorReveal(id: string): void {
  const entry = editors.get(id);
  if (entry) consumePendingReveal(entry);
}

export function getPluginEditorContent(): PluginEditorContentResult {
  const entry = resolveFocusedEditor();
  if (!entry) return { status: "no-target" };
  return {
    status: "ok",
    entity: entry.entity,
    content: {
      text: entry.editor.getText(),
      html: sanitizePluginHtml(entry.editor.getHTML()),
    },
  };
}

export function getPluginEditorSelection(): PluginEditorSelectionResult {
  const entry = resolveFocusedEditor();
  if (!entry) return { status: "no-target" };
  const map = buildPlainTextMap(entry.editor.state.doc);
  const { from, to } = entry.editor.state.selection;
  const range = pmRangeToPlainRange(map, from, to);
  return { status: "ok", entity: entry.entity, range, text: map.text.slice(range.from, range.to) };
}

export function revealInFocusedEditor(range: PluginRevealRange): PluginEditorApplied {
  const entry = resolveFocusedEditor();
  if (!entry) return { status: "no-target" };
  applyReveal(entry, range);
  return { status: "applied" };
}

/** Replaces one Plugin's whole highlight set in the focused editor. */
export function setPluginEditorHighlights(
  pluginId: string,
  input: PluginApiInput<"editor.setHighlights">
): PluginEditorApplied {
  const entry = resolveFocusedEditor();
  if (!entry) return { status: "no-target" };
  entry.editor.view.dispatch(
    entry.editor.state.tr.setMeta(entry.key, {
      type: "set",
      pluginId,
      set: { kind: input.kind, ranges: input.ranges },
    } satisfies HighlightMeta)
  );
  return { status: "applied" };
}

/** Removes one Plugin's highlights from every open editor (disabling it). */
export function clearPluginHighlights(pluginId: string): void {
  for (const entry of editors.values()) {
    const sets = entry.key.getState(entry.editor.state)?.sets;
    if (!sets?.has(pluginId)) continue;
    entry.editor.view.dispatch(
      entry.editor.state.tr.setMeta(entry.key, { type: "clear", pluginId } satisfies HighlightMeta)
    );
  }
}

/** Runs after a focused editor's content changes (coalesced per burst). */
export function onEditorContentChanged(
  listener: (entity: PluginEntityTarget) => void
): () => void {
  contentListeners.add(listener);
  return () => {
    contentListeners.delete(listener);
  };
}

/** Runs when the focused editor changes, including to none. */
export function onEditorFocusChanged(
  listener: (entity: PluginEntityTarget | null) => void
): () => void {
  focusListeners.add(listener);
  return () => {
    focusListeners.delete(listener);
  };
}

/** Drops every registration, queued reveal, and listener; tests use it. */
export function resetPluginEditorHostForTests(): void {
  for (const entry of [...editors.values()]) entry.dispose();
  editors.clear();
  pendingReveals.clear();
  contentListeners.clear();
  focusListeners.clear();
  focusedId = null;
  lastFocusId = null;
}
