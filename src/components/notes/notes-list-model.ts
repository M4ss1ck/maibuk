import type { Book } from "../../features/books/types";
import type { Note } from "../../features/notes";

export type NotesListViewMode = "list" | "tree";
export type NotesTreeGroupMode = "book" | "tag" | "date";

export type NoteWithBook = Note & { bookId?: string | null };

export interface NoteSection {
  id: "pinned" | "all";
  notes: NoteWithBook[];
}

export interface BookNoteGroup {
  id: string;
  title: string;
  book: Book | null;
  notes: NoteWithBook[];
}

export interface TagNoteGroup {
  id: string;
  title: string;
  tag: string;
  notes: NoteWithBook[];
}

export interface DateNoteGroup {
  id: string;
  title: string;
  notes: NoteWithBook[];
}

function plainText(html: string): string {
  return html.replace(/<[^>]*>/g, " ");
}

export function filterNotes(notes: NoteWithBook[], rawQuery: string): NoteWithBook[] {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return notes;

  return notes.filter((note) => {
    const haystack = `${note.title} ${plainText(note.content)}`.toLowerCase();
    return haystack.includes(query);
  });
}

export function buildListNoteSections(notes: NoteWithBook[], query: string): NoteSection[] {
  const filtered = filterNotes(notes, query);
  return [
    { id: "pinned", notes: filtered.filter((note) => note.pinned) },
    { id: "all", notes: filtered.filter((note) => !note.pinned) },
  ];
}

export function buildBookNoteGroups(notes: NoteWithBook[], books: Book[]): BookNoteGroup[] {
  const groups = books.map((book) => ({
    id: book.id,
    title: book.title,
    book,
    notes: notes.filter((note) => note.bookId === book.id),
  }));
  const knownBookIds = new Set(books.map((book) => book.id));
  const unfiled = notes.filter((note) => !note.bookId || !knownBookIds.has(note.bookId));

  return [...groups, { id: "unfiled", title: "Unfiled", book: null, notes: unfiled }];
}

export function buildTagNoteGroups(notes: NoteWithBook[]): TagNoteGroup[] {
  const groups = new Map<string, NoteWithBook[]>();

  for (const note of notes) {
    for (const rawTag of note.tags) {
      const tag = rawTag.trim();
      if (!tag) continue;
      groups.set(tag, [...(groups.get(tag) ?? []), note]);
    }
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tag, groupedNotes]) => ({
      id: tag,
      title: tag,
      tag,
      notes: groupedNotes,
    }));
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfWeek(date: Date): Date {
  const day = date.getDay();
  const diff = day === 0 ? 6 : day - 1;
  const start = startOfDay(date);
  start.setDate(start.getDate() - diff);
  return start;
}

function noteDate(note: Note): Date {
  return new Date(note.updatedAt * 1000);
}

export function buildDateNoteGroups(notes: NoteWithBook[], now = new Date()): DateNoteGroup[] {
  const todayStart = startOfDay(now).getTime();
  const tomorrowStart = todayStart + 24 * 60 * 60 * 1000;
  const weekStart = startOfWeek(now).getTime();
  const today: NoteWithBook[] = [];
  const thisWeek: NoteWithBook[] = [];
  const years = new Map<string, NoteWithBook[]>();

  for (const note of notes) {
    const updated = noteDate(note).getTime();
    if (updated >= todayStart && updated < tomorrowStart) {
      today.push(note);
      continue;
    }
    if (updated >= weekStart && updated < todayStart) {
      thisWeek.push(note);
      continue;
    }

    const year = String(noteDate(note).getFullYear());
    years.set(year, [...(years.get(year) ?? []), note]);
  }

  const groups: DateNoteGroup[] = [
    { id: "today", title: "Today", notes: today },
    { id: "this-week", title: "This week", notes: thisWeek },
  ];

  for (const [year, groupedNotes] of [...years.entries()].sort(([a], [b]) => Number(b) - Number(a))) {
    groups.push({ id: year, title: year, notes: groupedNotes });
  }

  return groups.filter((group) => group.notes.length > 0);
}
