import { getDatabase } from "@/lib/db";
import { listChapterTitles } from "@/features/chapters/store";
import type { BuildEntityItemsOptions } from "@/features/command-palette/entity-items";

type PaletteEntities = Pick<BuildEntityItemsOptions, "books" | "chapters" | "notes" | "canvases">;

/**
 * The names the Command Palette lists, read from the Library when it opens.
 *
 * A palette row is only a name, so this reads the name columns alone: no
 * Chapter content, no Canvas doc, no cover data, and nothing published to a
 * store. Refreshing a store behind the open palette would replace an unchanged
 * view with new arrays and re-render the whole app under the modal for no
 * visible difference. The ordering is the one each list already uses, so the
 * rows are the ones the author sees everywhere else.
 */
export async function loadPaletteEntities(): Promise<PaletteEntities> {
  const db = await getDatabase();
  const [books, chapters, notes, canvases] = await Promise.all([
    db.select<{ id: string; title: string }[]>(
      "SELECT id, title FROM books ORDER BY last_opened_at DESC, updated_at DESC"
    ),
    listChapterTitles(),
    db.select<{ id: string; title: string; book_id: string | null }[]>(
      'SELECT id, title, book_id FROM notes ORDER BY pinned DESC, "order" ASC'
    ),
    db.select<{ id: string; title: string }[]>(
      'SELECT id, title FROM canvases ORDER BY pinned DESC, "order" ASC, updated_at DESC'
    ),
  ]);

  return {
    books: books.map((row) => ({ id: row.id, title: row.title })),
    chapters,
    notes: notes.map((row) => ({
      id: row.id,
      title: row.title,
      bookId: row.book_id ?? null,
    })),
    canvases: canvases.map((row) => ({ id: row.id, title: row.title })),
  };
}
