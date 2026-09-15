import { create } from "zustand";
import { getDatabase } from "@/lib/db";
import {
  createNoteRow,
  deleteNoteRow,
  reorderNoteRows,
  saveCollapsedHeadingsRow,
  toNote,
  updateNoteRow,
} from "@/features/notes/write";
import type {
  CreateNoteInput,
  Note,
  ReorderNoteItem,
  UpdateNoteInput,
} from "@/features/notes/types";

// Pinned notes float to the top; ties broken by manual order.
function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return a.order - b.order;
  });
}

interface NoteStore {
  notes: Note[];
  currentNote: Note | null;
  isLoading: boolean;
  error: string | null;
  loadNotes: () => Promise<void>;
  loadNote: (id: string) => Promise<void>;
  /**
   * Re-read notes after something outside the UI changed them (a sync pull).
   * Also replaces the open note with its fresh row so its editor shows the new
   * content; never flips isLoading.
   */
  refreshNotes: () => Promise<void>;
  createNote: (input: CreateNoteInput) => Promise<Note>;
  /** Resolves with the note as stored, or null when it no longer exists. */
  updateNote: (input: UpdateNoteInput) => Promise<Note | null>;
  deleteNote: (id: string) => Promise<void>;
  reorderNotes: (orderedItems: string[] | ReorderNoteItem[]) => Promise<void>;
  setCurrentNote: (note: Note | null) => void;
  saveCollapsedHeadings: (noteId: string, collapsedHeadings: string[]) => Promise<void>;
}

export const useNoteStore = create<NoteStore>((set) => ({
  notes: [],
  currentNote: null,
  isLoading: false,
  error: null,

  loadNotes: async () => {
    set({ isLoading: true, error: null });
    try {
      const db = await getDatabase();
      const rows = await db.select<Record<string, unknown>[]>(
        'SELECT * FROM notes ORDER BY pinned DESC, "order" ASC'
      );
      set({ notes: rows.map(toNote), isLoading: false });
    } catch (error) {
      set({ error: String(error), isLoading: false });
    }
  },

  loadNote: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const db = await getDatabase();
      const rows = await db.select<Record<string, unknown>[]>("SELECT * FROM notes WHERE id = ?", [
        id,
      ]);
      set({ currentNote: rows.length > 0 ? toNote(rows[0]) : null, isLoading: false });
    } catch (error) {
      set({ error: String(error), isLoading: false });
    }
  },

  refreshNotes: async () => {
    const db = await getDatabase();
    const rows = await db.select<Record<string, unknown>[]>(
      'SELECT * FROM notes ORDER BY pinned DESC, "order" ASC'
    );
    const notes = rows.map(toNote);
    set((state) => ({
      notes,
      currentNote: state.currentNote
        ? (notes.find((note) => note.id === state.currentNote?.id) ?? state.currentNote)
        : null,
    }));
  },

  createNote: async (input: CreateNoteInput) => {
    // The write path persists, returns the stored note, and emits the Change.
    const note = await createNoteRow(input, "local");

    set((state) => ({ notes: sortNotes([...state.notes, note]) }));
    return note;
  },

  updateNote: async (input: UpdateNoteInput) => {
    // The write path persists, returns the stored note, and emits the Change.
    const updated = await updateNoteRow(input, "local");
    if (!updated) return null;

    set((state) => ({
      notes: sortNotes(state.notes.map((n) => (n.id === updated.id ? updated : n))),
      currentNote: state.currentNote?.id === updated.id ? updated : state.currentNote,
    }));

    return updated;
  },

  deleteNote: async (id: string) => {
    // The write path records the tombstone, deletes, and emits the Change.
    await deleteNoteRow(id, "local");

    set((state) => ({
      notes: state.notes.filter((n) => n.id !== id),
      currentNote: state.currentNote?.id === id ? null : state.currentNote,
    }));
  },

  reorderNotes: async (orderedItems: string[] | ReorderNoteItem[]) => {
    // The write path persists the order and emits the Change.
    await reorderNoteRows(orderedItems, "local");
    const db = await getDatabase();
    const rows = await db.select<Record<string, unknown>[]>(
      'SELECT * FROM notes ORDER BY pinned DESC, "order" ASC'
    );
    const notes = rows.map(toNote);
    set((state) => ({
      notes,
      currentNote: state.currentNote
        ? (notes.find((note) => note.id === state.currentNote?.id) ?? state.currentNote)
        : null,
    }));
  },

  saveCollapsedHeadings: async (noteId: string, collapsedHeadings: string[]) => {
    // Editor view state: no Change is emitted.
    await saveCollapsedHeadingsRow(noteId, collapsedHeadings);

    set((state) => ({
      notes: state.notes.map((n) => (n.id === noteId ? { ...n, collapsedHeadings } : n)),
      currentNote:
        state.currentNote?.id === noteId
          ? { ...state.currentNote, collapsedHeadings }
          : state.currentNote,
    }));
  },

  setCurrentNote: (note: Note | null) => set({ currentNote: note }),
}));
