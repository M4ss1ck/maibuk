// Named seed Libraries. Each builder runs in Node (loaded through Vite SSR by
// build-seeds.ts) against an in-memory Library and writes only through the
// real per-entity write paths, so a seed holds exactly what the app itself
// would have stored. Specs locate seeded content by these visible names.

import { createBookRow, updateBookRow, updateBookWordCountRow } from "@/features/books/write";
import { createChapterRow, updateChapterRow } from "@/features/chapters/write";
import { createNoteRow, updateNoteRow } from "@/features/notes/write";
import { createCanvasRow, updateCanvasDocRow } from "@/features/canvas/write";
import { CURRENT_CANVAS_SCHEMA_VERSION, type CanvasDoc } from "@/features/canvas/types";
import { setPluginStorageValue } from "@/features/plugins/storage";
import { backupsPresent } from "./backups-present";
import {
  SEED_BOOK,
  SEED_CANVAS_NODES,
  SEED_CANVASES,
  SEED_CHAPTERS,
  SEED_NOTES,
  SEED_NOTE_TAGS,
  SHELF_BOOKS,
  LANGUAGE_BOOKS,
  PALETTE_CANVAS,
} from "./names";
import { checkpointHistory } from "./checkpoint-history";
import { checkpointBacklog } from "./checkpoint-backlog";
import { metricsHistory } from "./metrics-history";
import { PERF_SEED_LIBRARIES } from "./perf-libraries";

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

// Opening Marks act on Spanish text only, so the specs need a Book in each language.
async function spanishAndEnglishBooks(): Promise<void> {
  for (const seed of [LANGUAGE_BOOKS.spanish, LANGUAGE_BOOKS.english]) {
    const book = await createBookRow(
      { title: seed.title, authorName: SEED_BOOK.authorName, language: seed.language },
      "local"
    );
    const created = await createChapterRow({ bookId: book.id, title: seed.chapter }, "local");
    const saved = await updateChapterRow(created.id, { content: `<p>${seed.text}</p>` }, "local");
    await updateBookWordCountRow(book.id, saved?.wordCount ?? 0);
  }
}

// A Book with exactly two Chapters (issue #446). The target-Command specs open
// Chapter A while Chapter B is the Book's last, so a result that names B proves
// the host acted on a chapter other than the one the author is in.
async function oneBookTwoChapters(): Promise<void> {
  const book = await createBookRow({ ...SEED_BOOK }, "local");
  let words = 0;
  for (const chapter of [SEED_CHAPTERS[0], SEED_CHAPTERS[1]]) {
    const created = await createChapterRow({ bookId: book.id, title: chapter.title }, "local");
    const saved = await updateChapterRow(
      created.id,
      { content: `<p>${chapter.text}</p>` },
      "local"
    );
    words += saved?.wordCount ?? 0;
  }
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

// `notesWithLinksAndTags` Note timestamps. The Gallery's default Sort is Last
// Edited (newest first), and #525 (ADR 0028) breaks every date tie by Custom
// Order. The three Notes would otherwise be created within the same second,
// tie, and show in Custom Order (pinned first) under any Sort. The specs
// expect the pinned Tide Tables to lead, then Keeper's Log, then Harbor Notes,
// so stamp each Note with its own fixed wall clock through the real write path
// below, whatever the machine's clock does while seeding.
const NOTES_CLOCK = Date.UTC(2025, 0, 1, 12, 0, 0);
const NOTE_STAMP = {
  harborNotes: NOTES_CLOCK,
  keeperLog: NOTES_CLOCK + 60_000,
  tideTables: NOTES_CLOCK + 120_000,
} as const;

async function withFixedClock<T>(ms: number, write: () => Promise<T>): Promise<T> {
  const realNow = Date.now;
  Date.now = () => ms;
  try {
    return await write();
  } finally {
    Date.now = realNow;
  }
}

async function notesWithLinksAndTags(): Promise<void> {
  const book = await createBookRow({ ...SEED_BOOK }, "local");
  const chapter = await createChapterRow({ bookId: book.id, title: "Arrival" }, "local");
  await updateChapterRow(chapter.id, { content: `<p>${SEED_CHAPTERS[0].text}</p>` }, "local");
  await updateBookWordCountRow(book.id, SEED_CHAPTERS[0].text.split(/\s+/).length);

  const keeperLog = await withFixedClock(NOTE_STAMP.keeperLog, () =>
    createNoteRow(
      {
        bookId: book.id,
        title: SEED_NOTES.keeperLog,
        content:
          "<h1>Night Watch</h1><p>The lamp holds through the gale.</p><h2>Dawn</h2><p>First light on the water.</p>",
        tags: [SEED_NOTE_TAGS.research, SEED_NOTE_TAGS.lamp],
      },
      "local"
    )
  );

  await withFixedClock(NOTE_STAMP.tideTables, () =>
    createNoteRow(
      {
        title: SEED_NOTES.tideTables,
        content: "<p>High water at six. Low water at noon.</p>",
        pinned: true,
        tags: [SEED_NOTE_TAGS.research],
      },
      "local"
    )
  );

  const harborNotes = await withFixedClock(NOTE_STAMP.harborNotes, () =>
    createNoteRow(
      {
        title: SEED_NOTES.harborNotes,
        content: `<p>See <a class="wikilink" href="maibuk://note/${keeperLog.id}">${SEED_NOTES.keeperLog}</a> for the watch.</p>`,
        tags: [SEED_NOTE_TAGS.harbor],
      },
      "local"
    )
  );
  // The create path stores content without indexing it; a Note written through
  // the editor indexes its Links on save. Reproduce that save so the seeded
  // Backlink exists on Keeper's Log. Harbor Notes keeps its clock: the content
  // is unchanged, so this save leaves its Last Edited where it was.
  await withFixedClock(NOTE_STAMP.harborNotes, () =>
    updateNoteRow({ id: harborNotes.id, content: harborNotes.content }, "local")
  );
}

// Two Books with Chapters and an Unfiled Note: the Command Palette seed, so
// a Chapter of another Book, a Note, and a second Book are all findable.
async function paletteLibrary(): Promise<void> {
  const book = await createBookRow({ ...SEED_BOOK }, "local");
  let words = 0;
  for (const chapter of [SEED_CHAPTERS[0], SEED_CHAPTERS[1]]) {
    const created = await createChapterRow({ bookId: book.id, title: chapter.title }, "local");
    // Arrival carries the text specs' words: "ferry" twice (so the handoff
    // lands on "1 of 2") and "timetable" once (so Whole word drops "table"
    // out), while still ending on "dusk." like the shared seed text.
    const content =
      chapter.title === SEED_CHAPTERS[0].title
        ? `<p>A ferry timetable hung by the door. ${chapter.text}</p>`
        : `<p>${chapter.text}</p>`;
    const saved = await updateChapterRow(created.id, { content }, "local");
    words += saved?.wordCount ?? 0;
  }
  await updateBookWordCountRow(book.id, words);

  const other = await createBookRow(
    { title: SHELF_BOOKS[0].title, authorName: SHELF_BOOKS[0].authorName },
    "local"
  );
  const otherChapter = await createChapterRow(
    { bookId: other.id, title: SEED_CHAPTERS[2].title },
    "local"
  );
  const otherSaved = await updateChapterRow(
    otherChapter.id,
    { content: `<p>${SEED_CHAPTERS[2].text}</p>` },
    "local"
  );
  await updateBookWordCountRow(other.id, otherSaved?.wordCount ?? 0);

  await createNoteRow(
    {
      title: SEED_NOTES.tideTables,
      content: "<p>High water at six. Low water at noon.</p>",
    },
    "local"
  );

  // The text specs' Canvas landing: one card holding "beacon", a word that
  // appears nowhere else in this Library.
  const chart = await createCanvasRow({ title: PALETTE_CANVAS.title }, "local");
  await updateCanvasDocRow(
    chart.id,
    {
      schemaVersion: CURRENT_CANVAS_SCHEMA_VERSION,
      nodes: [
        {
          id: PALETTE_CANVAS.cardId,
          kind: "text",
          html: "<p>The beacon marks the harbor mouth.</p>",
          position: { x: 0, y: 0 },
          width: 288,
        },
      ],
      edges: [],
      strokes: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    },
    "local"
  );
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

// A Library whose Plugin namespace holds retained data for the tracer Plugin,
// so a removed row still shows its Library data size and offers Delete data
// (#443).
async function pluginData(): Promise<void> {
  await setPluginStorageValue("tracer", "notes", { note: "kept ".repeat(500) });
  await setPluginStorageValue("tracer", "scratch", { text: "x".repeat(1024) });
}

// A small Book whose two Chapters hold echoes: a repeated word and phrase, and
// a word ("keeper") that repeats just past a narrow nearby window so the
// Settings window is observable. The Echoes report (issue #450) is proven
// against it.
async function echoesBook(): Promise<void> {
  const book = await createBookRow({ ...SEED_BOOK }, "local");
  let words = 0;
  const contents = [
    "The harbor was calm. The harbor was empty. The harbor was quiet. The keeper arrived at dawn and waited. We left the harbor late with the keeper. Into the dark night we go. Into the dark night we go. Into the dark night we go.",
    "The lamp burns bright. The lamp burns bright. Into the dark night we go. Into the dark night we go. Into the dark night we go.",
  ];
  const titles = ["Arrival", "The Lamp"];
  for (let index = 0; index < contents.length; index++) {
    const created = await createChapterRow({ bookId: book.id, title: titles[index] }, "local");
    const saved = await updateChapterRow(
      created.id,
      { content: `<p>${contents[index]}</p>` },
      "local"
    );
    words += saved?.wordCount ?? 0;
  }
  await updateBookWordCountRow(book.id, words);
  await updateBookRow(book.id, { status: "in-progress" }, "local");
}

// A large Book for the Echoes report's row caps: twelve Chapters of made-up
// five-letter words, each said twice a few words apart, so the Nearby tab has
// well over 200 rows, plus "harbor" said 450 times so one row has over 200
// occurrences. The words are generated, so no real text is needed.
async function echoesLargeBook(): Promise<void> {
  const book = await createBookRow({ ...SEED_BOOK }, "local");
  const consonants = "bdfgklmnprstvz";
  const vowels = "aeiou";
  const word = (n: number) =>
    consonants[n % 14] +
    vowels[Math.floor(n / 14) % 5] +
    consonants[Math.floor(n / 70) % 14] +
    vowels[Math.floor(n / 980) % 5] +
    "r";
  let words = 0;
  for (let chapter = 0; chapter < 12; chapter++) {
    const parts: string[] = [];
    for (let i = 0; i < 150; i++) {
      const w = word(chapter * 150 + i);
      parts.push(`${w} sat by the ${w} wall.`);
    }
    if (chapter === 0) {
      for (let i = 0; i < 450; i++) parts.push("The harbor was calm.");
    }
    const created = await createChapterRow(
      { bookId: book.id, title: `Part ${chapter + 1}` },
      "local"
    );
    const saved = await updateChapterRow(
      created.id,
      { content: `<p>${parts.join(" ")}</p>` },
      "local"
    );
    words += saved?.wordCount ?? 0;
  }
  await updateBookWordCountRow(book.id, words);
}

export const SEED_LIBRARIES = {
  empty: async () => {},
  oneBookThreeChapters,
  oneBookTwoChapters,
  spanishAndEnglishBooks,
  echoesBook,
  echoesLargeBook,
  bookShelf,
  notesWithLinksAndTags,
  paletteLibrary,
  canvasWithNodes,
  checkpointHistory,
  checkpointBacklog,
  backupsPresent,
  metricsHistory,
  pluginData,
  ...PERF_SEED_LIBRARIES,
} satisfies Record<string, () => Promise<void>>;

export type SeedName = keyof typeof SEED_LIBRARIES;
