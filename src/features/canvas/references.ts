import type { LucideIcon } from "lucide-react";
import type { NavigateFunction } from "react-router-dom";
import { noteReferenceSource } from "@/features/canvas/noteReferenceSource";

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

/** `value` is what the source's card kind draws; the card for that kind knows its shape. */
export type CanvasReferenceResolution =
  | { status: "present"; value: unknown }
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
