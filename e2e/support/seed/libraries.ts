// Named seed Libraries. Each builder runs in Node (loaded through Vite SSR by
// build-seeds.ts) against an in-memory Library and writes only through the
// real per-entity write paths, so a seed holds exactly what the app itself
// would have stored. Specs locate seeded content by these visible names.

import { createBookRow, updateBookRow, updateBookWordCountRow } from "@/features/books/write";
import { createChapterRow, updateChapterRow } from "@/features/chapters/write";
import { createNoteRow, updateNoteRow } from "@/features/notes/write";
import { SEED_BOOK, SEED_CHAPTERS, SEED_NOTES, SEED_NOTE_TAGS, SHELF_BOOKS } from "./names";

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

async function bookShelf(): Promise<void> {
  await oneBookThreeChapters();
  for (const { title, authorName, status } of SHELF_BOOKS) {
    const book = await createBookRow({ title, authorName }, "local");
    const chapter = await createChapterRow({ bookId: book.id, title: "One" }, "local");
    await updateChapterRow(chapter.id, { content: `<p>${title} begins.</p>` }, "local");
    await updateBookWordCountRow(book.id, 3);
    await updateBookRow(book.id, { status }, "local");
  }
}

async function notesWithLinksAndTags(): Promise<void> {
  const book = await createBookRow({ ...SEED_BOOK }, "local");
  const chapter = await createChapterRow({ bookId: book.id, title: "Arrival" }, "local");
  await updateChapterRow(chapter.id, { content: `<p>${SEED_CHAPTERS[0].text}</p>` }, "local");
  await updateBookWordCountRow(book.id, SEED_CHAPTERS[0].text.split(/\s+/).length);

  const keeperLog = await createNoteRow(
    {
      bookId: book.id,
      title: SEED_NOTES.keeperLog,
      content:
        "<h1>Night Watch</h1><p>The lamp holds through the gale.</p><h2>Dawn</h2><p>First light on the water.</p>",
      tags: [SEED_NOTE_TAGS.research, SEED_NOTE_TAGS.lamp],
    },
    "local"
  );

  await createNoteRow(
    {
      title: SEED_NOTES.tideTables,
      content: "<p>High water at six. Low water at noon.</p>",
      pinned: true,
      tags: [SEED_NOTE_TAGS.research],
    },
    "local"
  );

  const harborNotes = await createNoteRow(
    {
      title: SEED_NOTES.harborNotes,
      content: `<p>See <a class="wikilink" href="maibuk://note/${keeperLog.id}">${SEED_NOTES.keeperLog}</a> for the watch.</p>`,
      tags: [SEED_NOTE_TAGS.harbor],
    },
    "local"
  );
  // The create path stores content without indexing it; a Note written through
  // the editor indexes its Links on save. Reproduce that save so the seeded
  // Backlink exists on Keeper's Log.
  await updateNoteRow({ id: harborNotes.id, content: harborNotes.content }, "local");
}

export const SEED_LIBRARIES = {
  empty: async () => {},
  oneBookThreeChapters,
  bookShelf,
  notesWithLinksAndTags,
} satisfies Record<string, () => Promise<void>>;

export type SeedName = keyof typeof SEED_LIBRARIES;
