import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CanvasViewport } from "@/features/canvas/types";

export interface ReadingPosition {
  /** ProseMirror document position of the caret (selection.from). */
  caret: number;
  /** ProseMirror document position of the block at the top of the viewport. */
  top: number;
  updatedAt: number;
}

/** Cap on stored entries; oldest are evicted. Stale entries are harmless. */
export const MAX_READING_POSITIONS = 200;

function isValidViewport(value: unknown): value is CanvasViewport {
  if (typeof value !== "object" || value === null) return false;
  const viewport = value as Record<string, unknown>;
  return (
    typeof viewport.x === "number" &&
    Number.isFinite(viewport.x) &&
    typeof viewport.y === "number" &&
    Number.isFinite(viewport.y) &&
    typeof viewport.zoom === "number" &&
    Number.isFinite(viewport.zoom) &&
    viewport.zoom > 0
  );
}

interface ReadingPositionStore {
  positions: Record<string, ReadingPosition>;
  getPosition: (key: string) => ReadingPosition | undefined;
  savePosition: (key: string, position: { caret: number; top: number }) => void;
  /** Device-local pan and zoom per canvas (ADR 0004). Never synced. */
  canvasViewports: Record<string, CanvasViewport>;
  getCanvasViewport: (canvasId: string) => CanvasViewport | undefined;
  saveCanvasViewport: (canvasId: string, viewport: CanvasViewport) => void;
}

export const useReadingPositionStore = create<ReadingPositionStore>()(
  persist(
    (set, get) => ({
      positions: {},
      getPosition: (key) => get().positions[key],
      savePosition: (key, position) => {
        set((state) => {
          const next: Record<string, ReadingPosition> = {
            ...state.positions,
            [key]: {
              caret: position.caret,
              top: position.top,
              updatedAt: Date.now(),
            },
          };
          const keys = Object.keys(next);
          if (keys.length > MAX_READING_POSITIONS) {
            const oldestFirst = keys.sort((a, b) => next[a].updatedAt - next[b].updatedAt);
            for (const staleKey of oldestFirst.slice(0, keys.length - MAX_READING_POSITIONS)) {
              delete next[staleKey];
            }
          }
          return { positions: next };
        });
      },
      canvasViewports: {},
      getCanvasViewport: (canvasId) => get().canvasViewports[canvasId],
      saveCanvasViewport: (canvasId, viewport) => {
        if (!isValidViewport(viewport)) return;
        set((state) => ({
          canvasViewports: {
            ...state.canvasViewports,
            [canvasId]: { x: viewport.x, y: viewport.y, zoom: viewport.zoom },
          },
        }));
      },
    }),
    { name: "maibuk-reading-position" }
  )
);
