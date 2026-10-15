/**
 * The report pipeline (#450, unit 3): the pure row grouping, the occurrence
 * context, and the loading loop, driven without a host. The page's own
 * behavior lives in `report-page.test.tsx`.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_ECHO_SETTINGS, type Echo, type EchoOccurrence } from "./find-echoes";
import { getPluginUiElement } from "@/plugin-sdk/ui-table";
import {
  buildReport,
  clampText,
  computeReport,
  ECHO_KINDS,
  fitChapterTitles,
  fitOptions,
  occurrenceContext,
  ROW_DESCRIPTION_MAX,
  ROW_LABEL_MAX,
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

  it("merges Echoes that share a kind and key into one row across Chapters", () => {
    // One word echoing in two Chapters arrives as two Echoes (a Chapter break
    // resets the nearby window); the report shows one row for the word.
    const echoes: Echo[] = [
      { kind: "nearby", normalized: "harbor", occurrences: [occurrence(0, 4, 10)] },
      { kind: "nearby", normalized: "harbor", occurrences: [occurrence(1, 0, 6)] },
    ];

    const report = buildReport(echoes, ["The harbor was calm.", "harbor again."]);

    expect(report.nearby).toHaveLength(1);
    const [row] = report.nearby;
    expect(row.label).toBe("harbor");
    expect(row.count).toBe(2);
    expect(row.chapterIndexes).toEqual([0, 1]);
    expect(row.occurrences).toEqual([occurrence(0, 4, 10), occurrence(1, 0, 6)]);
  });

  it("concatenates merged occurrences in reading order regardless of arrival", () => {
    const echoes: Echo[] = [
      { kind: "phrase", normalized: "dark night", occurrences: [occurrence(1, 8, 18)] },
      { kind: "phrase", normalized: "dark night", occurrences: [occurrence(0, 2, 12)] },
    ];

    const report = buildReport(echoes, ["the dark night fell", "the dark night came"]);

    expect(report.phrase).toHaveLength(1);
    expect(report.phrase[0].occurrences).toEqual([occurrence(0, 2, 12), occurrence(1, 8, 18)]);
  });

  it("keeps every kind present even when it has no Echoes", () => {
    const report = buildReport([], ["text"]);
    expect(Object.keys(report).sort()).toEqual([...ECHO_KINDS].sort());
    for (const kind of ECHO_KINDS) expect(report[kind]).toEqual([]);
  });
});

describe("occurrenceContext()", () => {
  it("shows about six words on each side with the match in place, eliding a mid-sentence cut", () => {
    const text =
      "one two three four five six seven harbor eight nine ten eleven twelve thirteen";
    const from = text.indexOf("harbor");
    const context = occurrenceContext(text, occurrence(0, from, from + "harbor".length));

    // The window opens inside the first sentence, so the leading cut is marked;
    // it runs to the end of the text, so nothing trails.
    expect(context).toBe(
      "…two three four five six seven harbor eight nine ten eleven twelve thirteen"
    );
  });

  it("elides both sides when the window is cut mid-sentence at both ends", () => {
    const text =
      "alpha beta gamma delta epsilon zeta eta harbor theta iota kappa lambda mu nu xi omicron";
    const from = text.indexOf("harbor");
    const context = occurrenceContext(text, occurrence(0, from, from + "harbor".length));

    expect(context).toBe("…beta gamma delta epsilon zeta eta harbor theta iota kappa lambda mu nu…");
  });

  it("does not elide a cut that lands on a sentence boundary", () => {
    const text = "Ends here. one two harbor three four. five six";
    const from = text.indexOf("harbor");
    const context = occurrenceContext(text, occurrence(0, from, from + "harbor".length), 2);

    expect(context).toBe("one two harbor three four");
  });

  it("does not elide when the whole Chapter fits in the window", () => {
    const text = "The harbor was calm.";
    const from = text.indexOf("harbor");
    expect(occurrenceContext(text, occurrence(0, from, from + "harbor".length))).toBe(
      "The harbor was calm"
    );
  });

  it("returns the whole text when the occurrence is not found", () => {
    expect(occurrenceContext("nothing here", occurrence(0, 999, 1004))).toBe("nothing here");
  });
});

describe("row text limits", () => {
  it("match the host's CollectionRow caps", () => {
    const props = getPluginUiElement("maibuk-collection-row")?.props;
    expect(props?.label.maxLength).toBe(ROW_LABEL_MAX);
    expect(props?.description.maxLength).toBe(ROW_DESCRIPTION_MAX);
  });
});

describe("clampText()", () => {
  it("returns text within the cap unchanged", () => {
    expect(clampText("harbor", 6)).toBe("harbor");
  });

  it("cuts longer text to the cap, ending in an ellipsis", () => {
    expect(clampText("harbor lights", 8)).toBe("harbor …");
  });

  it("never splits a surrogate pair", () => {
    const clamped = clampText("ab😀cd", 4);
    expect(clamped).toBe("ab…");
    expect(clamped.charCodeAt(clamped.length - 2)).toBe("b".charCodeAt(0));
  });
});

describe("fitChapterTitles()", () => {
  const render = (chapters: string) => `3 times · ${chapters}`;
  const more = (hidden: number) => `+${hidden} more`;

  it("names every title when they fit", () => {
    expect(fitChapterTitles(["One", "Two"], render, more, 100)).toBe("3 times · One, Two");
  });

  it("names the leading titles that fit and counts the rest", () => {
    const titles = ["Alpha", "Bravo", "Charlie", "Delta"];
    expect(fitChapterTitles(titles, render, more, 32)).toBe("3 times · Alpha, Bravo, +2 more");
  });

  it("names no title when even the first does not fit", () => {
    expect(fitChapterTitles(["A very long title", "B"], render, more, 20)).toBe("3 times · +2 more");
  });

  it("clamps a summary that cannot fit at all", () => {
    expect(fitChapterTitles(["A", "B"], render, more, 8)).toBe("3 times…");
  });

  it("always fits the cap, for any number and length of titles", () => {
    for (const count of [1, 2, 5, 46, 300]) {
      for (const length of [1, 20, 80, 2000]) {
        const titles = Array.from({ length: count }, (_, i) => `${i}`.padEnd(length, "x"));
        const summary = fitChapterTitles(titles, render, more, ROW_DESCRIPTION_MAX);
        expect(summary.length).toBeLessThanOrEqual(ROW_DESCRIPTION_MAX);
        expect(summary.startsWith("3 times · ")).toBe(true);
      }
    }
  });
});

describe("fitOptions()", () => {
  const options = ["whole", "a", "b", "c", "d"].map((value) => ({ value, label: value }));
  const values = (list: readonly { value: string }[]) => list.map((option) => option.value);

  it("keeps every option within the cap", () => {
    expect(values(fitOptions(options, "c", 5))).toEqual(["whole", "a", "b", "c", "d"]);
  });

  it("keeps the leading options past the cap when the selection is among them", () => {
    expect(values(fitOptions(options, "a", 3))).toEqual(["whole", "a", "b"]);
  });

  it("swaps the last kept option for a selection past the cap", () => {
    expect(values(fitOptions(options, "d", 3))).toEqual(["whole", "a", "d"]);
  });

  it("keeps the leading options when nothing valid is selected", () => {
    expect(values(fitOptions(options, "", 2))).toEqual(["whole", "a"]);
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
