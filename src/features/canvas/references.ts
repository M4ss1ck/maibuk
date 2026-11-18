import type { LucideIcon } from "lucide-react";
import { useEffect } from "react";
import type { NavigateFunction } from "react-router-dom";
import { create } from "zustand";
import { noteReferenceSource } from "@/features/canvas/noteReferenceSource";
import type { CanvasNode } from "@/features/canvas/types";

/**
 * Canvas References reach their targets only through a source. The picker, the
 * cards, and the Canvas page see this interface and the registry below, never
 * a Note (or Book, Plugin item, ...) directly. Answers live in memory beside the
 * Canvas and are never written into the Canvas document.
 */

/** Each card kind draws in one fixed box, whatever state it is in. */
export type CanvasReferenceCardKind = "note";

export const CANVAS_REFERENCE_CARD_SIZES: Record<
  CanvasReferenceCardKind,
  { width: number; height: number }
> = {
  note: { width: 224, height: 176 },
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
  /** i18n key of the picker tab label. */
  label: string;
  icon: LucideIcon;
  card: CanvasReferenceCardKind;
  list(query: string, context: { canvasId: string }): Promise<CanvasReferenceRow[]>;
  /** Answers every id asked; an id left out of the answer counts as unresolved. */
  resolve(ids: readonly string[]): Promise<Record<string, CanvasReferenceResolution>>;
  open(id: string, context: CanvasReferenceOpenContext): Promise<CanvasReferenceOpenResult>;
  /** Host sources stay live: the host re-resolves when the listener fires. */
  subscribe?(listener: () => void): () => void;
}

/**
 * The one place listing the Canvas Reference sources: every registered source
 * appears here exactly once, and nowhere else.
 */
export const CANVAS_REFERENCE_SOURCES: readonly CanvasReferenceSource[] = [noteReferenceSource];

export function getCanvasReferenceSource(id: string): CanvasReferenceSource | undefined {
  return CANVAS_REFERENCE_SOURCES.find((source) => source.id === id);
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
function referenceGroups(nodes: readonly CanvasNode[]): CanvasReferenceGroup[] {
  const idsBySource = new Map<string, Set<string>>();
  for (const node of nodes) {
    if (node.kind !== "reference") continue;
    if (!getCanvasReferenceSource(node.source)) continue;
    const ids = idsBySource.get(node.source) ?? new Set<string>();
    ids.add(node.targetId);
    idsBySource.set(node.source, ids);
  }

  const groups: CanvasReferenceGroup[] = [];
  for (const [id, ids] of idsBySource) {
    const source = getCanvasReferenceSource(id);
    if (source) groups.push({ source, ids: [...ids] });
  }
  return groups;
}

/** One stable string per set of grouped references, so a reorder never re-resolves. */
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
  const groups = referenceGroups(nodes);
  const groupsKey = referenceGroupsKey(groups);

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
      const { resolutions } = useCanvasReferenceResolutions.getState();
      const unanswered = ids.filter(
        (id) => resolutions[canvasReferenceKey(source.id, id)] === undefined
      );
      if (unanswered.length > 0) resolveNow(source, unanswered);

      const { subscribe } = source;
      if (subscribe) unsubscribes.push(subscribe(() => resolveNow(source, ids)));
    }

    return () => {
      live = false;
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [groupsKey]);

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
): Promise<CanvasReferenceOpenResult | "unavailable"> {
  const source = getCanvasReferenceSource(node.source);
  const result = source ? await source.open(node.targetId, context) : "unavailable";
  if (result === "missing") markCanvasReferenceMissing(node.source, node.targetId);
  console.debug("[canvas] reference open", { source: node.source, result });
  return result;
}

export function logCanvasReferencePlaced(source: string): void {
  console.debug("[canvas] reference placed", { source, result: "placed" });
}
