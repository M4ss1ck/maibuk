import { FileText } from "lucide-react";
import { useBookStore } from "@/features/books/store";
import { getChaptersByIds, listChapterTitles, useChapterStore } from "@/features/chapters/store";
import type {
  CanvasReferenceOpenResult,
  CanvasReferenceResolution,
  CanvasReferenceRow,
  CanvasReferenceSource,
} from "@/features/canvas/references";

/** What a Chapter card draws: the Chapter as stored, plus the title of its Book. */
export interface ChapterReferenceValue {
  id: string;
  bookId: string;
  title: string;
  content: string | null;
  updatedAt: Date;
  bookTitle: string;
}

// The picker can open before the Library has ever read the Books table, so the
// first answer waits for that read. Only the first good one: the host
// re-resolves when the store changes, and loading again from inside resolve
// would loop. loadBooks never rejects; a failed read shows up as the store's
// error, and must fail the ask rather than answer every Book missing.
let loaded: Promise<void> | null = null;

function loadOnce(): Promise<void> {
  loaded ??= useBookStore
    .getState()
    .loadBooks()
    .then(() => {
      const { error } = useBookStore.getState();
      if (error) throw new Error(error);
    })
    .catch((error: unknown) => {
      loaded = null;
      throw error;
    });
  return loaded;
}

/** Each Book's title, the line a Chapter row shows under its own. */
function bookTitles(): Map<string, string> {
  return new Map(useBookStore.getState().books.map((book) => [book.id, book.title]));
}

/** Canvas References pointing at Chapters: rows from every Book, opened at their Book. */
export const chapterReferenceSource: CanvasReferenceSource = {
  id: "chapter",
  label: "canvas.referenceSources.chapter",
  icon: FileText,
  card: "chapter",

  async list(query): Promise<CanvasReferenceRow[]> {
    await loadOnce();
    const titles = bookTitles();
    const needle = query.trim().toLocaleLowerCase();
    return (await listChapterTitles())
      .filter((chapter) => chapter.title.toLocaleLowerCase().includes(needle))
      .map((chapter) => ({
        id: chapter.id,
        title: chapter.title,
        subtitle: titles.get(chapter.bookId),
      }));
  },

  async resolve(ids): Promise<Record<string, CanvasReferenceResolution>> {
    await loadOnce();
    const titles = bookTitles();
    const chapters = new Map((await getChaptersByIds(ids)).map((chapter) => [chapter.id, chapter]));
    const answers: Record<string, CanvasReferenceResolution> = {};
    for (const id of ids) {
      const chapter = chapters.get(id);
      answers[id] = chapter
        ? {
            status: "present",
            title: chapter.title,
            value: { ...chapter, bookTitle: titles.get(chapter.bookId) ?? "" },
          }
        : { status: "missing" };
    }
    return answers;
  },

  async open(id, { canvasId, canvasTitle, navigate }): Promise<CanvasReferenceOpenResult> {
    const [chapter] = await getChaptersByIds([id]);
    if (!chapter) return "missing";
    navigate(`/book/${chapter.bookId}`, {
      state: { openChapterId: id, returnTo: `/canvas/${canvasId}`, returnLabel: canvasTitle },
    });
    return "opened";
  },

  subscribe(listener) {
    const unsubscribeChapters = useChapterStore.subscribe((state, previous) => {
      if (state.chapters !== previous.chapters) listener();
    });
    const unsubscribeBooks = useBookStore.subscribe((state, previous) => {
      if (state.books !== previous.books) listener();
    });
    return () => {
      unsubscribeChapters();
      unsubscribeBooks();
    };
  },
};
