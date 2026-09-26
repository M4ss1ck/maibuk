// Named seed Libraries. Each builder runs in Node (loaded through Vite SSR by
// build-seeds.ts) against an in-memory Library and writes only through the
// real per-entity write paths, so a seed holds exactly what the app itself
// would have stored. Specs locate seeded content by these visible names.

import { createBookRow, updateBookRow, updateBookWordCountRow } from "@/features/books/write";
import { createChapterRow, updateChapterRow } from "@/features/chapters/write";
import { createNoteRow, updateNoteRow } from "@/features/notes/write";
import { createCanvasRow, updateCanvasDocRow } from "@/features/canvas/write";
import { CURRENT_CANVAS_SCHEMA_VERSION, type CanvasDoc } from "@/features/canvas/types";
import {
  SEED_BOOK,
  SEED_CANVAS_NODES,
  SEED_CANVASES,
  SEED_CHAPTERS,
  SEED_NOTES,
  SEED_NOTE_TAGS,
  SHELF_BOOKS,
} from "./names";
import { checkpointHistory } from "./checkpoint-history";

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

// A Canvas library with two Text Nodes connected, a Note Reference, a dangling
// Note Reference that reads "Missing note", a second Canvas, and a Canvas whose
// stored doc cannot be parsed (the recovery path's seed).
export async function canvasWithNodes(): Promise<void> {
  // A Note the Canvas references, so the Note Reference has a live target.
  const note = await createNoteRow(
    { title: SEED_CANVAS_NODES.note, content: "<p>Watch the lamp through the gale.</p>" },
    "local"
  );

  const map = await createCanvasRow({ title: SEED_CANVASES.map }, "local");
  await updateCanvasDocRow(
    map.id,
    {
      schemaVersion: CURRENT_CANVAS_SCHEMA_VERSION,
      nodes: [
        {
          id: "text-storm",
          kind: "text",
          html: `<p>${SEED_CANVAS_NODES.storm}</p>`,
          position: { x: 0, y: 0 },
          width: 288,
        },
        {
          id: "text-second",
          kind: "text",
          html: `<p>${SEED_CANVAS_NODES.second}</p>`,
          position: { x: 460, y: 0 },
          width: 288,
        },
        {
          id: "ref-log",
          kind: "noteRef",
          noteId: note.id,
          label: SEED_CANVAS_NODES.note,
          position: { x: 0, y: 320 },
        },
        {
          // No label, so a note deleted elsewhere reads as "Missing note".
          id: "ref-missing",
          kind: "noteRef",
          noteId: "missing-note-id",
          position: { x: 460, y: 320 },
        },
      ],
      edges: [
        {
          id: "edge-1",
          source: "text-storm",
          target: "text-second",
          sourceHandle: "right",
          targetHandle: "left",
          label: SEED_CANVAS_NODES.connection,
        },
      ],
      strokes: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    },
    "local"
  );

  // A second Canvas so the Gallery has a searchable, pinnable list.
  await createCanvasRow({ title: SEED_CANVASES.ideas }, "local");

  // A Canvas whose stored doc cannot be read: the recovery path is reachable.
  // `nodes` as a string is tolerated by the migration (it coerces to []), so the
  // doc also carries an invalid schema version, which normalizeParsedCanvasDoc
  // rejects as an invalid shape.
  const broken = await createCanvasRow({ title: SEED_CANVASES.broken }, "local");
  await updateCanvasDocRow(
    broken.id,
    {
      schemaVersion: "unreadable",
      nodes: "not-an-array",
      edges: [],
      strokes: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    } as unknown as CanvasDoc,
    "local"
  );
}

export const SEED_LIBRARIES = {
  empty: async () => {},
  oneBookThreeChapters,
  bookShelf,
  notesWithLinksAndTags,
  canvasWithNodes,
  checkpointHistory,
} satisfies Record<string, () => Promise<void>>;

export type SeedName = keyof typeof SEED_LIBRARIES;
