// Deterministic inputs and the two engines for the Library Search bench
// (issue #639): about 1,000,000 words of Chapter text across several Books
// (English and Spanish, accents kept), 2,000 Notes, and a few Canvases with
// cards. The periodic lane (`pnpm bench:search`) measures them; the gate lane
// only checks that the inputs still reach every path, never timings.
//
// No Math.random: a seeded LCG keeps the Library identical on every run.
//
// The web engine is the SQLite project's WASM build, the same
// MemoryDatabaseAdapter the web build uses. The desktop engine is Node's
// built-in SQLite (3.51 native, the version the app ships against), wrapped in
// the minimal adapter below — deliberately only here, never in `src/lib`.
import type {
  DatabaseSync as NodeDatabaseSync,
  SQLInputValue,
  StatementSync,
} from "node:sqlite";
import type { AtomicStatement, DatabaseAdapter } from "@/lib/platform/types";
import { runAtomic } from "@/lib/db/atomic";
import { createMemoryDatabase } from "@/lib/db/memory-database";
import {
  bookSearchStatements,
  canvasSearchStatements,
  chapterSearchStatements,
  noteSearchStatements,
} from "@/features/search/statements";
import { ensureTestSchema } from "@/test/support/db-test-context";

/** The size of the seeded Library. The defaults total exactly 1,000,000 words. */
export interface SearchBenchSeed {
  books: number;
  chaptersPerBook: number;
  wordsPerChapter: number;
  notes: number;
  canvases: number;
}

export const SEARCH_BENCH_SEED: SearchBenchSeed = {
  books: 5,
  chaptersPerBook: 200,
  wordsPerChapter: 1000,
  notes: 2000,
  canvases: 4,
};

/** The seed's Chapter body: 40-word paragraphs of five 8-word sentences. */
const WORDS_PER_PARAGRAPH = 40;

export function paragraphsPerChapter(seed: SearchBenchSeed = SEARCH_BENCH_SEED): number {
  return Math.max(1, Math.round(seed.wordsPerChapter / WORDS_PER_PARAGRAPH));
}

/** The seeded Library's approximate word count, from the seed shape alone. */
export function searchBenchWords(seed: SearchBenchSeed = SEARCH_BENCH_SEED): number {
  return seed.books * seed.chaptersPerBook * paragraphsPerChapter(seed) * WORDS_PER_PARAGRAPH;
}

export const SEARCH_BENCH_RARE_WORD = "zephyrine";
export const SEARCH_BENCH_COMMON_WORD = "river";
export const SEARCH_BENCH_PHRASE = "la canción";

export const SEARCH_BENCH_SAVE_CHAPTER_ID = "bench-chapter-0-0";
export const SEARCH_BENCH_SAVE_BOOK_ID = "bench-book-0";

export interface SearchBenchQuery {
  /** The benchmark name; the budget script matches these prefixes. */
  name: string;
  query: string;
  regex?: boolean;
}

/** Literal queries of three or more characters: rare, common, and a phrase. */
export const SEARCH_BENCH_INDEXED_QUERIES: readonly SearchBenchQuery[] = [
  { name: "indexed query: rare word", query: SEARCH_BENCH_RARE_WORD },
  { name: "indexed query: common word", query: SEARCH_BENCH_COMMON_WORD },
  { name: "indexed query: phrase", query: SEARCH_BENCH_PHRASE },
];

/** The queries that scan the plain text: two characters, and a Regex. */
export const SEARCH_BENCH_SCAN_QUERIES: readonly SearchBenchQuery[] = [
  { name: "scan: two-character query", query: "la" },
  { name: "scan: regex", query: "\\b\\w+mente\\b", regex: true },
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

const EN_ADJECTIVES = [
  "quiet",
  "salt",
  "grey",
  "cold",
  "long",
  "amber",
  "hidden",
  "patient",
  "narrow",
  "open",
  "bright",
  "still",
  "broken",
  "distant",
  "early",
  "faint",
  "hollow",
  "silver",
  "slow",
  "warm",
];
const EN_NOUNS = [
  "lamp",
  "harbor",
  "gale",
  "glass",
  "rope",
  "tide",
  "keeper",
  "dawn",
  "gull",
  "lens",
  "door",
  "road",
  "field",
  "stone",
  "window",
  "boat",
  "net",
  "shore",
  "bell",
  "path",
];
const EN_VERBS = [
  "held",
  "counted",
  "found",
  "watched",
  "carried",
  "opened",
  "turned",
  "waited",
  "crossed",
  "remembered",
];
const EN_ADVERBS = ["softly", "again", "slowly", "quietly", "already", "gently", "briefly"];
const EN_PREPOSITIONS = ["through", "beside", "under", "before", "across", "beyond", "along"];

const ES_ADJECTIVES = [
  "tranquila",
  "larga",
  "fría",
  "dorada",
  "callada",
  "oscura",
  "ligera",
  "vieja",
  "honda",
  "clara",
];
const ES_NOUNS = [
  "casa",
  "luz",
  "mar",
  "noche",
  "puerta",
  "ventana",
  "camino",
  "piedra",
  "sombra",
  "voz",
];
const ES_VERBS = [
  "guardaba",
  "miraba",
  "abría",
  "cruzaba",
  "recordaba",
  "sentía",
  "buscaba",
  "llegaba",
  "volvía",
  "cantaba",
];
const ES_ADVERBS = [
  "lentamente",
  "suavemente",
  "claramente",
  "tristemente",
  "finalmente",
  "silenciosamente",
];
const ES_PREPOSITIONS = ["por", "bajo", "entre", "hacia", "sobre", "tras"];

function pick(values: readonly string[], next: () => number): string {
  return values[Math.floor(next() * values.length)];
}

function englishSentence(next: () => number): string[] {
  return [
    "The",
    pick(EN_ADJECTIVES, next),
    pick(EN_NOUNS, next),
    pick(EN_VERBS, next),
    pick(EN_PREPOSITIONS, next),
    "the",
    pick(EN_NOUNS, next),
    pick(EN_ADVERBS, next),
  ];
}

function spanishSentence(next: () => number): string[] {
  return [
    "La",
    pick(ES_ADJECTIVES, next),
    pick(ES_NOUNS, next),
    pick(ES_VERBS, next),
    pick(ES_PREPOSITIONS, next),
    "la",
    pick(ES_NOUNS, next),
    pick(ES_ADVERBS, next),
  ];
}

/** A sentence that carries the common word, so it reaches a share of blocks. */
function englishCommonSentence(next: () => number): string[] {
  return [
    "The",
    pick(EN_ADJECTIVES, next),
    SEARCH_BENCH_COMMON_WORD,
    pick(EN_VERBS, next),
    pick(EN_PREPOSITIONS, next),
    "the",
    pick(EN_NOUNS, next),
    pick(EN_ADVERBS, next),
  ];
}

/** A Spanish sentence holding the accented phrase, contiguous and lowercase. */
function spanishPhraseSentence(next: () => number): string[] {
  return [
    "La",
    pick(ES_ADJECTIVES, next),
    pick(ES_NOUNS, next),
    pick(ES_VERBS, next),
    "por",
    "la",
    "canción",
    pick(ES_ADVERBS, next),
  ];
}

/** One Chapter's HTML, identical on both engines and every run. */
export function searchBenchChapterHtml(
  bookIndex: number,
  chapterIndex: number,
  seed: SearchBenchSeed = SEARCH_BENCH_SEED
): string {
  const globalChapter = bookIndex * seed.chaptersPerBook + chapterIndex;
  const next = createRng((0x5ea4c4 ^ (globalChapter * 7919 + 1)) >>> 0);
  const spanish = globalChapter % 3 === 1;
  const paragraphs: string[] = [];

  for (let paragraph = 0; paragraph < paragraphsPerChapter(seed); paragraph += 1) {
    const words: string[] = [];
    for (let sentence = 0; sentence < 5; sentence += 1) {
      if (sentence === 0 && spanish && paragraph % 25 === 0) {
        words.push(...spanishPhraseSentence(next));
      } else if (sentence === 0 && !spanish && paragraph % 20 === 0) {
        words.push(...englishCommonSentence(next));
      } else {
        words.push(...(spanish ? spanishSentence(next) : englishSentence(next)));
      }
    }
    // The one rare word: exactly one block in the whole Library.
    if (!spanish && globalChapter === 0 && paragraph === 0) {
      words.push("Zephyrine", "whispered", "beyond", "the", "last", "door.");
    }
    paragraphs.push(`<p>${words.join(" ")}</p>`);
  }

  return paragraphs.join("");
}

function searchBenchNoteContent(index: number): string {
  const next = createRng((0x9e3779b9 ^ (index * 2654435761)) >>> 0);
  const spanish = index % 5 === 0;
  const paragraphs: string[] = [];
  const count = 2 + (index % 3);
  for (let paragraph = 0; paragraph < count; paragraph += 1) {
    const sentence = spanish ? spanishSentence(next) : englishSentence(next);
    paragraphs.push(`<p>${sentence.join(" ")}</p>`);
  }
  return paragraphs.join("");
}

function searchBenchCanvasDoc(index: number): unknown {
  const next = createRng((0xc0ffee ^ (index * 97 + 13)) >>> 0);
  const nodes = Array.from({ length: 8 }, (_, card) => ({
    id: `bench-card-${index}-${card}`,
    kind: "text",
    html: `<p>${(index % 4 === 0 ? spanishSentence(next) : englishSentence(next)).join(" ")}</p>`,
    position: { x: card * 280, y: index * 200 },
    width: 240,
  }));
  return { version: 1, nodes, edges: [] };
}

export interface SeededSearchBench {
  words: number;
  chapters: number;
  notes: number;
  canvases: number;
  blocks: number;
}

const SEEDED_AT = 1_700_000_000;

/**
 * Writes the seeded Library through the same atomic batch a real save uses:
 * the item's own row plus the index statements from `@/features/search`.
 */
export async function seedSearchBench(
  db: DatabaseAdapter,
  seed: SearchBenchSeed = SEARCH_BENCH_SEED
): Promise<SeededSearchBench> {
  for (let book = 0; book < seed.books; book += 1) {
    const id = `bench-book-${book}`;
    const title = `Bench Book ${book + 1}`;
    const subtitle = `A volume of quiet harbors, ${book + 1}`;
    const description = "A seeded Book whose title, subtitle, and description are searchable.";
    await db.executeAtomic([
      {
        sql: `INSERT INTO books
          (id, title, subtitle, author_name, description, language, created_at, updated_at, content_updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [id, title, subtitle, "Bench Author", description, "en", SEEDED_AT, SEEDED_AT, SEEDED_AT],
      },
      ...bookSearchStatements({ id, title, subtitle, description }, SEEDED_AT),
    ]);

    for (let chapter = 0; chapter < seed.chaptersPerBook; chapter += 1) {
      const chapterId = `bench-chapter-${book}-${chapter}`;
      const content = searchBenchChapterHtml(book, chapter, seed);
      await db.executeAtomic([
        {
          sql: `INSERT INTO chapters
            (id, book_id, title, content, "order", word_count, status, is_included_in_export, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 'draft', 1, ?, ?)`,
          params: [
            chapterId,
            id,
            `Bench Chapter ${book + 1}.${chapter + 1}`,
            content,
            chapter,
            seed.wordsPerChapter,
            SEEDED_AT,
            SEEDED_AT,
          ],
        },
        ...chapterSearchStatements({ id: chapterId, bookId: id, content }, SEEDED_AT),
      ]);
    }
  }

  for (let note = 0; note < seed.notes; note += 1) {
    const id = `bench-note-${note}`;
    const content = searchBenchNoteContent(note);
    const bookId = note % 3 === 0 ? null : `bench-book-${note % seed.books}`;
    await db.executeAtomic([
      {
        sql: `INSERT INTO notes
          (id, book_id, title, content, "order", word_count, created_at, updated_at, content_updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          id,
          bookId,
          `Bench Note ${note + 1}`,
          content,
          note,
          40,
          SEEDED_AT,
          SEEDED_AT,
          SEEDED_AT,
        ],
      },
      ...noteSearchStatements({ id, bookId, content }, SEEDED_AT),
    ]);
  }

  for (let canvas = 0; canvas < seed.canvases; canvas += 1) {
    const id = `bench-canvas-${canvas}`;
    const doc = searchBenchCanvasDoc(canvas);
    await db.executeAtomic([
      {
        sql: `INSERT INTO canvases
          (id, title, doc, pinned, "order", created_at, updated_at, content_updated_at)
          VALUES (?, ?, ?, 0, ?, ?, ?, ?)`,
        params: [id, `Bench Canvas ${canvas + 1}`, JSON.stringify(doc), canvas, SEEDED_AT, SEEDED_AT, SEEDED_AT],
      },
      ...canvasSearchStatements({ id, doc }, SEEDED_AT),
    ]);
  }

  const rows = await db.select<{ count: number }[]>("SELECT COUNT(*) AS count FROM search_text");
  return {
    words: searchBenchWords(seed),
    chapters: seed.books * seed.chaptersPerBook,
    notes: seed.notes,
    canvases: seed.canvases,
    blocks: rows[0]?.count ?? 0,
  };
}

/**
 * The index statements one Chapter save adds to its atomic batch, computed as
 * the save computes them. The bench executes these alone: the added cost of a
 * save's index update step, without the text extraction the editor already
 * does for its own word count.
 */
export function searchBenchSaveStatements(
  seed: SearchBenchSeed = SEARCH_BENCH_SEED
): AtomicStatement[] {
  return chapterSearchStatements(
    {
      id: SEARCH_BENCH_SAVE_CHAPTER_ID,
      bookId: SEARCH_BENCH_SAVE_BOOK_ID,
      content: searchBenchChapterHtml(0, 0, seed),
    },
    SEEDED_AT + 1
  );
}

export type SearchBenchEngineKind = "desktop" | "web";

export interface SearchBenchEngine {
  kind: SearchBenchEngineKind;
  db: DatabaseAdapter;
  close(): Promise<void>;
}

/** An in-memory engine for one platform, with the product's test schema. */
export async function createSearchBenchEngine(
  kind: SearchBenchEngineKind
): Promise<SearchBenchEngine> {
  if (kind === "web") {
    const db = await createMemoryDatabase();
    await ensureTestSchema(db);
    return { kind, db, close: () => db.close() };
  }

  const nodeSqlite = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
  const db = new NodeSqliteDatabaseAdapter(new nodeSqlite.DatabaseSync(":memory:"));
  await ensureTestSchema(db);
  return { kind, db, close: () => db.close() };
}

/**
 * The smallest DatabaseAdapter `rebuild.ts` and `searchLibrary()` need, over
 * Node's built-in SQLite. Bench support only: the desktop build reaches SQLite
 * through Tauri, and the web build through the WASM adapter above.
 */
export class NodeSqliteDatabaseAdapter implements DatabaseAdapter {
  // Prepared statements are reused: the seed writes tens of thousands of rows,
  // and a fresh prepare per statement kept every one alive and slowed the
  // rebuild's many reads.
  private readonly statements = new Map<string, StatementSync>();

  constructor(private readonly db: NodeDatabaseSync) {}

  private statement(sql: string): StatementSync {
    let statement = this.statements.get(sql);
    if (!statement) {
      statement = this.db.prepare(sql);
      this.statements.set(sql, statement);
    }
    return statement;
  }

  private run(sql: string, params?: readonly unknown[]): void {
    if (sql.trim().length === 0) return;
    if (!params || params.length === 0) {
      this.db.exec(sql);
      return;
    }
    this.statement(sql).run(...(params as SQLInputValue[]));
  }

  async execute(sql: string, params?: unknown[]): Promise<{ rowsAffected: number }> {
    if (params && params.length > 0) {
      const result = this.statement(sql).run(...(params as SQLInputValue[]));
      return { rowsAffected: Number(result.changes) };
    }
    this.run(sql);
    return { rowsAffected: 0 };
  }

  async select<T>(sql: string, params?: unknown[]): Promise<T> {
    const statement = this.statement(sql);
    const rows =
      params && params.length > 0
        ? statement.all(...(params as SQLInputValue[]))
        : statement.all();
    return rows as T;
  }

  async close(): Promise<void> {
    this.db.close();
  }

  async exportData(): Promise<Uint8Array> {
    throw new Error("the search bench's node:sqlite adapter has no SQL export");
  }

  async executeAtomic(statements: readonly AtomicStatement[]): Promise<void> {
    runAtomic({ run: (sql, params) => this.run(sql, params) }, statements);
  }
}
