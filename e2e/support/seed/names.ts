// Visible names of seeded content. Kept free of app imports so specs can use
// them without loading app code into the Playwright runner. The one exception
// is the long Chapter's size, which must share its single source with the unit
// test and bench (`src/test/support/long-chapter.ts`); that module imports
// only a type, so nothing app-level loads at run time.
import { LONG_CHAPTER_PARAGRAPHS } from "@/test/support/long-chapter";

export const SEED_BOOK = {
  title: "The Lighthouse Keeper",
  authorName: "Ada Marsh",
} as const;

export const SEED_CHAPTERS = [
  { title: "Arrival", text: "The ferry left her on the rocks at dusk." },
  { title: "The Lamp", text: "Every night the lamp needed oil and a steady hand." },
  { title: "Storm", text: "The storm came in from the west without warning." },
] as const;

/** `spanishAndEnglishBooks`: one Book written in Spanish and one in English, a Chapter each. */
export const LANGUAGE_BOOKS = {
  spanish: {
    title: "El Faro",
    language: "es",
    chapter: "Llegada",
    text: "El barco la dejó en las rocas.",
  },
  english: {
    title: "The Harbor",
    language: "en",
    chapter: "Arrival",
    text: "The boat left her on the rocks.",
  },
} as const;

/** `bookShelf`: the seed Book above plus one Book per other Book Status. */
export const SHELF_BOOKS = [
  { title: "Salt and Iron", authorName: "Ada Marsh", status: "draft" },
  { title: "Winter Orchard", authorName: "Lena Voss", status: "completed" },
  { title: "The Old Map", authorName: "Ada Marsh", status: "archived" },
] as const;

/** `notesWithLinksAndTags`: a Book Note, a pinned Unfiled Note, and a linked pair. */
export const SEED_NOTES = {
  keeperLog: "Keeper's Log",
  tideTables: "Tide Tables",
  harborNotes: "Harbor Notes",
} as const;

export const SEED_NOTE_TAGS = {
  research: "research",
  lamp: "lamp",
  harbor: "harbor",
} as const;

/** `canvasWithNodes`: two Canvases, a text-node pair with a Connection, and a Note Reference. */
export const SEED_CANVASES = {
  map: "Map",
  ideas: "Ideas",
  broken: "Broken map",
} as const;

export const SEED_CANVAS_NODES = {
  storm: "Storm watch",
  second: "Second idea",
  note: "Keeper's Log",
  connection: "leads to",
} as const;

/** `paletteLibrary`: the Canvas card the Library Search text specs land on. */
export const PALETTE_CANVAS = {
  title: "Harbor Chart",
  cardId: "card-beacon",
} as const;

/** `perfLongChapter`: the frame-rate lane's long Chapter plus twenty short ones. */
export const PERF_BOOK = {
  title: "The Long Watch",
  authorName: "Ada Marsh",
  longChapter: "The Long Night",
} as const;

/** `perfDenseCanvas`: a grid of Text Nodes, each connected right and down. */
export const PERF_CANVAS = {
  title: "Dense map",
  nodePrefix: "Station",
} as const;

/** `perfManyNotes`: Notes titled with this prefix and a number. */
export const PERF_NOTES = { titlePrefix: "Watch note" } as const;

/** `perfTaggedNotes`: Notes titled with this prefix, each carrying one of these Tags. */
export const PERF_TAGGED_NOTES = {
  titlePrefix: "Tagged note",
  tags: ["task", "idea", "draft"],
} as const;

/** `perfManyChapters`: a Book whose Chapters are numbered with this prefix. */
export const PERF_MANY_CHAPTERS_BOOK = {
  title: "The Hundred Logs",
  authorName: "Ada Marsh",
  chapterPrefix: "Log",
} as const;

export const PERF_SIZES = {
  /** About 13,000 words: a long Chapter, not a pathological one. */
  longChapterParagraphs: LONG_CHAPTER_PARAGRAPHS,
  shortChapters: 20,
  /** 240 Text Nodes and 458 Connections. */
  canvasGrid: { columns: 20, rows: 12 },
  /** Enough Notes to make the Notes list scroll and virtualize. */
  manyNotes: 500,
  /** Enough Notes that a Note Filter change re-renders a long, virtualized Notes list. */
  taggedNotes: 2000,
  /** Enough Chapters to make the Outline long. */
  manyChapters: 100,
} as const;
