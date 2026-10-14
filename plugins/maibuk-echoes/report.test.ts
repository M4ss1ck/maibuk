/**
 * The report pipeline (#450, unit 3): the pure row grouping, the occurrence
 * context, and the loading loop, driven without a host. The page's own
 * behavior lives in `report-page.test.tsx`.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_ECHO_SETTINGS, type Echo, type EchoOccurrence } from "./find-echoes";
import {
  buildReport,
  computeReport,
  ECHO_KINDS,
  occurrenceContext,
  type ReportChapter,
  type ReportProgress,
  type ReportSource,
} from "./report";

function occurrence(chapter: number, from: number, to: number): EchoOccurrence {
  return { chapter, from, to };
}

describe("buildReport()", () => {
  it("orders each kind by count descending, then word ascending", () => {
    const text = "alpha beta gamma alpha beta alpha delta delta echo echo";
    const echoes: Echo[] = [
      { kind: "overused", normalized: "alpha", occurrences: [occurrence(0, 0, 5), occurrence(0, 17, 22), occurrence(0, 28, 33)] },
      { kind: "overused", normalized: "beta", occurrences: [occurrence(0, 6, 10), occurrence(0, 23, 27)] },
      { kind: "overused", normalized: "gamma", occurrences: [occurrence(0, 11, 16)] },
      { kind: "overused", normalized: "delta", occurrences: [occurrence(0, 34, 39), occurrence(0, 40, 45)] },
      { kind: "overused", normalized: "echo", occurrences: [occurrence(0, 46, 50), occurrence(0, 51, 55)] },
    ];

    const report = buildReport(echoes, [text]);

    expect(report.overused.map((row) => row.label)).toEqual([
      "alpha",
      "beta",
      "delta",
      "echo",
      "gamma",
    ]);
    expect(report.nearby).toEqual([]);
    expect(report.phrase).toEqual([]);
  });

  it("lists the distinct Chapters a row appears in, ascending, and labels it from its first occurrence", () => {
    const echoes: Echo[] = [
      {
        kind: "nearby",
        normalized: "harbor",
        occurrences: [occurrence(0, 4, 10), occurrence(1, 0, 6), occurrence(1, 20, 26)],
      },
    ];

    const report = buildReport(echoes, ["The harbor was calm.", "A harbor."]);

    expect(report.nearby).toHaveLength(1);
    const [row] = report.nearby;
    expect(row.label).toBe("harbor");
    expect(row.count).toBe(3);
    expect(row.chapterIndexes).toEqual([0, 1]);
  });

  it("keeps every kind present even when it has no Echoes", () => {
    const report = buildReport([], ["text"]);
    expect(Object.keys(report).sort()).toEqual([...ECHO_KINDS].sort());
    for (const kind of ECHO_KINDS) expect(report[kind]).toEqual([]);
  });
});

describe("occurrenceContext()", () => {
  it("shows about six words on each side with the match in place", () => {
    const text =
      "one two three four five six seven harbor eight nine ten eleven twelve thirteen";
    const from = text.indexOf("harbor");
    const context = occurrenceContext(text, occurrence(0, from, from + "harbor".length));

    expect(context).toBe("two three four five six seven harbor eight nine ten eleven twelve thirteen");
  });

  it("returns the whole text when the occurrence is not found", () => {
    expect(occurrenceContext("nothing here", occurrence(0, 999, 1004))).toBe("nothing here");
  });
});

describe("computeReport()", () => {
  function source(chapters: readonly ReportChapter[]): ReportSource {
    return { count: chapters.length, load: async (index) => chapters[index] };
  }

  it("loads in order, reports progress, and yields between Chapters", async () => {
    const chapters = source([
      { id: "c1", text: "The harbor was calm." },
      { id: "c2", text: "The harbor was empty." },
      { id: "c3", text: "The harbor was quiet." },
    ]);
    const progress: ReportProgress[] = [];
    let yields = 0;

    const result = await computeReport(chapters, "en", DEFAULT_ECHO_SETTINGS, {
      scope: "book",
      onProgress: (next) => progress.push(next),
      yieldControl: async () => {
        yields += 1;
      },
    });

    expect(result.chapters.map((chapter) => chapter.id)).toEqual(["c1", "c2", "c3"]);
    expect(progress).toEqual([
      { done: 0, total: 3 },
      { done: 1, total: 3 },
      { done: 2, total: 3 },
      { done: 3, total: 3 },
    ]);
    expect(yields).toBe(2);
    expect(result.report.phrase.map((row) => row.label)).toEqual(["The harbor was"]);
  });

  it("uses the Chapter threshold when the scope is one Chapter", async () => {
    const text = "The harbor was calm. The harbor was empty. The harbor was quiet. The harbor again.";
    const one = source([{ id: "c1", text }]);

    const chapter = await computeReport(one, "en", DEFAULT_ECHO_SETTINGS, { scope: "chapter" });
    const whole = await computeReport(one, "en", DEFAULT_ECHO_SETTINGS, { scope: "book" });

    // "The harbor was" appears three times in one Chapter: enough in Chapter
    // scope (2), and in Book scope (3) too; the overused rate differs.
    expect(chapter.report.phrase.map((row) => row.label)).toEqual(["The harbor was"]);
    expect(whole.report.phrase.map((row) => row.label)).toEqual(["The harbor was"]);
    expect(chapter.report.overused).toEqual([]);
  });
});
