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
 * Highlights live in a per-editor ProseMirror plugin, keyed by Plugin id and
 * kind, so each Plugin replaces only its own set of one kind, several kinds
 * coexist, and disabling one Plugin removes only its own kinds. They are
 * view-only decorations: they never enter the document, so they never become
 * saved formatting. The plugin state holds the
 * built DecorationSet and maps it through local edits, so a keystroke never
 * rebuilds the decorations; the Plugin re-highlights on editor.contentChanged.
 *
 * The writes (`editor.insert` / `editor.replace`, #452) act on that same one
 * focused editor, at its caret or at a plain-text range, as a single undoable
 * step that never merges into the author's typing on either side. They dispatch
 * an ordinary editor transaction, so the debounced save persists the change
 * through the normal save path and highlights map through as for any edit.
 *
 * Editor events are invalidation-only (`editor.contentChanged`,
 * `editor.focusChanged`); the lifecycle forwards them to subscribed Plugins.
 */

import {
  type Content,
  type CreateNodeFromContentOptions,
  type Editor,
  type JSONContent,
  createNodeFromContent,
  selectionToInsertionEnd,
} from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { Fragment, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import {
  type PlainTextMap,
  buildPlainTextMap,
  plainOffsetToPm,
  plainRangeToPmRange,
  pmRangeToPlainRange,
} from "@/components/editor/plain-text-offsets";
import { type PluginContentFragment, sanitizePluginHtml } from "@/features/plugins/library";
import type {
  PluginApiInput,
  PluginEditorApplied,
  PluginEditorContentResult,
  PluginEditorSelectionResult,
  PluginEntityTarget,
  PluginHighlightKind,
  PluginHighlightSet,
  PluginRevealRange,
} from "@/features/plugins/types";
import { PluginApiError } from "@/plugin-sdk/protocol";
import { benchMarksEnabled, pluginHighlightsMeasureName } from "@/lib/bench-marks";
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
  /** One Plugin's highlight set of one kind, keyed by `pluginId` + kind. */
  sets: Map<string, PluginHighlightEntry>;
  decorations: DecorationSet;
}

interface PluginHighlightEntry {
  pluginId: string;
  set: PluginHighlightSet;
}

/** The one key per (Plugin id, kind) the host keys a highlight set by. */
function highlightSetKey(pluginId: string, kind: PluginHighlightKind): string {
  return `${pluginId}\u0000${kind}`;
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

/**
 * The plain-text map by document. A ProseMirror node is immutable, so the same
 * node means the same text; the host re-reads the map several times per
 * highlight update (the three kinds, a selection, a reveal) and never walks the
 * document twice for one of them (#451).
 */
const plainTextMaps = new WeakMap<ProseMirrorNode, PlainTextMap>();

function plainTextMapFor(doc: ProseMirrorNode): PlainTextMap {
  let map = plainTextMaps.get(doc);
  if (map === undefined) {
    map = buildPlainTextMap(doc);
    plainTextMaps.set(doc, map);
  }
  return map;
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

/** The inline style a colored range paints with: a low-alpha tint and an underline color. */
function highlightColorStyle(color: string): string {
  return `background-color: color-mix(in srgb, ${color} 22%, transparent); text-decoration-color: ${color};`;
}

/** Builds every Plugin's decorations against one document walk. */
function buildHighlightDecorations(
  doc: ProseMirrorNode,
  sets: Map<string, PluginHighlightEntry>
): DecorationSet {
  if (sets.size === 0) return DecorationSet.empty;
  const map = plainTextMapFor(doc);
  const decorations: Decoration[] = [];
  for (const { pluginId, set } of sets.values()) {
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
          // A colored range tints its background and colors its underline. The
          // kind's class keeps the underline style and offset; text color is never set.
          ...(range.color ? { style: highlightColorStyle(range.color) } : {}),
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
        if (meta.type === "clear") {
          let changed = false;
          for (const [key, entry] of sets) {
            if (entry.pluginId === meta.pluginId) {
              sets.delete(key);
              changed = true;
            }
          }
          // Nothing of this Plugin was painted: no decoration work to do.
          if (!changed) return mapped;
        } else if (meta.set.ranges.length === 0) {
          // An empty set is the host's way to clear exactly one kind. A kind
          // that was never set clears nothing, so the decorations stay put.
          const key = highlightSetKey(meta.pluginId, meta.set.kind);
          if (!sets.has(key)) return mapped;
          sets.delete(key);
        } else {
          sets.set(highlightSetKey(meta.pluginId, meta.set.kind), {
            pluginId: meta.pluginId,
            set: meta.set,
          });
        }
        // One document walk per set or clear that changed something, never per transaction.
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
  const map = plainTextMapFor(entry.editor.state.doc);
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
  const map = plainTextMapFor(entry.editor.state.doc);
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

/**
 * The document range a Plugin range names, in the same plain-text coordinates
 * the reads and reveal share. A range outside the editor's text, or one whose
 * `from` is past its `to`, is refused rather than clamped, so a Plugin never
 * edits text it did not name (#452).
 */
function resolvePluginRange(
  entry: EditorEntry,
  range: PluginRevealRange
): { from: number; to: number } {
  const map = plainTextMapFor(entry.editor.state.doc);
  if (range.from < 0 || range.from > range.to || range.to > map.text.length) {
    throw new PluginApiError({
      code: "invalid-params",
      message: `range ${range.from}-${range.to} is outside the editor's text (0-${map.text.length})`,
    });
  }
  const from = plainOffsetToPm(map, range.from, "start");
  return { from, to: Math.max(from, plainOffsetToPm(map, range.to, "end")) };
}

/** One line or block of plain text as schema content: newlines become hard breaks. */
function plainTextInlineContent(text: string): JSONContent[] {
  const nodes: JSONContent[] = [];
  text.split("\n").forEach((line, index) => {
    if (index > 0) nodes.push({ type: "hardBreak" });
    if (line.length > 0) nodes.push({ type: "text", text: line });
  });
  return nodes;
}

/** JSON, HTML, or a node as schema content; a node result is wrapped in a Fragment. */
function fragmentFromContent(
  editor: Editor,
  content: Content,
  options?: CreateNodeFromContentOptions
): Fragment {
  const parsed = createNodeFromContent(content, editor.schema, options);
  return parsed instanceof Fragment ? parsed : Fragment.from(parsed);
}

/**
 * Plain text as schema content: a single block stays inline (so inserting a
 * word at the caret does not split its paragraph), a single newline becomes a
 * hard break, and a blank line becomes a paragraph break — the shape the
 * Library reads give back through `editor.getText()`.
 */
function plainTextContent(editor: Editor, text: string): Fragment {
  const blocks = text.split(/\n{2,}/);
  if (blocks.length <= 1)
    return fragmentFromContent(editor, plainTextInlineContent(blocks[0] ?? ""));
  return fragmentFromContent(
    editor,
    blocks.map((block) => ({ type: "paragraph", content: plainTextInlineContent(block) }))
  );
}

/**
 * A fragment's editable content: an HTML fragment passes the host sanitizer,
 * then the editor's schema parses it (anything the schema rejects is dropped,
 * never thrown); plain text is built directly. Both keep the sanitizer every
 * read uses (#452).
 */
function fragmentContent(editor: Editor, fragment: PluginContentFragment): Fragment {
  if ("html" in fragment) {
    return fragmentFromContent(editor, sanitizePluginHtml(fragment.html), {
      parseOptions: { preserveWhitespace: "full" },
    });
  }
  return plainTextContent(editor, fragment.text);
}

/**
 * Applies one fragment at a document range as a single undoable step. The
 * transaction closes the current history group first, so it never merges into
 * the author's previous typing; a second, non-document-changing transaction
 * carries the same close, so the author's next keystrokes form their own step
 * instead of joining the Plugin's. `closeHistory` is what prosemirror-history
 * resets its group on.
 */
function applyEditorFragment(
  entry: EditorEntry,
  from: number,
  to: number,
  content: Fragment
): void {
  const { editor } = entry;
  let onlyText = true;
  let onlyBlocks = true;
  content.forEach((node) => {
    node.check();
    if (onlyText) onlyText = node.isText && node.marks.length === 0;
    if (onlyBlocks) onlyBlocks = node.isBlock;
  });

  const tr = closeHistory(editor.state.tr);
  let start = from;
  let end = to;
  // Inserting block content at the caret of an empty paragraph replaces that
  // empty paragraph, the way pasting a paragraph does, rather than leaving it.
  if (start === end && onlyBlocks) {
    const { parent } = tr.doc.resolve(start);
    if (parent.isTextblock && !parent.type.spec.code && parent.childCount === 0) {
      start -= 1;
      end += 1;
    }
  }
  if (onlyText) {
    let text = "";
    content.forEach((node) => {
      text += node.text ?? "";
    });
    tr.insertText(text, start, end);
  } else {
    tr.replaceWith(start, end, content);
  }
  selectionToInsertionEnd(tr, tr.steps.length - 1, -1);
  editor.view.dispatch(tr);
  editor.view.dispatch(closeHistory(editor.state.tr));
}

/** Inserts a fragment at the caret, replacing the selection, as one undoable step. */
export function insertInFocusedEditor(fragment: PluginContentFragment): PluginEditorApplied {
  const entry = resolveFocusedEditor();
  if (!entry) return { status: "no-target" };
  const { from, to } = entry.editor.state.selection;
  applyEditorFragment(entry, from, to, fragmentContent(entry.editor, fragment));
  return { status: "applied" };
}

/** Replaces a plain-text range with a fragment as one undoable step. */
export function replaceInFocusedEditor(
  range: PluginRevealRange,
  fragment: PluginContentFragment
): PluginEditorApplied {
  const entry = resolveFocusedEditor();
  if (!entry) return { status: "no-target" };
  const { from, to } = resolvePluginRange(entry, range);
  applyEditorFragment(entry, from, to, fragmentContent(entry.editor, fragment));
  return { status: "applied" };
}

/** Replaces one Plugin's highlight set for one kind in the focused editor. */
export function setPluginEditorHighlights(
  pluginId: string,
  input: PluginApiInput<"editor.setHighlights">
): PluginEditorApplied {
  const entry = resolveFocusedEditor();
  if (!entry) return { status: "no-target" };
  // The host share of one highlight update — the transaction dispatch and the
  // decoration build it triggers — timed for the #401 Echoes main-thread budget
  // (#451). Guarded by `benchMarksEnabled()`, so a shipped build emits nothing.
  const measured = benchMarksEnabled();
  const startedAt = measured ? performance.now() : 0;
  entry.editor.view.dispatch(
    entry.editor.state.tr.setMeta(entry.key, {
      type: "set",
      pluginId,
      set: { kind: input.kind, ranges: input.ranges },
    } satisfies HighlightMeta)
  );
  if (measured) benchHighlightMeasure(pluginId, startedAt);
  return { status: "applied" };
}

/**
 * Records one highlight update's host-side duration under
 * `plugin.highlights:<pluginId>`, the measure the `bench:plugins` lane reads for
 * its main-thread-per-update row (#451). A missing or partial User Timing API
 * never breaks a highlight update, and only ever emits when the bench gate is
 * on.
 */
function benchHighlightMeasure(pluginId: string, startedAt: number): void {
  if (typeof performance === "undefined" || typeof performance.measure !== "function") return;
  try {
    performance.measure(pluginHighlightsMeasureName(pluginId), {
      start: startedAt,
      end: performance.now(),
    });
  } catch {
    // A missing timing API must never break a highlight update.
  }
}

/** Removes every kind of one Plugin's highlights from every open editor (disabling it). */
export function clearPluginHighlights(pluginId: string): void {
  for (const entry of editors.values()) {
    const sets = entry.key.getState(entry.editor.state)?.sets;
    if (!sets || !hasPluginSet(sets, pluginId)) continue;
    entry.editor.view.dispatch(
      entry.editor.state.tr.setMeta(entry.key, { type: "clear", pluginId } satisfies HighlightMeta)
    );
  }
}

function hasPluginSet(sets: Map<string, PluginHighlightEntry>, pluginId: string): boolean {
  for (const entry of sets.values()) {
    if (entry.pluginId === pluginId) return true;
  }
  return false;
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
export function onEditorContentChanged(listener: (entity: PluginEntityTarget) => void): () => void {
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
