// Deterministic worst-case-ish inputs for the Command Palette bench (issue
// #353, slice 4). The bench measures them in the periodic lane
// (`pnpm bench:palette`); the gate lane only checks that the fixture still
// covers every kind and that every query runs, never timings.
//
// No Math.random: a seeded LCG keeps the 10,000 items identical on every run.
import type { PaletteItem, PalettePage } from "@/features/command-palette/palette-index";

export const PALETTE_BENCH_OPEN_BOOK_ID = "bench-book-007";

export const PALETTE_BENCH_QUERIES: readonly string[] = [
  "e",
  "ch",
  "note",
  "export",
  "capit",
  "canción",
  "toggle theme",
  "zqxj",
];

/** Seeded LCG (mulberry32); no Math.random so the fixture is deterministic. */
function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Word lists avoid the letters z, q, x and j entirely so the "zqxj" bench
// query matches nothing.
const VERBS = [
  "Toggle",
  "Open",
  "Create",
  "Export",
  "Rename",
  "Delete",
  "Duplicate",
  "Pin",
  "Search",
  "Go to",
  "Insert",
  "Format",
  "Align",
  "Sort",
  "Filter",
  "Fold",
  "Unfold",
  "Lock",
  "Unlock",
  "Share",
];

const NOUNS = [
  "Bold",
  "Chapter",
  "Canvas",
  "Note",
  "Book",
  "Sidebar",
  "Theme",
  "Sync",
  "Backup",
  "Footnote",
  "Heading",
  "Image",
  "Link",
  "List",
  "Table",
  "Quote",
  "Draft",
  "Outline",
  "Cover",
  "Margin",
  "Leseliste",
  "Tiempo",
  "Borrador",
  "Portada",
  "Capitulo",
  "Nota",
];

const ADJECTIVES = [
  "Great",
  "Silent",
  "Golden",
  "Brief",
  "Amplia",
  "Nueva",
  "Clara",
  "Dulce",
  "Fuerte",
  "Libre",
  "Serena",
  "Verde",
  "Honda",
  "Pura",
  "Lenta",
];

const ACCENTED = ["canción", "álbum", "lápiz", "página", "música", "árbol", "época"];

function pick(rng: () => number, words: readonly string[]): string {
  return words[Math.floor(rng() * words.length)];
}

export function paletteBenchItems(count = 10_000): PaletteItem[] {
  const rng = createRng(0x9e3779b9);
  const commandsCount = Math.round(count * 0.02);
  const pagesCount = 5;
  const booksCount = Math.round(count * 0.03);
  const canvasesCount = Math.round(count * 0.04);
  const settingsCount = Math.round(count * 0.0095);
  const notesCount = Math.round(count * 0.3);
  const chaptersCount =
    count - (commandsCount + pagesCount + booksCount + canvasesCount + settingsCount + notesCount);

  const items: PaletteItem[] = [];

  for (let n = 0; n < commandsCount; n += 1) {
    const label = `${pick(rng, VERBS)} ${pick(rng, NOUNS).toLowerCase()} ${pick(rng, ADJECTIVES).toLowerCase()}`;
    const id = `bench-cmd-${String(n).padStart(4, "0")}`;
    items.push({
      key: `command:${id}`,
      kind: "command",
      id,
      label,
      terms: n % 7 === 0 ? [`voice phrase ${pick(rng, NOUNS).toLowerCase()}`] : [],
      state: n % 23 === 0 ? "disabled" : "runnable",
    });
  }

  // Pin the first command so the longest bench query ("toggle theme") hits.
  const firstCommand = items[0];
  items[0] = {
    ...firstCommand,
    label: "Toggle theme switch",
    terms: [...firstCommand.terms, "tema"],
  };

  const pages: { label: string; targetPage: PalettePage }[] = [
    { label: "Go to chapters", targetPage: "chapters" },
    { label: "Go to books", targetPage: "books" },
    { label: "Go to notes", targetPage: "notes" },
    { label: "Go to canvases", targetPage: "canvases" },
    { label: "Back to start", targetPage: "root" },
  ];
  for (let n = 0; n < pagesCount; n += 1) {
    const page = pages[n % pages.length];
    const id = `bench-page-${n}`;
    items.push({
      key: `page:${id}`,
      kind: "page",
      id,
      label: page.label,
      terms: [],
      state: "runnable",
      targetPage: page.targetPage,
    });
  }

  const bookTitles: string[] = [];
  for (let n = 0; n < booksCount; n += 1) {
    const accented = n % 11 === 0 ? ` ${pick(rng, ACCENTED)}` : "";
    const title = `The ${pick(rng, ADJECTIVES)} ${pick(rng, NOUNS)}${accented}`;
    bookTitles.push(title);
    const id = `bench-book-${String(n).padStart(3, "0")}`;
    items.push({
      key: `book:${id}`,
      kind: "book",
      id,
      label: title,
      terms: n % 5 === 0 ? ["novel", "manuscrito"] : [],
      state: "runnable",
    });
  }
  // The open-Book chapter boost needs a stable, known book id.
  bookTitles[7 % bookTitles.length] = `The ${ADJECTIVES[0]} Atlas`;

  for (let n = 0; n < chaptersCount; n += 1) {
    const bookIndex = n % bookTitles.length;
    const bookNumber = String(bookIndex).padStart(3, "0");
    const bookId = `bench-book-${bookNumber}`;
    const label = `Chapter ${n + 1}: the ${pick(rng, ADJECTIVES).toLowerCase()} ${pick(rng, NOUNS).toLowerCase()}`;
    const id = `bench-chapter-${String(n).padStart(5, "0")}`;
    items.push({
      key: `chapter:${id}`,
      kind: "chapter",
      id,
      label,
      terms: [],
      state: "runnable",
      detail: bookTitles[bookIndex],
      bookId,
    });
  }

  for (let n = 0; n < notesCount; n += 1) {
    const label = `${pick(rng, NOUNS)} note ${n + 1} about the ${pick(rng, ADJECTIVES).toLowerCase()} river`;
    const id = `bench-note-${String(n).padStart(5, "0")}`;
    items.push({
      key: `note:${id}`,
      kind: "note",
      id,
      label,
      terms: n % 9 === 0 ? ["nota", "recuerdo"] : [],
      state: "runnable",
    });
  }

  for (let n = 0; n < canvasesCount; n += 1) {
    const label = `${pick(rng, ADJECTIVES)} canvas ${n + 1} for the ${pick(rng, NOUNS).toLowerCase()}`;
    const id = `bench-canvas-${String(n).padStart(4, "0")}`;
    items.push({
      key: `canvas:${id}`,
      kind: "canvas",
      id,
      label,
      terms: [],
      state: "runnable",
    });
  }

  for (let n = 0; n < settingsCount; n += 1) {
    const label = `${pick(rng, NOUNS)} setting for ${pick(rng, ADJECTIVES).toLowerCase()} display`;
    const id = `bench-setting-${String(n).padStart(3, "0")}`;
    items.push({
      key: `settingsRow:${id}`,
      kind: "settingsRow",
      id,
      label,
      terms: [`keyword ${pick(rng, NOUNS).toLowerCase()}`, "preferencia"],
      state: "runnable",
      detail: "Display",
    });
  }

  return items;
}
