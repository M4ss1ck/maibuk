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
