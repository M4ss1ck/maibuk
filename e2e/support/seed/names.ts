// Visible names of seeded content. Kept free of app imports so specs can use
// them without loading app code into the Playwright runner.

export const SEED_BOOK = {
  title: "The Lighthouse Keeper",
  authorName: "Ada Marsh",
} as const;

export const SEED_CHAPTERS = [
  { title: "Arrival", text: "The ferry left her on the rocks at dusk." },
  { title: "The Lamp", text: "Every night the lamp needed oil and a steady hand." },
  { title: "Storm", text: "The storm came in from the west without warning." },
] as const;

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

/** `perfManyChapters`: a Book whose Chapters are numbered with this prefix. */
export const PERF_MANY_CHAPTERS_BOOK = {
  title: "The Hundred Logs",
  authorName: "Ada Marsh",
  chapterPrefix: "Log",
} as const;

export const PERF_SIZES = {
  /** About 13,000 words: a long Chapter, not a pathological one. */
  longChapterParagraphs: 300,
  shortChapters: 20,
  /** 240 Text Nodes and 458 Connections. */
  canvasGrid: { columns: 20, rows: 12 },
  /** Enough Notes to make the Notes list scroll and virtualize. */
  manyNotes: 500,
  /** Enough Chapters to make the Outline long. */
  manyChapters: 100,
} as const;
