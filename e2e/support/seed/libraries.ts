// Named seed Libraries. Each builder runs in Node (loaded through Vite SSR by
// build-seeds.ts) against an in-memory Library and writes only through the
// real per-entity write paths, so a seed holds exactly what the app itself
// would have stored. Specs locate seeded content by these visible names.

import { createBookRow, updateBookRow, updateBookWordCountRow } from "@/features/books/write";
import { createChapterRow, updateChapterRow } from "@/features/chapters/write";
import { SEED_BOOK, SEED_CHAPTERS } from "./names";

async function oneBookThreeChapters(): Promise<void> {
  const book = await createBookRow({ ...SEED_BOOK }, "local");
  let words = 0;
  for (const chapter of SEED_CHAPTERS) {
    const created = await createChapterRow({ bookId: book.id, title: chapter.title }, "local");
    const saved = await updateChapterRow(
      created.id,
      { content: `<p>${chapter.text}</p>` },
      "local"
    );
    words += saved?.wordCount ?? 0;
  }
  // The Book's total is derived; the editor's store recomputes it the same way.
  await updateBookWordCountRow(book.id, words);
  await updateBookRow(book.id, { status: "in-progress" }, "local");
}

export const SEED_LIBRARIES = {
  empty: async () => {},
  oneBookThreeChapters,
} satisfies Record<string, () => Promise<void>>;

export type SeedName = keyof typeof SEED_LIBRARIES;
