import { create } from "zustand";
import type { Background, CoverDoc, CoverScene, Layer } from "./scene/schema";

const HISTORY_LIMIT = 100;

function genId(): string {
  return crypto.randomUUID();
}

function moveItem<T>(arr: T[], from: number, to: number): T[] {
  if (from < 0 || from >= arr.length) return arr;
  const clamped = Math.max(0, Math.min(to, arr.length - 1));
  const next = arr.slice();
  const [item] = next.splice(from, 1);
  next.splice(clamped, 0, item);
  return next;
}

export type AlignEdge = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";

interface CoverStore {
  scene: CoverScene;
  selectedId: string | null;
  dirty: boolean;
  past: CoverScene[];
  future: CoverScene[];
  // Transient editor preferences (not part of the scene/history).
  overlays: boolean;
  snapping: boolean;
  setOverlays: (on: boolean) => void;
  setSnapping: (on: boolean) => void;
  alignSelected: (edge: AlignEdge) => void;

  setScene: (scene: CoverScene) => void;
  select: (id: string | null) => void;
  addLayer: (layer: Layer) => void;
  updateLayer: (id: string, patch: Partial<Layer>) => void;
  removeLayer: (id: string) => void;
  nudgeSelected: (dx: number, dy: number) => void;
  duplicateSelected: () => void;
  reorder: (id: string, toIndex: number) => void;
  bringForward: (id: string) => void;
  sendBackward: (id: string) => void;
  toggleHidden: (id: string) => void;
  toggleLocked: (id: string) => void;
  setBackground: (bg: Background) => void;
  setDoc: (doc: CoverDoc) => void;
  replaceScene: (scene: CoverScene) => void;
  undo: () => void;
  redo: () => void;
  markSaved: () => void;
}

// A safe placeholder scene so the store is usable before a real one is loaded.
const EMPTY_SCENE: CoverScene = {
  schemaVersion: 1,
  doc: { width: 1800, height: 2700, dpi: 300, bleed: 0, safeMargin: 90 },
  background: { type: "solid", color: "#1a1a2e" },
  layers: [],
};

export const useCoverStore = create<CoverStore>((set, get) => {
  /** Push current scene onto history, set the next scene, mark dirty. */
  function commit(next: CoverScene): void {
    const { scene, past } = get();
    const trimmed =
      past.length >= HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT + 1) : past;
    set({ scene: next, past: [...trimmed, scene], future: [], dirty: true });
  }

  function patchLayers(mutate: (layers: Layer[]) => Layer[]): void {
    const { scene } = get();
    commit({ ...scene, layers: mutate(scene.layers) });
  }

  return {
    scene: EMPTY_SCENE,
    selectedId: null,
    dirty: false,
    past: [],
    future: [],
    overlays: true,
    snapping: true,

    setOverlays: (on) => set({ overlays: on }),
    setSnapping: (on) => set({ snapping: on }),

    alignSelected: (edge) => {
      const { selectedId, scene } = get();
      if (!selectedId) return;
      const layer = scene.layers.find((l) => l.id === selectedId);
      if (!layer || layer.locked) return;
      const { width: dw, height: dh } = scene.doc;
      const patch: Partial<Layer> = {};
      if (edge === "left") patch.x = 0;
      else if (edge === "hcenter") patch.x = Math.round((dw - layer.width) / 2);
      else if (edge === "right") patch.x = dw - layer.width;
      else if (edge === "top") patch.y = 0;
      else if (edge === "vcenter") patch.y = Math.round((dh - layer.height) / 2);
      else if (edge === "bottom") patch.y = dh - layer.height;
      patchLayers((layers) =>
        layers.map((l) => (l.id === selectedId ? ({ ...l, ...patch } as Layer) : l))
      );
    },

    setScene: (scene) => set({ scene, selectedId: null, dirty: false, past: [], future: [] }),

    select: (id) => set({ selectedId: id }),

    addLayer: (layer) => {
      const { scene } = get();
      commit({ ...scene, layers: [...scene.layers, layer] });
      set({ selectedId: layer.id });
    },

    updateLayer: (id, patch) =>
      patchLayers((layers) => layers.map((l) => (l.id === id ? ({ ...l, ...patch } as Layer) : l))),

    removeLayer: (id) => {
      patchLayers((layers) => layers.filter((l) => l.id !== id));
      if (get().selectedId === id) set({ selectedId: null });
    },

    nudgeSelected: (dx, dy) => {
      const { selectedId, scene } = get();
      if (!selectedId) return;
      const layer = scene.layers.find((l) => l.id === selectedId);
      if (!layer || layer.locked) return;
      patchLayers((layers) =>
        layers.map((l) => (l.id === selectedId ? { ...l, x: l.x + dx, y: l.y + dy } : l))
      );
    },

    duplicateSelected: () => {
      const { selectedId, scene } = get();
      if (!selectedId) return;
      const layer = scene.layers.find((l) => l.id === selectedId);
      if (!layer) return;
      const copy = { ...layer, id: genId(), x: layer.x + 20, y: layer.y + 20 } as Layer;
      commit({ ...scene, layers: [...scene.layers, copy] });
      set({ selectedId: copy.id });
    },

    reorder: (id, toIndex) =>
      patchLayers((layers) => {
        const from = layers.findIndex((l) => l.id === id);
        return moveItem(layers, from, toIndex);
      }),

    bringForward: (id) =>
      patchLayers((layers) => {
        const from = layers.findIndex((l) => l.id === id);
        return moveItem(layers, from, from + 1);
      }),

    sendBackward: (id) =>
      patchLayers((layers) => {
        const from = layers.findIndex((l) => l.id === id);
        return moveItem(layers, from, from - 1);
      }),

    toggleHidden: (id) =>
      patchLayers((layers) => layers.map((l) => (l.id === id ? { ...l, hidden: !l.hidden } : l))),

    toggleLocked: (id) =>
      patchLayers((layers) => layers.map((l) => (l.id === id ? { ...l, locked: !l.locked } : l))),

    setBackground: (bg) => {
      const { scene } = get();
      commit({ ...scene, background: bg });
    },

    setDoc: (doc) => {
      const { scene } = get();
      commit({ ...scene, doc });
    },

    // Apply a whole new scene (e.g. a template) as an undoable, dirtying change.
    replaceScene: (next) => {
      commit(next);
      set({ selectedId: null });
    },

    undo: () => {
      const { past, scene, future } = get();
      if (past.length === 0) return;
      const previous = past[past.length - 1];
      set({
        scene: previous,
        past: past.slice(0, -1),
        future: [scene, ...future],
        dirty: true,
      });
    },

    redo: () => {
      const { future, scene, past } = get();
      if (future.length === 0) return;
      const next = future[0];
      set({
        scene: next,
        future: future.slice(1),
        past: [...past, scene],
        dirty: true,
      });
    },

    markSaved: () => set({ dirty: false }),
  };
});
