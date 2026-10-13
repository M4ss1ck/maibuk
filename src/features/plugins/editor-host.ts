/**
 * The focused-editor registry the Plugin editor API reads (#441), the concept
 * the dictation hub already uses for its targets. A Chapter or Note editor
 * registers itself with its entity and its TipTap instance; the host resolves
 * "the focused editor" as the last editor to take focus that is still mounted,
 * not destroyed, and not behind a modal. Losing focus to a toolbar button or a
 * Plugin page does not clear the target; taking focus in another editor moves
 * it, and it becomes none only when the target unregisters or unmounts. Reads,
 * reveal, and highlights all address that one editor, in the plain-text offsets
 * the Library reads share (#396).
 *
 * Highlights live in a per-editor ProseMirror plugin, keyed by Plugin id, so
 * each Plugin replaces only its own set, several coexist, and disabling one
 * removes only its own. They are view-only decorations: they never enter the
 * document, so they never become saved formatting. The plugin state holds the
 * built DecorationSet and maps it through local edits, so a keystroke never
 * rebuilds the decorations; the Plugin re-highlights on editor.contentChanged.
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

/**
 * How long a reveal queued for an entity whose editor has not mounted stays
 * queued. A stale range must never move the caret when the author opens that
 * Chapter or Note manually later.
 */
export const PENDING_REVEAL_TTL_MS = 5_000;

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
  decorations: DecorationSet;
}

interface EditorEntry {
  id: string;
  entity: PluginEntityTarget;
  editor: Editor;
  key: PluginKey<HighlightsState>;
  contentTimer: ReturnType<typeof setTimeout> | null;
  dispose: () => void;
}

interface PendingReveal {
  range: PluginRevealRange;
  /** When it was queued, so a stale reveal can be dropped. */
  at: number;
}

const editors = new Map<string, EditorEntry>();
const pendingReveals = new Map<string, PendingReveal>();
const contentListeners = new Set<(entity: PluginEntityTarget) => void>();
const focusListeners = new Set<(entity: PluginEntityTarget | null) => void>();

let focusedId: string | null = null;
let lastFocusKey: string | null = null;
let focusClearTimer: ReturnType<typeof setTimeout> | null = null;

function entityKey(entity: PluginEntityTarget): string {
  return `${entity.kind}:${entity.id}`;
}

function isUsable(entry: EditorEntry): boolean {
  return !entry.editor.isDestroyed && !isOutsideLayer(entry.editor.view.dom);
}

function resolveFocusedEditor(): EditorEntry | null {
  if (focusedId === null) return null;
  const entry = editors.get(focusedId);
  return entry !== undefined && isUsable(entry) ? entry : null;
}

function findEditorForEntity(entity: PluginEntityTarget): EditorEntry | null {
  const key = entityKey(entity);
  for (const entry of editors.values()) {
    if (entityKey(entry.entity) === key && isUsable(entry)) return entry;
  }
  return null;
}

function setFocused(id: string | null): void {
  if (focusClearTimer !== null) {
    clearTimeout(focusClearTimer);
    focusClearTimer = null;
  }
  focusedId = id;
  const entity = id === null ? null : (editors.get(id)?.entity ?? null);
  const key = entity === null ? null : entityKey(entity);
  if (lastFocusKey === key) return;
  lastFocusKey = key;
  for (const listener of [...focusListeners]) listener(entity);
}

/**
 * Drops the focus after a tick rather than at once, so re-registering the same
 * id in the same commit (a Note switch) keeps the target and never reports an
 * intermediate "none".
 */
function scheduleFocusClear(): void {
  if (focusClearTimer !== null) clearTimeout(focusClearTimer);
  focusClearTimer = setTimeout(() => {
    focusClearTimer = null;
    if (focusedId !== null && editors.has(focusedId)) return;
    setFocused(null);
  }, 0);
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

/** Builds every Plugin's decorations against one document walk. */
function buildHighlightDecorations(
  doc: ProseMirrorNode,
  sets: Map<string, PluginHighlightSet>
): DecorationSet {
  if (sets.size === 0) return DecorationSet.empty;
  const map = buildPlainTextMap(doc);
  const decorations: Decoration[] = [];
  for (const [pluginId, set] of sets) {
    for (const range of set.ranges) {
      const pm = plainRangeToPmRange(map, range.from, range.to);
      if (pm === null) continue;
      decorations.push(
        Decoration.inline(pm.from, pm.to, {
          // `nodeName` forces ProseMirror to give this decoration its own
          // nested wrapper instead of merging it with another Plugin's
          // overlapping highlight, so each keeps its own class, role,
          // data-plugin-highlight, and label (#395).
          nodeName: "span",
          class: `plugin-highlight plugin-highlight--${set.kind}`,
          role: "mark",
          "data-plugin-highlight": pluginId,
          ...(range.label
            ? { "aria-description": range.label, "data-plugin-highlight-label": range.label }
            : {}),
        })
      );
    }
  }
  return decorations.length > 0 ? DecorationSet.create(doc, decorations) : DecorationSet.empty;
}

function createHighlightsPlugin(entryId: string): {
  key: PluginKey<HighlightsState>;
  plugin: Plugin<HighlightsState>;
} {
  const key = new PluginKey<HighlightsState>(`pluginHighlights-${entryId}`);

  const plugin = new Plugin<HighlightsState>({
    key,
    state: {
      init: () => ({ sets: new Map(), decorations: DecorationSet.empty }),
      apply: (tr, value) => {
        // A local edit maps the decorations through it, keeping each highlight
        // on the same characters until the Plugin re-highlights on
        // editor.contentChanged (#396).
        const mapped = tr.docChanged
          ? { sets: value.sets, decorations: value.decorations.map(tr.mapping, tr.doc) }
          : value;
        const meta = tr.getMeta(key) as HighlightMeta | undefined;
        if (!meta) return mapped;
        if (meta.type === "clearAll") {
          return { sets: new Map(), decorations: DecorationSet.empty };
        }
        const sets = new Map(mapped.sets);
        if (meta.type === "clear") sets.delete(meta.pluginId);
        else sets.set(meta.pluginId, meta.set);
        // One document walk per set or clear, never per transaction.
        return { sets, decorations: buildHighlightDecorations(tr.doc, sets) };
      },
    },
    props: {
      decorations(state) {
        return key.getState(state)?.decorations ?? DecorationSet.empty;
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

function isPendingRevealStale(pending: PendingReveal, now: number): boolean {
  return now - pending.at > PENDING_REVEAL_TTL_MS;
}

function consumePendingReveal(entry: EditorEntry): void {
  const key = entityKey(entry.entity);
  const pending = pendingReveals.get(key);
  if (pending === undefined) return;
  pendingReveals.delete(key);
  if (isPendingRevealStale(pending, Date.now())) return;
  applyReveal(entry, pending.range);
}

/**
 * Registers one focused editor. Re-registering the same id (the entity moved,
 * a Note switch) keeps the target in place: the previous editor is replaced
 * without an intermediate "none", and the new entity is reported once.
 */
export function registerPluginEditor(input: PluginEditorRegistration): () => void {
  const hadFocus = focusedId === input.id;
  editors.get(input.id)?.dispose();
  if (hadFocus && focusClearTimer !== null) {
    clearTimeout(focusClearTimer);
    focusClearTimer = null;
  }

  const { key, plugin } = createHighlightsPlugin(input.id);
  const entry: EditorEntry = {
    id: input.id,
    entity: input.entity,
    editor: input.editor,
    key,
    contentTimer: null,
    dispose: () => {},
  };

  const onUpdate = () => notifyContentChanged(entry);
  const onFocus = () => setFocused(entry.id);

  input.editor.on("update", onUpdate);
  input.editor.on("focus", onFocus);
  input.editor.registerPlugin(plugin);
  editors.set(entry.id, entry);
  if (hadFocus) setFocused(entry.id);
  else if (input.editor.isFocused) onFocus();
  consumePendingReveal(entry);

  entry.dispose = () => {
    if (entry.contentTimer !== null) clearTimeout(entry.contentTimer);
    input.editor.off("update", onUpdate);
    input.editor.off("focus", onFocus);
    if (!input.editor.isDestroyed) input.editor.unregisterPlugin(key);
    editors.delete(entry.id);
    if (focusedId === entry.id) scheduleFocusClear();
  };
  return entry.dispose;
}

/**
 * Queues a reveal for an entity: applied now when its editor is open, or when
 * that editor registers (a Chapter or Note route mounting under it). A reveal
 * not consumed within `PENDING_REVEAL_TTL_MS` is dropped.
 */
export function requestEditorReveal(entity: PluginEntityTarget, range: PluginRevealRange): void {
  const entry = findEditorForEntity(entity);
  if (entry) {
    applyReveal(entry, range);
    return;
  }
  const now = Date.now();
  for (const [key, pending] of pendingReveals) {
    if (isPendingRevealStale(pending, now)) pendingReveals.delete(key);
  }
  pendingReveals.set(entityKey(entity), { range, at: now });
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

/**
 * Invalidates outstanding editor work at a Library boundary (the Tutorial,
 * ADR 0008). Every Plugin's highlights are dropped from every open editor,
 * reveals queued for an editor that has not mounted yet are cancelled, and a
 * coalesced content event that has not fired yet is dropped, so work accepted
 * against the Library that is going away can never surface on its replacement.
 */
export function invalidatePluginEditorWork(): void {
  const clearAll = { type: "clearAll" } satisfies HighlightMeta;
  for (const entry of editors.values()) {
    if (entry.contentTimer !== null) {
      clearTimeout(entry.contentTimer);
      entry.contentTimer = null;
    }
    entry.editor.view.dispatch(entry.editor.state.tr.setMeta(entry.key, clearAll));
  }
  pendingReveals.clear();
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
  lastFocusKey = null;
  if (focusClearTimer !== null) {
    clearTimeout(focusClearTimer);
    focusClearTimer = null;
  }
}
