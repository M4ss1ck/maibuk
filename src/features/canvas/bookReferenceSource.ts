import { BookOpen } from "lucide-react";
import { useBookStore } from "@/features/books/store";
import type { Book } from "@/features/books/types";
import type {
  CanvasReferenceOpenResult,
  CanvasReferenceResolution,
  CanvasReferenceRow,
  CanvasReferenceSource,
} from "@/features/canvas/references";

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

function findBook(id: string): Book | undefined {
  return useBookStore.getState().books.find((book) => book.id === id);
}

/** Canvas References pointing at Books: same rows, order, and navigation as the Canvas picker. */
export const bookReferenceSource: CanvasReferenceSource = {
  id: "book",
  label: "canvas.referenceSources.book",
  icon: BookOpen,
  card: "book",

  async list(query): Promise<CanvasReferenceRow[]> {
    await loadOnce();
    const needle = query.trim().toLocaleLowerCase();
    return useBookStore
      .getState()
      .books.filter((book) => book.title.toLocaleLowerCase().includes(needle))
      .map((book) => ({ id: book.id, title: book.title }));
  },

  async resolve(ids): Promise<Record<string, CanvasReferenceResolution>> {
    await loadOnce();
    const answers: Record<string, CanvasReferenceResolution> = {};
    for (const id of ids) {
      const book = findBook(id);
      answers[id] = book
        ? { status: "present", title: book.title, value: book }
        : { status: "missing" };
    }
    return answers;
  },

  async open(id, { canvasId, canvasTitle, navigate }): Promise<CanvasReferenceOpenResult> {
    if (!findBook(id)) return "missing";
    navigate(`/book/${id}`, {
      state: { returnTo: `/canvas/${canvasId}`, returnLabel: canvasTitle },
    });
    return "opened";
  },

  subscribe(listener) {
    return useBookStore.subscribe((state, previous) => {
      if (state.books !== previous.books) listener();
    });
  },
};
