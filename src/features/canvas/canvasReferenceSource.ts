import { Network } from "lucide-react";
import { useCanvasStore } from "@/features/canvas/store";
import type { Canvas } from "@/features/canvas/types";
import type {
  CanvasReferenceOpenResult,
  CanvasReferenceResolution,
  CanvasReferenceRow,
  CanvasReferenceSource,
} from "@/features/canvas/references";

// The picker can open before the Gallery has ever read the Canvases table, so
// the first answer waits for that read. Only the first good one: the host
// re-resolves when the store changes, and loading again from inside resolve
// would loop. loadCanvases never rejects; a failed read shows up as the store's
// error, and must fail the ask rather than answer every Canvas missing.
let loaded: Promise<void> | null = null;

function loadOnce(): Promise<void> {
  loaded ??= useCanvasStore
    .getState()
    .loadCanvases()
    .then(() => {
      const { galleryError } = useCanvasStore.getState();
      if (galleryError) throw new Error(galleryError);
    })
    .catch((error: unknown) => {
      loaded = null;
      throw error;
    });
  return loaded;
}

function findCanvas(id: string): Canvas | undefined {
  return useCanvasStore.getState().canvases.find((canvas) => canvas.id === id);
}

/** Canvas References pointing at Canvases: Gallery rows, opened at their own route. */
export const canvasReferenceSource: CanvasReferenceSource = {
  id: "canvas",
  label: "canvas.referenceSources.canvas",
  icon: Network,
  card: "canvas",

  async list(query, { canvasId }): Promise<CanvasReferenceRow[]> {
    await loadOnce();
    const needle = query.trim().toLocaleLowerCase();
    return useCanvasStore
      .getState()
      .canvases.filter(
        (canvas) => canvas.id !== canvasId && canvas.title.toLocaleLowerCase().includes(needle)
      )
      .map((canvas) => ({ id: canvas.id, title: canvas.title }));
  },

  async resolve(ids): Promise<Record<string, CanvasReferenceResolution>> {
    await loadOnce();
    const answers: Record<string, CanvasReferenceResolution> = {};
    for (const id of ids) {
      const canvas = findCanvas(id);
      answers[id] = canvas
        ? { status: "present", title: canvas.title, value: canvas }
        : { status: "missing" };
    }
    return answers;
  },

  async open(id, { canvasId, canvasTitle, navigate }): Promise<CanvasReferenceOpenResult> {
    const canvas = findCanvas(id);
    if (!canvas) return "missing";
    navigate(`/canvas/${id}`, {
      state: { returnTo: `/canvas/${canvasId}`, returnLabel: canvasTitle },
    });
    return "opened";
  },

  subscribe(listener) {
    return useCanvasStore.subscribe((state, previous) => {
      if (state.canvases !== previous.canvases) listener();
    });
  },
};
