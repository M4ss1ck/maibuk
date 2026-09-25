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
