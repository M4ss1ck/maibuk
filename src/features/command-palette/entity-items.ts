import type { Book } from "@/features/books/types";
import type { Canvas } from "@/features/canvas/types";
import type { ChapterTitle } from "@/features/chapters/store";
import type { Note } from "@/features/notes/types";
import type {
  PaletteItem,
  PalettePage,
  PaletteTranslate,
} from "@/features/command-palette/palette-index";

export interface BuildEntityItemsOptions {
  books: readonly Pick<Book, "id" | "title">[];
  /** Chapter titles across all Books, without their content. */
  chapters: readonly ChapterTitle[];
  notes: readonly Pick<Note, "id" | "title" | "bookId">[];
  canvases: readonly Pick<Canvas, "id" | "title">[];
  t: PaletteTranslate;
}

/** The label an untitled entity gets, per kind, from the screen that shows it. */
const UNTITLED_KEY = {
  note: "notes.untitled",
  canvas: "canvas.untitled",
} as const;

function titled(title: string, untitledKey: string, t: PaletteTranslate): string {
  if (title.trim() !== "") return title;
  const fallback = t(untitledKey);
  return typeof fallback === "string" && fallback !== "" ? fallback : title;
}

/**
 * Books, Chapters, Notes, and Canvases as palette items. A Chapter carries its
 * Book's title and id: the detail tells two "Chapter 1" results apart, and the
 * id is what the ranking boost and the Chapter page filter on. A Book Note
 * carries its Book's title too; an Unfiled Note has none to show.
 */
export function buildEntityItems({
  books,
  chapters,
  notes,
  canvases,
  t,
}: BuildEntityItemsOptions): PaletteItem[] {
  const items: PaletteItem[] = [];
  const bookTitle = new Map<string, string>();
  for (const book of books) bookTitle.set(book.id, book.title);

  for (const book of books) {
    items.push({
      key: `book:${book.id}`,
      kind: "book",
      id: book.id,
      label: book.title,
      terms: [],
      state: "runnable",
    });
  }
  for (const chapter of chapters) {
    items.push({
      key: `chapter:${chapter.id}`,
      kind: "chapter",
      id: chapter.id,
      label: chapter.title,
      terms: [],
      state: "runnable",
      detail: bookTitle.get(chapter.bookId),
      bookId: chapter.bookId,
    });
  }
  for (const note of notes) {
    items.push({
      key: `note:${note.id}`,
      kind: "note",
      id: note.id,
      label: titled(note.title, UNTITLED_KEY.note, t),
      terms: [],
      state: "runnable",
      detail: note.bookId ? bookTitle.get(note.bookId) : undefined,
    });
  }
  for (const canvas of canvases) {
    items.push({
      key: `canvas:${canvas.id}`,
      kind: "canvas",
      id: canvas.id,
      label: titled(canvas.title, UNTITLED_KEY.canvas, t),
      terms: [],
      state: "runnable",
    });
  }
  return items;
}

export interface BuildPageItemsOptions {
  t: PaletteTranslate;
  /** The Book Editor is the only screen with an open Book to list Chapters of. */
  inBookEditor: boolean;
}

/**
 * The nested pages: each one narrows the list to one kind and is a root result
 * that sets the page instead of opening anything. Open Chapter… only exists in
 * the Book Editor, where there is an open Book whose Chapters can be listed.
 */
export function buildPageItems({ t, inBookEditor }: BuildPageItemsOptions): PaletteItem[] {
  const pages: readonly PalettePage[] = inBookEditor
    ? ["chapters", "books", "notes", "canvases"]
    : ["books", "notes", "canvases"];
  return pages.map((page) => {
    const label = t(`commandPalette.pages.${page}`);
    return {
      key: `page:${page}`,
      kind: "page" as const,
      id: page,
      label: typeof label === "string" ? label : page,
      terms: [],
      state: "runnable" as const,
      targetPage: page,
    };
  });
}
