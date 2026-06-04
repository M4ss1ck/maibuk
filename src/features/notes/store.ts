import { create } from "zustand";
import { getDatabase } from "../../lib/db";
import { recordTombstone } from "../sync/tombstones";
import type { CreateNoteInput, Note, UpdateNoteInput } from "./types";

function generateId(): string {
  return crypto.randomUUID();
}

function parseTags(raw: unknown): string[] {
  if (typeof raw !== "string" || raw.length === 0) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

function toModel(row: Record<string, unknown>): Note {
  return {
    id: row.id as string,
    title: row.title as string,
    content: (row.content as string) ?? "",
    tags: parseTags(row.tags),
    pinned: Boolean(row.pinned),
    order: row.order as number,
    wordCount: (row.word_count as number) ?? 0,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

// Pinned notes float to the top; ties broken by manual order.
function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return a.order - b.order;
  });
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

interface NoteStore {
  notes: Note[];
  currentNote: Note | null;
  isLoading: boolean;
  error: string | null;
  loadNotes: () => Promise<void>;
  loadNote: (id: string) => Promise<void>;
  createNote: (input: CreateNoteInput) => Promise<Note>;
  updateNote: (input: UpdateNoteInput) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
  reorderNotes: (orderedIds: string[]) => Promise<void>;
  setCurrentNote: (note: Note | null) => void;
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
        'SELECT * FROM notes ORDER BY pinned DESC, "order" ASC',
      );
      set({ notes: rows.map(toModel), isLoading: false });
    } catch (error) {
      set({ error: String(error), isLoading: false });
    }
  },

  loadNote: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const db = await getDatabase();
      const rows = await db.select<Record<string, unknown>[]>(
        "SELECT * FROM notes WHERE id = ?",
        [id],
      );
      set({ currentNote: rows.length > 0 ? toModel(rows[0]) : null, isLoading: false });
    } catch (error) {
      set({ error: String(error), isLoading: false });
    }
  },

  createNote: async (input: CreateNoteInput) => {
    const db = await getDatabase();
    const id = generateId();
    const now = nowSeconds();

    const orderResult = await db.select<{ max_order: number | null }[]>(
      'SELECT MAX("order") as max_order FROM notes',
    );
    const order = input.order ?? (orderResult[0]?.max_order ?? -1) + 1;

    const note: Note = {
      id,
      title: input.title,
      content: input.content ?? "",
      tags: input.tags ?? [],
      pinned: input.pinned ?? false,
      order,
      wordCount: input.wordCount ?? 0,
      createdAt: now,
      updatedAt: now,
    };

    await db.execute(
      `INSERT INTO notes (id, title, content, tags, pinned, "order", word_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        note.id,
        note.title,
        note.content,
        JSON.stringify(note.tags),
        note.pinned ? 1 : 0,
        note.order,
        note.wordCount,
        note.createdAt,
        note.updatedAt,
      ],
    );

    set((state) => ({ notes: sortNotes([...state.notes, note]) }));
    return note;
  },

  updateNote: async (input: UpdateNoteInput) => {
    const db = await getDatabase();
    const rows = await db.select<Record<string, unknown>[]>(
      "SELECT * FROM notes WHERE id = ?",
      [input.id],
    );
    if (rows.length === 0) return;
    const existing = toModel(rows[0]);
    const updated: Note = { ...existing, ...input, updatedAt: nowSeconds() };

    await db.execute(
      `UPDATE notes SET title = ?, content = ?, tags = ?, pinned = ?, "order" = ?, word_count = ?, updated_at = ? WHERE id = ?`,
      [
        updated.title,
        updated.content,
        JSON.stringify(updated.tags),
        updated.pinned ? 1 : 0,
        updated.order,
        updated.wordCount,
        updated.updatedAt,
        updated.id,
      ],
    );

    set((state) => ({
      notes: sortNotes(state.notes.map((n) => (n.id === updated.id ? updated : n))),
      currentNote: state.currentNote?.id === updated.id ? updated : state.currentNote,
    }));
  },

  deleteNote: async (id: string) => {
    const db = await getDatabase();
    const rows = await db.select<{ title: string }[]>("SELECT title FROM notes WHERE id = ?", [
      id,
    ]);
    if (rows.length > 0) {
      await recordTombstone({
        entityType: "note",
        entityId: id,
        title: rows[0].title,
      });
    }
    await db.execute("DELETE FROM notes WHERE id = ?", [id]);
    set((state) => ({
      notes: state.notes.filter((n) => n.id !== id),
      currentNote: state.currentNote?.id === id ? null : state.currentNote,
    }));
  },

  reorderNotes: async (orderedIds: string[]) => {
    const db = await getDatabase();
    const now = nowSeconds();
    for (let i = 0; i < orderedIds.length; i++) {
      await db.execute('UPDATE notes SET "order" = ?, updated_at = ? WHERE id = ?', [
        i,
        now,
        orderedIds[i],
      ]);
    }
    set((state) => ({
      notes: sortNotes(
        state.notes.map((n) => {
          const idx = orderedIds.indexOf(n.id);
          return idx >= 0 ? { ...n, order: idx } : n;
        }),
      ),
    }));
  },

  setCurrentNote: (note: Note | null) => set({ currentNote: note }),
}));
