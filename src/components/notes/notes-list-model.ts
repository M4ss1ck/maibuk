import type { Book } from "@/features/books/types";
import type { Note } from "@/features/notes";

export type NotesListViewMode = "list" | "tree";
export type NotesTreeGroupMode = "book" | "tag" | "date";

// Sort key for the notes list, encoded as `<field>-<direction>`.
export type NotesSortOption = "date-desc" | "date-asc" | "title-asc" | "title-desc";

export const DEFAULT_NOTES_SORT: NotesSortOption = "date-desc";

// The gallery's filter bar, persisted between visits alongside the sort order.
export interface NotesFilters {
  search: string;
  tags: string[];
  dateFrom: string;
  dateTo: string;
  showAdvanced: boolean;
}

export const DEFAULT_NOTES_FILTERS: NotesFilters = {
  search: "",
  tags: [],
  dateFrom: "",
  dateTo: "",
  showAdvanced: false,
};

export function normalizeNotesFilters(value: unknown): NotesFilters {
  const candidate = (value && typeof value === "object" ? value : {}) as Partial<
    Record<keyof NotesFilters, unknown>
  >;
  const text = (field: unknown) => (typeof field === "string" ? field : "");

  return {
    search: text(candidate.search),
    tags: Array.isArray(candidate.tags) ? candidate.tags.filter((tag) => typeof tag === "string") : [],
    dateFrom: text(candidate.dateFrom),
    dateTo: text(candidate.dateTo),
    showAdvanced: candidate.showAdvanced === true,
  };
}

export function sortNotesBy(notes: NoteWithBook[], option: NotesSortOption): NoteWithBook[] {
  const [field, direction] = option.split("-");
  const sign = direction === "asc" ? 1 : -1;
  return [...notes].sort((a, b) => {
    const comparison =
      field === "title"
        ? a.title.localeCompare(b.title, undefined, {
            numeric: true,
            sensitivity: "base",
          })
        : a.contentUpdatedAt - b.contentUpdatedAt;
    return comparison * sign;
  });
}

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

export interface NoteFilterCriteria {
  query?: string;
  tag?: string;
  tags?: string[];
  dateFrom?: string;
  dateTo?: string;
}

function collectText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";

  if (Array.isArray(value)) {
    return value.map(collectText).join(" ");
  }

  const node = value as Record<string, unknown>;
  return [node.text, node.content].map(collectText).join(" ");
}

export function notePlainText(content: string): string {
  try {
    return collectText(JSON.parse(content)).replace(/\s+/g, " ").trim();
  } catch {
    return content
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
}

function parseDateBoundary(value: string | undefined, boundary: "start" | "end") {
  if (!value) return null;

  const parts = value.split("-").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null;

  const [year, month, day] = parts;
  const date =
    boundary === "start"
      ? new Date(year, month - 1, day, 0, 0, 0, 0)
      : new Date(year, month - 1, day, 23, 59, 59, 999);

  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function normalizeCriteria(criteria: string | NoteFilterCriteria): NoteFilterCriteria {
  return typeof criteria === "string" ? { query: criteria } : criteria;
}

export function filterNotes(
  notes: NoteWithBook[],
  criteria: string | NoteFilterCriteria
): NoteWithBook[] {
  const filters = normalizeCriteria(criteria);
  const query = filters.query?.trim().toLowerCase() ?? "";
  const tags = (filters.tags ?? (filters.tag ? [filters.tag] : []))
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
  const dateFrom = parseDateBoundary(filters.dateFrom, "start");
  const dateTo = parseDateBoundary(filters.dateTo, "end");

  if (!query && tags.length === 0 && dateFrom === null && dateTo === null) return notes;

  return notes.filter((note) => {
    if (query) {
      const haystack = `${note.title} ${notePlainText(note.content)}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }

    if (tags.length > 0) {
      const noteTags = new Set(note.tags.map((noteTag) => noteTag.trim().toLowerCase()));
      if (!tags.every((tag) => noteTags.has(tag))) return false;
    }

    const updatedTime = noteDate(note).getTime();
    if (dateFrom !== null && updatedTime < dateFrom) return false;
    if (dateTo !== null && updatedTime > dateTo) return false;

    return true;
  });
}

export function buildListNoteSections(
  notes: NoteWithBook[],
  criteria: string | NoteFilterCriteria
): NoteSection[] {
  const filtered = filterNotes(notes, criteria);
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
  return new Date(note.contentUpdatedAt * 1000);
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

  for (const [year, groupedNotes] of [...years.entries()].sort(
    ([a], [b]) => Number(b) - Number(a)
  )) {
    groups.push({ id: year, title: year, notes: groupedNotes });
  }

  return groups.filter((group) => group.notes.length > 0);
}
