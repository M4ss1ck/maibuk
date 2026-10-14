/**
 * The full report pipeline over the 100,000-word Book (#450, unit 3): load
 * every Chapter (yielding between them), detect, and group into rows. The
 * desktop budget is the #401 number, 2 s, judged on the median of three runs
 * the way the detection budget is.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_ECHO_SETTINGS, type EchoKind } from "./find-echoes";
import { tokenize } from "./language";
import { BOOK_WORDS, CHAPTER_WORDS, EN_WORDS, ES_WORDS, buildEchoBook } from "./fixtures/book";
import { computeReport, ECHO_KINDS, type EchoReport, type ReportSource } from "./report";

const SEED = 449;
const RUNS = 3;
const BOOK_BUDGET_MS = 2_000;

/** The middle of three timed runs, so one slow sample does not decide. */
function median(samples: readonly number[]): number {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

/** A source over already-built Chapters, as the page's SDK source supplies them. */
function sourceOf(book: readonly string[]): ReportSource {
  return {
    count: book.length,
    load: async (index) => ({ id: `c${index}`, text: book[index] }),
  };
}

interface Measured {
  report: EchoReport;
  runs: number[];
  medianMs: number;
}

/** One warm-up run (the stemmer cache is cold on the first call), then three timed. */
async function measure(book: readonly string[], language: string): Promise<Measured> {
  await computeReport(sourceOf(book), language, DEFAULT_ECHO_SETTINGS, { scope: "book" });
  const runs: number[] = [];
  let report: EchoReport = { nearby: [], overused: [], phrase: [] };
  for (let run = 0; run < RUNS; run++) {
    const start = performance.now();
    report = (
      await computeReport(sourceOf(book), language, DEFAULT_ECHO_SETTINGS, { scope: "book" })
    ).report;
    runs.push(performance.now() - start);
  }
  return { report, runs, medianMs: median(runs) };
}

function kindsOf(report: EchoReport): Set<EchoKind> {
  const kinds = new Set<EchoKind>();
  for (const kind of ECHO_KINDS) if (report[kind].length > 0) kinds.add(kind);
  return kinds;
}

describe("computeReport() 100k-word Book", () => {
  it("stays inside the Book budget — en", async () => {
    const book = buildEchoBook(EN_WORDS, SEED);
    const tokens = book.reduce((sum, chapter) => sum + tokenize(chapter).length, 0);
    expect(tokens).toBe(BOOK_WORDS);
    expect(book).toHaveLength(20);
    expect(tokenize(book[0])).toHaveLength(CHAPTER_WORDS);

    const { report, runs, medianMs } = await measure(book, "en");
    console.info(
      `computeReport 100k-word Book: median ${medianMs.toFixed(0)} ms (runs: ${runs
        .map((run) => run.toFixed(0))
        .join(", ")} ms)`
    );

    expect(medianMs).toBeLessThan(BOOK_BUDGET_MS);
    expect(kindsOf(report)).toEqual(new Set(["nearby", "overused", "phrase"]));
  });

  it("stays inside the Book budget — es", async () => {
    const book = buildEchoBook(ES_WORDS, SEED);
    const tokens = book.reduce((sum, chapter) => sum + tokenize(chapter).length, 0);
    expect(tokens).toBe(BOOK_WORDS);

    const { report, runs, medianMs } = await measure(book, "es");
    console.info(
      `computeReport 100k-word Book: median ${medianMs.toFixed(0)} ms (runs: ${runs
        .map((run) => run.toFixed(0))
        .join(", ")} ms)`
    );

    expect(medianMs).toBeLessThan(BOOK_BUDGET_MS);
    expect(kindsOf(report)).toEqual(new Set(["nearby", "overused", "phrase"]));
  });
});
