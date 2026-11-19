import type { ParseKeys, TFunction } from "i18next";
import type { ComponentType } from "react";
import { useEffect, useRef, useSyncExternalStore } from "react";
import type { NavigateFunction } from "react-router-dom";
import { create } from "zustand";
import { bookReferenceSource } from "@/features/canvas/bookReferenceSource";
import { canvasReferenceSource } from "@/features/canvas/canvasReferenceSource";
import { chapterReferenceSource } from "@/features/canvas/chapterReferenceSource";
import { noteReferenceSource } from "@/features/canvas/noteReferenceSource";
import { pluginReferenceSource } from "@/features/canvas/pluginReferenceSource";
import type { CanvasNode } from "@/features/canvas/types";
import {
  type PluginCanvasReferenceSourceDef,
  getKnownPluginName,
  getPluginCanvasReferenceSources,
  onPluginContributionsChange,
} from "@/features/plugins/contributions-registry";
import { pluginIdOfContribution } from "@/features/plugins/ids";

/**
 * Canvas References reach their targets only through a source. The picker, the
 * cards, and the Canvas page see this interface and the registry below, never
 * a Note (or Book, Plugin item, ...) directly. Answers live in memory beside the
 * Canvas and are never written into the Canvas document.
 */

/** Each card kind draws in one fixed box, whatever state it is in. */
export type CanvasReferenceCardKind = "note" | "book" | "chapter" | "canvas" | "generic";

export const CANVAS_REFERENCE_CARD_SIZES: Record<
  CanvasReferenceCardKind,
  { width: number; height: number }
> = {
  note: { width: 224, height: 176 },
  book: { width: 192, height: 480 },
  chapter: { width: 224, height: 208 },
  canvas: { width: 240, height: 200 },
  generic: { width: 224, height: 160 },
};

/** A card that draws a source's image takes the box its declared preview shape asks for. */
export const CANVAS_REFERENCE_PREVIEW_SIZES: Record<
  "landscape" | "portrait",
  { width: number; height: number }
> = {
  landscape: { width: 240, height: 280 },
  portrait: { width: 192, height: 480 },
};

export interface CanvasReferenceRow {
  id: string;
  title: string;
  subtitle?: string;
}

/**
 * `title` is the live title anything can show; `value` is what the source's card
 * kind draws, and only the card for that kind knows its shape.
 */
export type CanvasReferenceResolution =
  | { status: "present"; title: string; value: unknown }
  | { status: "missing" };

export type CanvasReferenceOpenResult = "opened" | "missing";

export interface CanvasReferenceOpenContext {
  canvasId: string;
  canvasTitle: string;
  /** Host sources navigate in-app; the Router's navigate is handed in by the card. */
  navigate: NavigateFunction;
}

export interface CanvasReferenceSource {
  id: string;
  /**
   * i18n key of the picker tab label. A Plugin source (`fromPlugin`) holds
   * already-localized text instead; `canvasReferenceSourceLabel` reads either.
   */
  label: string;
  /** Drawn in the picker tab; a Lucide icon or a Plugin's own icon component. */
  icon: ComponentType<{ className?: string }>;
  card: CanvasReferenceCardKind;
  /** The card image shape a Plugin source declares; only Plugin sources set it. */
  preview?: "landscape" | "portrait";
  /** Set on a source a Plugin declares, whose `label` is already text; host sources leave it out. */
  fromPlugin?: true;
  list(query: string, context: { canvasId: string }): Promise<CanvasReferenceRow[]>;
  /** Answers every id asked; an id left out of the answer counts as unresolved. */
  resolve(ids: readonly string[]): Promise<Record<string, CanvasReferenceResolution>>;
  open(id: string, context: CanvasReferenceOpenContext): Promise<CanvasReferenceOpenResult>;
  /** Host sources stay live: the host re-resolves when the listener fires. */
  subscribe?(listener: () => void): () => void;
}

/** The picker tab's text: a host source holds an i18n key, a Plugin source already-localized text. */
export function canvasReferenceSourceLabel(source: CanvasReferenceSource, t: TFunction): string {
  return source.fromPlugin ? source.label : t(source.label as ParseKeys);
}

/**
 * The four sources the app itself declares. A Plugin source joins the registry
 * through `getCanvasReferenceSources` below, so this stays host-only.
 */
export const CANVAS_REFERENCE_SOURCES: readonly CanvasReferenceSource[] = [
  noteReferenceSource,
  bookReferenceSource,
  chapterReferenceSource,
  canvasReferenceSource,
];

// The merged registry is rebuilt only when the Plugin defs array changes, so
// `useCanvasReferenceSources` can hand `useSyncExternalStore` one snapshot.
let cachedPluginDefs: readonly PluginCanvasReferenceSourceDef[] | null = null;
let cachedMergedSources: readonly CanvasReferenceSource[] | null = null;

// One source object per contribution: it stays the same object while its Plugin
// stays registered, and a Plugin that comes back brings new ones, which the
// resolver reads as "ask again".
const pluginSources = new WeakMap<PluginCanvasReferenceSourceDef, CanvasReferenceSource>();

function pluginSourceFor(def: PluginCanvasReferenceSourceDef): CanvasReferenceSource {
  let source = pluginSources.get(def);
  if (source === undefined) {
    source = pluginReferenceSource(def);
    pluginSources.set(def, source);
  }
  return source;
}

/**
 * Every source the picker, the cards, and the resolver see: the host sources
 * first, then one source per Plugin-declared source, in Plugin name order.
 */
export function getCanvasReferenceSources(): readonly CanvasReferenceSource[] {
  const pluginDefs = getPluginCanvasReferenceSources();
  if (cachedMergedSources !== null && pluginDefs === cachedPluginDefs) return cachedMergedSources;
  cachedPluginDefs = pluginDefs;
  cachedMergedSources = [...CANVAS_REFERENCE_SOURCES, ...pluginDefs.map(pluginSourceFor)];
  return cachedMergedSources;
}

/** The merged registry, kept live so a Plugin turning on or off re-renders its readers. */
export function useCanvasReferenceSources(): readonly CanvasReferenceSource[] {
  return useSyncExternalStore(onPluginContributionsChange, getCanvasReferenceSources);
}

export function useCanvasReferenceSource(id: string): CanvasReferenceSource | undefined {
  return useCanvasReferenceSources().find((source) => source.id === id);
}

export function getCanvasReferenceSource(id: string): CanvasReferenceSource | undefined {
  return getCanvasReferenceSources().find((source) => source.id === id);
}

/**
 * The name of the Plugin behind a Plugin source id (`plugin.<pluginId>.<localId>`),
 * or undefined for a host source or a Plugin that has not registered this session.
 */
export function canvasReferencePluginName(sourceId: string): string | undefined {
  const pluginId = pluginIdOfContribution(sourceId);
  return pluginId === null ? undefined : getKnownPluginName(pluginId);
}

/** The key an answer is filed under: a target only means something inside its source. */
export function canvasReferenceKey(source: string, targetId: string): string {
  return `${source}:${targetId}`;
}

/**
 * The answers a Canvas Reference got from its source live here, in memory,
 * beside the Canvas: never in the Canvas document, never in the canvas store,
 * so no save, Checkpoint, or Change ever carries them.
 */
interface CanvasReferenceResolutionsStore {
  resolutions: Record<string, CanvasReferenceResolution>;
  /** Answers arrive keyed by target id; the store keys them by source and target. */
  mergeAnswers(source: string, answers: Record<string, CanvasReferenceResolution>): void;
  markMissing(source: string, targetId: string): void;
  clear(): void;
}

export const useCanvasReferenceResolutions = create<CanvasReferenceResolutionsStore>((set) => ({
  resolutions: {},

  mergeAnswers: (source, answers) =>
    set((state) => {
      const resolutions = { ...state.resolutions };
      for (const [targetId, resolution] of Object.entries(answers)) {
        resolutions[canvasReferenceKey(source, targetId)] = resolution;
      }
      return { resolutions };
    }),

  markMissing: (source, targetId) =>
    set((state) => ({
      resolutions: {
        ...state.resolutions,
        [canvasReferenceKey(source, targetId)]: { status: "missing" },
      },
    })),

  clear: () => set({ resolutions: {} }),
}));

/** `undefined` while the source has not answered yet, or answered without this id. */
export function useCanvasReferenceResolution(
  source: string,
  targetId: string
): CanvasReferenceResolution | undefined {
  return useCanvasReferenceResolutions(
    (state) => state.resolutions[canvasReferenceKey(source, targetId)]
  );
}

/** The target is gone; the Canvas Reference stays on the Canvas as Missing. */
export function markCanvasReferenceMissing(source: string, targetId: string): void {
  useCanvasReferenceResolutions.getState().markMissing(source, targetId);
}

interface CanvasReferenceGroup {
  source: CanvasReferenceSource;
  ids: string[];
}

/** References grouped by a source the registry knows; an unknown source renders Unavailable. */
function referenceGroups(
  nodes: readonly CanvasNode[],
  sources: readonly CanvasReferenceSource[]
): CanvasReferenceGroup[] {
  const sourcesById = new Map(sources.map((source) => [source.id, source]));
  const idsBySource = new Map<string, Set<string>>();
  for (const node of nodes) {
    if (node.kind !== "reference") continue;
    if (!sourcesById.has(node.source)) continue;
    const ids = idsBySource.get(node.source) ?? new Set<string>();
    ids.add(node.targetId);
    idsBySource.set(node.source, ids);
  }

  const groups: CanvasReferenceGroup[] = [];
  for (const [id, ids] of idsBySource) {
    const source = sourcesById.get(id);
    if (source) groups.push({ source, ids: [...ids] });
  }
  return groups;
}

/** One string per set of grouped references; the effect re-runs only when it changes. */
function referenceGroupsKey(groups: readonly CanvasReferenceGroup[]): string {
  return groups
    .map((group) => group.ids.map((id) => canvasReferenceKey(group.source.id, id)).join("|"))
    .join(";");
}

/**
 * Resolves the Canvas References on screen: one ask per source for the targets
 * it has not answered yet, then a fresh ask for all of them whenever the
 * source says it changed. Answers that arrive after the Canvas closed are
 * dropped, and closing it empties the store.
 */
export function useResolveCanvasReferences(nodes: readonly CanvasNode[]): void {
  const sources = useCanvasReferenceSources();
  const groups = referenceGroups(nodes, sources);
  const groupsKey = referenceGroupsKey(groups);
  // The source object each source id was last asked through on this Canvas.
  const askedThrough = useRef(new Map<string, CanvasReferenceSource>());

  useEffect(() => {
    let live = true;
    const unsubscribes: Array<() => void> = [];

    function merge(
      source: CanvasReferenceSource,
      answers: Record<string, CanvasReferenceResolution>
    ) {
      if (!live || Object.keys(answers).length === 0) return;
      useCanvasReferenceResolutions.getState().mergeAnswers(source.id, answers);
    }

    function resolveNow(source: CanvasReferenceSource, ids: readonly string[]): void {
      source.resolve(ids).then(
        (answers) => merge(source, answers),
        (error: unknown) => {
          if (!live) return;
          console.warn("[canvas] reference resolve failed", { source: source.id, error });
        }
      );
    }

    for (const { source, ids } of groups) {
      // A source object this Canvas has not asked through yet is a Plugin that
      // came back: its answers from before it went off may be stale, so every
      // id is asked again. Otherwise only the ids with no answer are.
      const seenBefore = askedThrough.current.get(source.id);
      askedThrough.current.set(source.id, source);
      const { resolutions } = useCanvasReferenceResolutions.getState();
      const toAsk =
        seenBefore !== undefined && seenBefore !== source
          ? ids
          : ids.filter((id) => resolutions[canvasReferenceKey(source.id, id)] === undefined);
      if (toAsk.length > 0) resolveNow(source, toAsk);

      const { subscribe } = source;
      if (subscribe) unsubscribes.push(subscribe(() => resolveNow(source, ids)));
    }

    return () => {
      live = false;
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
    // A new sources array means a Plugin changed its contributions: regroup even
    // when every group's ids still match, so a returning Plugin is asked again.
  }, [groupsKey, sources]);

  useEffect(
    () => () => {
      useCanvasReferenceResolutions.getState().clear();
    },
    []
  );
}

export async function openCanvasReference(
  node: { source: string; targetId: string },
  context: CanvasReferenceOpenContext
): Promise<CanvasReferenceOpenResult | "unavailable" | "failed"> {
  const source = getCanvasReferenceSource(node.source);
  let result: CanvasReferenceOpenResult | "unavailable" | "failed" = "unavailable";
  if (source) {
    try {
      result = await source.open(node.targetId, context);
    } catch {
      // A source that throws leaves the card as it was, ready to try again.
      result = "failed";
    }
  }
  if (result === "missing") markCanvasReferenceMissing(node.source, node.targetId);
  console.debug("[canvas] reference open", { source: node.source, result });
  return result;
}

export function logCanvasReferencePlaced(source: string): void {
  console.debug("[canvas] reference placed", { source, result: "placed" });
}
