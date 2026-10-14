import { describe, expect, it } from "vitest";
import { createAnalyzer, tokenize } from "./language";
import * as en from "./fixtures/en";
import * as es from "./fixtures/es";
import {
  DEFAULT_ECHO_SETTINGS,
  type Echo,
  type EchoSettings,
  NEARBY_WINDOW_MAX,
  NEARBY_WINDOW_MIN,
  findEchoes,
} from "./find-echoes";

/** The shared fixtures every case needs; Spanish carries one extra string. */
interface Fixtures {
  nearbyChain: string;
  stemPair: string;
  caseFolding: string;
  shortAndStopWords: string;
  limitedSupport: string;
}

interface Subject {
  language: string;
  anchor: string;
  second: string;
  stemWord: string;
  stopWord: string;
  fixtures: Fixtures;
}

const SUBJECTS: Subject[] = [
  {
    language: "en",
    anchor: "harbor",
    second: "river",
    stemWord: "walk",
    stopWord: "they",
    fixtures: en,
  },
  {
    language: "es",
    anchor: "jardín",
    second: "ventana",
    stemWord: "puerta",
    stopWord: "esta",
    fixtures: es,
  },
];

function settings(overrides: Partial<EchoSettings>): EchoSettings {
  return { ...DEFAULT_ECHO_SETTINGS, ...overrides };
}

function keyOf(word: string, language: string, stemming = true): string {
  const [token] = tokenize(word);
  return createAnalyzer(language, { stemming }).key(token.folded);
}

function findEcho(echoes: Echo[], kind: Echo["kind"], normalized: string): Echo | undefined {
  return echoes.find((echo) => echo.kind === kind && echo.normalized === normalized);
}

const ALPHABET = 26;

/**
 * Distinct three-letter tokens. They sit below the four-letter eligibility
 * floor, so they mark token distance and Book totals without ever forming an
 * Echo, and they let a test pin an exact gap or word count.
 */
function fillerWords(count: number): string[] {
  const words: string[] = [];
  for (let i = 0; i < count; i++) {
    const first = i % ALPHABET;
    const second = Math.floor(i / ALPHABET) % ALPHABET;
    const third = Math.floor(i / (ALPHABET * ALPHABET)) % ALPHABET;
    words.push(String.fromCharCode(97 + first, 97 + second, 97 + third));
  }
  return words;
}

function repeat(word: string, count: number): string[] {
  return Array.from({ length: count }, () => word);
}

/** The two anchors sit `gap` tokens apart, every token in between counted. */
function atDistance(anchor: string, gap: number): string {
  return [anchor, ...fillerWords(gap - 1), anchor].join(" ");
}

/** `anchorCount` uses of the anchor inside a text of exactly `totalWords` tokens. */
function overusedText(anchor: string, anchorCount: number, totalWords: number): string {
  return [...fillerWords(totalWords - anchorCount), ...repeat(anchor, anchorCount)].join(" ");
}

/** Nearby and Overused both fire here: each anchor chains and clears the rate. */
function mixedText(subject: Subject): string {
  return [
    ...repeat(subject.anchor, 5),
    ...fillerWords(20),
    ...repeat(subject.second, 5),
    ...fillerWords(10),
  ].join(" ");
}

describe("DEFAULT_ECHO_SETTINGS", () => {
  it("turns every kind on, stems, opens the window to 50, and ignores nothing", () => {
    expect(DEFAULT_ECHO_SETTINGS).toEqual({
      nearby: true,
      overused: true,
      phrases: true,
      stemming: true,
      nearbyWindow: 50,
      ignore: [],
    });
  });

  it("bounds the Nearby window at 10 and 200", () => {
    expect(NEARBY_WINDOW_MIN).toBe(10);
    expect(NEARBY_WINDOW_MAX).toBe(200);
  });
});

for (const subject of SUBJECTS) {
  const language = subject.language;

  describe(`findEchoes() Nearby echo — ${language}`, () => {
    const nearbyOnly = settings({ overused: false });

    it("flags the same stem exactly 50 words apart", () => {
      const echoes = findEchoes(atDistance(subject.anchor, 50), language, nearbyOnly);
      const nearby = echoes.filter((echo) => echo.kind === "nearby");
      expect(nearby).toHaveLength(1);
      expect(nearby[0].normalized).toBe(keyOf(subject.anchor, language));
      expect(nearby[0].occurrences).toHaveLength(2);
    });

    it("does not flag the same stem 51 words apart", () => {
      const echoes = findEchoes(atDistance(subject.anchor, 51), language, nearbyOnly);
      expect(echoes).toEqual([]);
    });

    it("counts every token, so a shorter window changes the answer", () => {
      const echoes = findEchoes(
        atDistance(subject.anchor, 50),
        language,
        settings({ overused: false, nearbyWindow: 49 })
      );
      expect(echoes).toEqual([]);
    });

    it("treats different inflections of one stem as a single chain", () => {
      const echoes = findEchoes(subject.fixtures.stemPair, language, nearbyOnly);
      const nearby = echoes.filter((echo) => echo.kind === "nearby");
      expect(nearby).toHaveLength(1);
      expect(nearby[0].normalized).toBe(keyOf(subject.stemWord, language));
      expect(nearby[0].occurrences).toHaveLength(2);
    });

    it("treats a chain of three as one Echo", () => {
      const echoes = findEchoes(subject.fixtures.nearbyChain, language, nearbyOnly);
      const nearby = echoes.filter((echo) => echo.kind === "nearby");
      expect(nearby).toHaveLength(1);
      expect(nearby[0].occurrences).toHaveLength(3);
    });

    it("never flags a word under four letters or a stop word", () => {
      const echoes = findEchoes(
        subject.fixtures.shortAndStopWords,
        language,
        DEFAULT_ECHO_SETTINGS
      );
      expect(echoes).toEqual([]);
    });

    it("never flags a stop word even when it is long enough", () => {
      const echoes = findEchoes(subject.fixtures.limitedSupport, language, nearbyOnly);
      const normalized = echoes.map((echo) => echo.normalized);
      expect(normalized).not.toContain(keyOf(subject.stopWord, language));
    });

    it("still matches identical words when stemming is off", () => {
      const echoes = findEchoes(
        subject.fixtures.nearbyChain,
        language,
        settings({ overused: false, stemming: false })
      );
      const nearby = echoes.filter((echo) => echo.kind === "nearby");
      expect(nearby).toHaveLength(1);
      expect(nearby[0].occurrences).toHaveLength(3);
    });

    it("matches only identical folded words when stemming is off", () => {
      const echoes = findEchoes(
        subject.fixtures.stemPair,
        language,
        settings({ overused: false, stemming: false })
      );
      expect(echoes).toEqual([]);
    });

    it("folds case so two spellings of one word chain", () => {
      const echoes = findEchoes(subject.fixtures.caseFolding, language, nearbyOnly);
      const nearby = echoes.filter((echo) => echo.kind === "nearby");
      expect(nearby).toHaveLength(1);
      expect(nearby[0].occurrences).toHaveLength(2);
    });

    it("clamps nearbyWindow 5 up to 10", () => {
      const window = settings({ overused: false, nearbyWindow: 5 });
      const flagged = findEchoes(atDistance(subject.anchor, 10), language, window);
      expect(flagged.filter((echo) => echo.kind === "nearby")).toHaveLength(1);
      const missed = findEchoes(atDistance(subject.anchor, 11), language, window);
      expect(missed).toEqual([]);
    });

    it("clamps nearbyWindow 500 down to 200", () => {
      const window = settings({ overused: false, nearbyWindow: 500 });
      const flagged = findEchoes(atDistance(subject.anchor, 200), language, window);
      expect(flagged.filter((echo) => echo.kind === "nearby")).toHaveLength(1);
      const missed = findEchoes(atDistance(subject.anchor, 201), language, window);
      expect(missed).toEqual([]);
    });

    it("falls back to the 50-word window when nearbyWindow is not a number", () => {
      const window = settings({ overused: false, nearbyWindow: Number.NaN });
      expect(findEchoes(atDistance(subject.anchor, 50), language, window)).toHaveLength(1);
      expect(findEchoes(atDistance(subject.anchor, 51), language, window)).toEqual([]);
    });

    it("keeps chains inside one Chapter and reports the Chapter index", () => {
      const first = [...fillerWords(5), subject.anchor].join(" ");
      const middle = [subject.anchor, ...fillerWords(3), subject.anchor].join(" ");
      const last = [subject.anchor, ...fillerWords(5)].join(" ");
      const echoes = findEchoes([first, middle, last], language, nearbyOnly);
      const nearby = echoes.filter((echo) => echo.kind === "nearby");
      expect(nearby).toHaveLength(1);
      expect(nearby[0].occurrences).toHaveLength(2);
      expect(nearby[0].occurrences.map((occurrence) => occurrence.chapter)).toEqual([1, 1]);
    });
  });

  describe(`findEchoes() Overused word — ${language}`, () => {
    const overusedOnly = settings({ nearby: false });

    it("flags five uses in one thousand words", () => {
      const echoes = findEchoes(overusedText(subject.anchor, 5, 1000), language, overusedOnly);
      const echo = findEcho(echoes, "overused", keyOf(subject.anchor, language));
      expect(echo?.occurrences).toHaveLength(5);
    });

    it("never flags four uses in one thousand words", () => {
      const echoes = findEchoes(overusedText(subject.anchor, 4, 1000), language, overusedOnly);
      expect(findEcho(echoes, "overused", keyOf(subject.anchor, language))).toBeUndefined();
    });

    it("does not flag five uses in two thousand words", () => {
      const echoes = findEchoes(overusedText(subject.anchor, 5, 2000), language, overusedOnly);
      expect(findEcho(echoes, "overused", keyOf(subject.anchor, language))).toBeUndefined();
    });

    it("counts uses across Chapters against the Book total", () => {
      const book = [
        [...fillerWords(497), ...repeat(subject.anchor, 3)].join(" "),
        [...fillerWords(498), ...repeat(subject.anchor, 2)].join(" "),
      ];
      const echoes = findEchoes(book, language, overusedOnly);
      const echo = findEcho(echoes, "overused", keyOf(subject.anchor, language));
      expect(echo?.occurrences).toHaveLength(5);
      expect(echo?.occurrences.map((occurrence) => occurrence.chapter)).toEqual([0, 0, 0, 1, 1]);
    });

    it("does not flag a single Chapter that holds only part of the Book uses", () => {
      const chapter = [...fillerWords(497), ...repeat(subject.anchor, 3)].join(" ");
      const echoes = findEchoes(chapter, language, overusedOnly);
      expect(findEcho(echoes, "overused", keyOf(subject.anchor, language))).toBeUndefined();
    });
  });

  describe(`findEchoes() Ignore list — ${language}`, () => {
    const nearbyOnly = settings({ overused: false });

    it("never reports an ignored word, whichever inflection is listed", () => {
      const echoes = findEchoes(subject.fixtures.stemPair, language, {
        ...nearbyOnly,
        ignore: [subject.stemWord],
      });
      expect(echoes).toEqual([]);
    });

    it("trims and case-folds Ignore entries", () => {
      const echoes = findEchoes(subject.fixtures.stemPair, language, {
        ...nearbyOnly,
        ignore: [`  ${subject.stemWord.toUpperCase()}  `],
      });
      expect(echoes).toEqual([]);
    });

    it("keeps reporting a word that is not on the Ignore list", () => {
      const echoes = findEchoes(subject.fixtures.stemPair, language, {
        ...nearbyOnly,
        ignore: ["unrelatedword"],
      });
      expect(echoes.filter((echo) => echo.kind === "nearby")).toHaveLength(1);
    });
  });

  it(`slices every occurrence back to a word whose key is normalized — ${language}`, () => {
    const text = mixedText(subject);
    const echoes = findEchoes(text, language, DEFAULT_ECHO_SETTINGS);
    expect(echoes.length).toBeGreaterThan(0);
    const analyzer = createAnalyzer(language, { stemming: true });
    for (const echo of echoes) {
      for (const occurrence of echo.occurrences) {
        const [token] = tokenize(text.slice(occurrence.from, occurrence.to));
        expect(analyzer.key(token.folded)).toBe(echo.normalized);
      }
    }
  });

  it(`lists Nearby echoes before Overused, each by first occurrence — ${language}`, () => {
    const echoes = findEchoes(mixedText(subject), language, DEFAULT_ECHO_SETTINGS);
    const anchorKey = keyOf(subject.anchor, language);
    const secondKey = keyOf(subject.second, language);
    expect(echoes.map((echo) => `${echo.kind}:${echo.normalized}`)).toEqual([
      `nearby:${anchorKey}`,
      `nearby:${secondKey}`,
      `overused:${anchorKey}`,
      `overused:${secondKey}`,
    ]);
    for (const echo of echoes) {
      const positions = echo.occurrences.map(
        (occurrence) => occurrence.chapter * 1_000_000 + occurrence.from
      );
      expect(positions).toEqual([...positions].sort((left, right) => left - right));
    }
  });
}

describe("findEchoes() kind switches", () => {
  it("suppresses Nearby echoes when nearby is false", () => {
    const echoes = findEchoes(en.nearbyChain, "en", settings({ nearby: false }));
    expect(echoes.filter((echo) => echo.kind === "nearby")).toEqual([]);
  });

  it("suppresses Overused echoes when overused is false", () => {
    const echoes = findEchoes(overusedText("harbor", 5, 1000), "en", settings({ overused: false }));
    expect(echoes.filter((echo) => echo.kind === "overused")).toEqual([]);
  });
});

describe("findEchoes() limited support", () => {
  it("finds identical words with no stop words (English stop word still shows)", () => {
    const echoes = findEchoes(en.limitedSupport, "fr", DEFAULT_ECHO_SETTINGS);
    const nearby = echoes.filter((echo) => echo.kind === "nearby").map((echo) => echo.normalized);
    expect(nearby).toContain("they");
    expect(nearby).toContain("walked");
  });

  it("does not stem, so inflections stay apart", () => {
    const echoes = findEchoes(en.stemPair, "fr", settings({ overused: false }));
    expect(echoes).toEqual([]);
  });

  it("finds identical Spanish words with no stemming", () => {
    const echoes = findEchoes(es.limitedSupport, "fr", settings({ overused: false }));
    const nearby = echoes.filter((echo) => echo.kind === "nearby").map((echo) => echo.normalized);
    expect(nearby).toContain("esta");
  });
});

describe("findEchoes() accents", () => {
  it("keeps accents, so mamá and mama stay apart when stemming is off", () => {
    const echoes = findEchoes(es.accentPair, "es", settings({ overused: false, stemming: false }));
    expect(echoes).toEqual([]);
  });

  it("merges mamá and mama once stemming is on", () => {
    const echoes = findEchoes(es.accentPair, "es", settings({ overused: false, stemming: true }));
    const nearby = echoes.filter((echo) => echo.kind === "nearby");
    expect(nearby).toHaveLength(1);
    expect(nearby[0].normalized).toBe(keyOf("mamá", "es"));
  });
});
