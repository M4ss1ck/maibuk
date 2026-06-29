import { create } from "zustand";
import { getDatabase } from "../../lib/db";
import { recordTombstone } from "../sync/tombstones";
import { reindexSource } from "../links/link-index";
import type { CreateNoteInput, Note, ReorderNoteItem, UpdateNoteInput } from "./types";

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

function parseCollapsedHeadings(raw: unknown): string[] {
  if (typeof raw !== "string" || raw.length === 0) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function toModel(row: Record<string, unknown>): Note {
  return {
    id: row.id as string,
    bookId: row.book_id as string | null | undefined,
    title: row.title as string,
    content: (row.content as string) ?? "",
    language: (row.language as string | null) ?? "en",
    tags: parseTags(row.tags),
    pinned: Boolean(row.pinned),
    order: row.order as number,
    wordCount: (row.word_count as number) ?? 0,
    collapsedHeadings: parseCollapsedHeadings(row.collapsed_headings),
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
    // Fall back to updated_at for rows created before the column existed.
    contentUpdatedAt: (row.content_updated_at as number | null) ?? (row.updated_at as number),
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
      set({ notes: rows.map(toModel), isLoading: false });
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
      'SELECT MAX("order") as max_order FROM notes'
    );
    const order = input.order ?? (orderResult[0]?.max_order ?? -1) + 1;

    const note: Note = {
      id,
      bookId: input.bookId ?? null,
      title: input.title,
      content: input.content ?? "",
      language: input.language ?? "en",
      tags: input.tags ?? [],
      pinned: input.pinned ?? false,
      order,
      wordCount: input.wordCount ?? 0,
      collapsedHeadings: input.collapsedHeadings ?? [],
      createdAt: now,
      updatedAt: now,
      contentUpdatedAt: now,
    };

    await db.execute(
      `INSERT INTO notes (id, book_id, title, content, language, tags, pinned, "order", word_count, collapsed_headings, created_at, updated_at, content_updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        note.id,
        note.bookId ?? null,
        note.title,
        note.content,
        note.language,
        JSON.stringify(note.tags),
        note.pinned ? 1 : 0,
        note.order,
        note.wordCount,
        JSON.stringify(note.collapsedHeadings),
        note.createdAt,
        note.updatedAt,
        note.contentUpdatedAt,
      ]
    );

    set((state) => ({ notes: sortNotes([...state.notes, note]) }));
    return note;
  },

  updateNote: async (input: UpdateNoteInput) => {
    const db = await getDatabase();
    const rows = await db.select<Record<string, unknown>[]>("SELECT * FROM notes WHERE id = ?", [
      input.id,
    ]);
    if (rows.length === 0) return;
    const existing = toModel(rows[0]);
    const now = nowSeconds();
    // Tagging, pinning, filing, and reordering are organizational changes, not
    // edits to the note's text. Only title/content changes bump the user-facing
    // "modified" time; updated_at always bumps as the sync conflict clock.
    const contentChanged =
      (input.title !== undefined && input.title !== existing.title) ||
      (input.content !== undefined && input.content !== existing.content);
    const updated: Note = {
      ...existing,
      ...input,
      updatedAt: now,
      contentUpdatedAt: contentChanged ? now : existing.contentUpdatedAt,
    };

    await db.execute(
      `UPDATE notes SET book_id = ?, title = ?, content = ?, language = ?, tags = ?, pinned = ?, "order" = ?, word_count = ?, collapsed_headings = ?, updated_at = ?, content_updated_at = ? WHERE id = ?`,
      [
        updated.bookId ?? null,
        updated.title,
        updated.content,
        updated.language,
        JSON.stringify(updated.tags),
        updated.pinned ? 1 : 0,
        updated.order,
        updated.wordCount,
        JSON.stringify(updated.collapsedHeadings),
        updated.updatedAt,
        updated.contentUpdatedAt,
        updated.id,
      ]
    );

    set((state) => ({
      notes: sortNotes(state.notes.map((n) => (n.id === updated.id ? updated : n))),
      currentNote: state.currentNote?.id === updated.id ? updated : state.currentNote,
    }));

    if (input.content !== undefined) {
      await reindexSource({
        sourceType: "note",
        sourceId: updated.id,
        contentHtml: updated.content,
      });
    }
  },

  deleteNote: async (id: string) => {
    const db = await getDatabase();
    const rows = await db.select<{ title: string }[]>("SELECT title FROM notes WHERE id = ?", [id]);
    if (rows.length > 0) {
      await recordTombstone({
        entityType: "note",
        entityId: id,
        title: rows[0].title,
      });
    }
    await db.execute("DELETE FROM notes WHERE id = ?", [id]);
    await db.execute("DELETE FROM links WHERE source_id = ?", [id]).catch(() => {});
    set((state) => ({
      notes: state.notes.filter((n) => n.id !== id),
      currentNote: state.currentNote?.id === id ? null : state.currentNote,
    }));
  },

  reorderNotes: async (orderedItems: string[] | ReorderNoteItem[]) => {
    const db = await getDatabase();
    const now = nowSeconds();
    const ordered = orderedItems.map((item) =>
      typeof item === "string" ? { id: item, pinned: undefined } : item
    );

    for (let i = 0; i < ordered.length; i++) {
      const item = ordered[i];
      if (item.pinned === undefined) {
        await db.execute('UPDATE notes SET "order" = ?, updated_at = ? WHERE id = ?', [
          i,
          now,
          item.id,
        ]);
      } else {
        await db.execute('UPDATE notes SET "order" = ?, pinned = ?, updated_at = ? WHERE id = ?', [
          i,
          item.pinned ? 1 : 0,
          now,
          item.id,
        ]);
      }
    }

    const reorderById = new Map(ordered.map((item, index) => [item.id, { ...item, index }]));
    const applyReorder = (note: Note) => {
      const item = reorderById.get(note.id);
      if (!item) return note;
      return {
        ...note,
        order: item.index,
        pinned: item.pinned ?? note.pinned,
        updatedAt: now,
      };
    };

    set((state) => ({
      notes: sortNotes(state.notes.map(applyReorder)),
      currentNote: state.currentNote ? applyReorder(state.currentNote) : state.currentNote,
    }));
  },

  saveCollapsedHeadings: async (noteId: string, collapsedHeadings: string[]) => {
    const db = await getDatabase();
    await db.execute("UPDATE notes SET collapsed_headings = ? WHERE id = ?", [
      JSON.stringify(collapsedHeadings),
      noteId,
    ]);

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
