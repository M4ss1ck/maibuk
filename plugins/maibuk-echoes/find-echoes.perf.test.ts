import { describe, expect, it } from "vitest";
import { DEFAULT_ECHO_SETTINGS, type Echo, type EchoKind, findEchoes } from "./find-echoes";
import { tokenize } from "./language";
import { BOOK_WORDS, CHAPTER_WORDS, EN_WORDS, ES_WORDS, buildEchoBook } from "./fixtures/book";

const SEED = 449;
const RUNS = 3;
const BOOK_BUDGET_MS = 2_000;

/** The middle of three timed runs, so one slow sample does not decide. */
function median(samples: readonly number[]): number {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

interface Measured {
  echoes: Echo[];
  runs: number[];
  medianMs: number;
}

/** One warm-up run (the stemmer cache is cold on the first call), then three timed. */
function measure(book: readonly string[], language: string): Measured {
  findEchoes(book, language, DEFAULT_ECHO_SETTINGS);
  const runs: number[] = [];
  let echoes: Echo[] = [];
  for (let run = 0; run < RUNS; run++) {
    const start = performance.now();
    echoes = findEchoes(book, language, DEFAULT_ECHO_SETTINGS);
    runs.push(performance.now() - start);
  }
  return { echoes, runs, medianMs: median(runs) };
}

function kindsOf(echoes: readonly Echo[]): Set<EchoKind> {
  return new Set(echoes.map((echo) => echo.kind));
}

describe("findEchoes() 100k-word Book", () => {
  it("stays inside the Book budget — en", () => {
    const book = buildEchoBook(EN_WORDS, SEED);
    const tokens = book.reduce((sum, chapter) => sum + tokenize(chapter).length, 0);
    expect(tokens).toBe(BOOK_WORDS);
    expect(book).toHaveLength(20);
    expect(tokenize(book[0])).toHaveLength(CHAPTER_WORDS);

    const { echoes, runs, medianMs } = measure(book, "en");
    console.info(
      `findEchoes 100k-word Book: median ${medianMs.toFixed(0)} ms (runs: ${runs
        .map((run) => run.toFixed(0))
        .join(", ")} ms)`
    );

    expect(medianMs).toBeLessThan(BOOK_BUDGET_MS);
    expect(kindsOf(echoes)).toEqual(new Set(["nearby", "overused", "phrase"]));
  });

  it("stays inside the Book budget — es", () => {
    const book = buildEchoBook(ES_WORDS, SEED);
    const tokens = book.reduce((sum, chapter) => sum + tokenize(chapter).length, 0);
    expect(tokens).toBe(BOOK_WORDS);

    const { echoes, runs, medianMs } = measure(book, "es");
    console.info(
      `findEchoes 100k-word Book: median ${medianMs.toFixed(0)} ms (runs: ${runs
        .map((run) => run.toFixed(0))
        .join(", ")} ms)`
    );

    expect(medianMs).toBeLessThan(BOOK_BUDGET_MS);
    expect(kindsOf(echoes)).toEqual(new Set(["nearby", "overused", "phrase"]));
  });
});
