import { StickyNote } from "lucide-react";
import { type Note, useNoteStore } from "@/features/notes";
import type {
  CanvasReferenceOpenResult,
  CanvasReferenceResolution,
  CanvasReferenceRow,
  CanvasReferenceSource,
} from "@/features/canvas/references";

// The picker can open before the Library has ever read the Notes table, so the
// first answer waits for that read. Only the first good one: the host
// re-resolves when the store changes, and loading again from inside resolve
// would loop. loadNotes never rejects; a failed read shows up as the store's
// error, and must fail the ask rather than answer every Note missing.
let loaded: Promise<void> | null = null;

function loadOnce(): Promise<void> {
  loaded ??= useNoteStore
    .getState()
    .loadNotes()
    .then(() => {
      const { error } = useNoteStore.getState();
      if (error) throw new Error(error);
    })
    .catch((error: unknown) => {
      loaded = null;
      throw error;
    });
  return loaded;
}

function findNote(id: string): Note | undefined {
  return useNoteStore.getState().notes.find((note) => note.id === id);
}

/** Canvas References pointing at Notes: same rows, order, and navigation as the Canvas picker. */
export const noteReferenceSource: CanvasReferenceSource = {
  id: "note",
  label: "canvas.referenceSources.note",
  icon: StickyNote,
  card: "note",

  async list(query): Promise<CanvasReferenceRow[]> {
    await loadOnce();
    const needle = query.trim().toLocaleLowerCase();
    return useNoteStore
      .getState()
      .notes.filter((note) => note.title.toLocaleLowerCase().includes(needle))
      .sort((a, b) => a.order - b.order)
      .map((note) => ({ id: note.id, title: note.title }));
  },

  async resolve(ids): Promise<Record<string, CanvasReferenceResolution>> {
    await loadOnce();
    const answers: Record<string, CanvasReferenceResolution> = {};
    for (const id of ids) {
      const note = findNote(id);
      answers[id] = note
        ? { status: "present", title: note.title, value: note }
        : { status: "missing" };
    }
    return answers;
  },

  async open(id, { canvasId, canvasTitle, navigate }): Promise<CanvasReferenceOpenResult> {
    if (!findNote(id)) return "missing";
    navigate(`/notes/${id}`, {
      state: { returnTo: `/canvas/${canvasId}`, returnLabel: canvasTitle },
    });
    return "opened";
  },

  subscribe(listener) {
    return useNoteStore.subscribe((state, previous) => {
      if (state.notes !== previous.notes) listener();
    });
  },
};
