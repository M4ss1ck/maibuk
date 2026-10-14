import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DEFAULT_ECHO_SETTINGS, type Echo, type EchoSettings, findEchoes } from "./find-echoes";
import { createAnalyzer, tokenize } from "./language";

/**
 * A small mixed vocabulary. It carries English and Spanish words, accents,
 * typographic and ASCII apostrophes, and capitalized spellings, so one run
 * exercises every fold, stem, and stop-list path Echoes has.
 */
const WORDS: readonly string[] = [
  "canción",
  "sé",
  "didn’t",
  "don't",
  "Harbor",
  "harbor",
  "Walked",
  "walking",
  "the",
  "old",
  "lighthouse",
  "casa",
  "vieja",
  "puerta",
  "raramente",
  "mamá",
  "mama",
  "corazón",
  "river",
  "riverbank",
  "siempre",
  "verde",
  "verdad",
  "útil",
  "zumbido",
  "bandera",
];

/** Keeping digits, quotes, and line breaks among the joins widens the shapes a Chapter takes. */
const SEPARATORS: readonly string[] = [" ", ", ", ". ", "\n", " — ", '"', " 42 "];

const chapterText = fc
  .array(fc.tuple(fc.constantFrom(...WORDS), fc.constantFrom(...SEPARATORS)), { maxLength: 20 })
  .map((pieces) => pieces.map(([word, separator]) => `${word}${separator}`).join(""));

const inputArbitrary = fc.record({
  language: fc.constantFrom("en", "es", "fr", "en-US"),
  stemming: fc.boolean(),
  nearbyWindow: fc.integer({ min: 1, max: 300 }),
  single: fc.boolean(),
  chapters: fc.array(chapterText, { minLength: 1, maxLength: 4 }),
});

const unicodeInputArbitrary = fc.record({
  text: fc.string({ unit: "grapheme", maxLength: 60 }),
  language: fc.constantFrom("en", "es", "fr", "en-US"),
  stemming: fc.boolean(),
  nearbyWindow: fc.integer({ min: 1, max: 300 }),
});

function settingsOf(stemming: boolean, nearbyWindow: number): EchoSettings {
  return { ...DEFAULT_ECHO_SETTINGS, stemming, nearbyWindow };
}

/** Bounds and slice-back, the two invariants every occurrence must hold to. */
function assertBoundsAndSlice(
  echoes: readonly Echo[],
  text: string | readonly string[],
  language: string,
  stemming: boolean
): void {
  const chapterTexts = typeof text === "string" ? [text] : text;
  const analyzer = createAnalyzer(language, { stemming });
  for (const echo of echoes) {
    for (const occurrence of echo.occurrences) {
      expect(occurrence.chapter).toBeGreaterThanOrEqual(0);
      expect(occurrence.chapter).toBeLessThan(chapterTexts.length);
      expect(occurrence.from).toBeGreaterThanOrEqual(0);
      expect(occurrence.from).toBeLessThan(occurrence.to);
      expect(occurrence.to).toBeLessThanOrEqual(chapterTexts[occurrence.chapter].length);
      const slice = chapterTexts[occurrence.chapter].slice(occurrence.from, occurrence.to);
      const tokens = tokenize(slice);
      if (echo.kind === "phrase") {
        expect(tokens.map((token) => token.folded).join(" ")).toBe(echo.normalized);
      } else {
        expect(tokens).toHaveLength(1);
        expect(tokens[0].from).toBe(0);
        expect(tokens[0].to).toBe(slice.length);
        expect(analyzer.key(tokens[0].folded)).toBe(echo.normalized);
      }
    }
  }
}

/** Document order, and the count a kind needs before it is ever reported. */
function assertOrderAndCount(echoes: readonly Echo[]): void {
  for (const echo of echoes) {
    const minimum = echo.kind === "overused" ? 5 : 2;
    expect(echo.occurrences.length).toBeGreaterThanOrEqual(minimum);
    const positions = echo.occurrences.map(
      (occurrence) => occurrence.chapter * 1_000_000 + occurrence.from
    );
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
  }
}

describe("findEchoes() properties", () => {
  it("slices every occurrence back to its Echo, orders it, and repeats itself", () => {
    fc.assert(
      fc.property(inputArbitrary, (input) => {
        const [first] = input.chapters;
        const text = input.single ? first : input.chapters;
        const settings = settingsOf(input.stemming, input.nearbyWindow);

        const echoes = findEchoes(text, input.language, settings);
        assertBoundsAndSlice(echoes, text, input.language, input.stemming);
        assertOrderAndCount(echoes);
        expect(findEchoes(text, input.language, settings)).toEqual(echoes);
      }),
      { seed: 449, numRuns: 200 }
    );
  });

  it("never throws on arbitrary text and still slices every occurrence", () => {
    fc.assert(
      fc.property(unicodeInputArbitrary, (input) => {
        const settings = settingsOf(input.stemming, input.nearbyWindow);
        const run = () => findEchoes(input.text, input.language, settings);
        expect(run).not.toThrow();
        assertBoundsAndSlice(run(), input.text, input.language, input.stemming);
      }),
      { seed: 449, numRuns: 200 }
    );
  });
});
