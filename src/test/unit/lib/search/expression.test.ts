import { describe, expect, it } from "vitest";
import {
  buildSearchRegExp,
  countMatches,
  findMatchRanges,
  foldAccents,
  type SearchOptions,
} from "@/lib/search/expression";

// The shared matcher behind Find and Replace and Library Search: literal
// queries fold accents on both sides with no switch, a Regex runs as written,
// and every range lands on the original characters, accents included.

const literal = (over: Partial<SearchOptions> = {}): SearchOptions => ({
  caseSensitive: false,
  wholeWord: false,
  regex: false,
  ...over,
});

const textOf = (text: string, ranges: { start: number; end: number }[]): string[] =>
  ranges.map((range) => text.slice(range.start, range.end));

describe("foldAccents", () => {
  it("folds Spanish accents both ways", () => {
    expect(foldAccents("canción")).toBe("cancion");
    expect(foldAccents("Eléna")).toBe("Elena");
    expect(foldAccents("niño")).toBe("nino");
  });

  it("folds English loanword diaereses", () => {
    expect(foldAccents("naïve")).toBe("naive");
    expect(foldAccents("café")).toBe("cafe");
  });

  it("leaves case alone for Match case to decide", () => {
    expect(foldAccents("ELÉNA")).toBe("ELENA");
  });
});

describe("findMatchRanges with a literal query", () => {
  it("finds accented text from an unaccented query", () => {
    expect(findMatchRanges("La canción del faro", "cancion", literal())).toEqual([
      { start: 3, end: 10 },
    ]);
  });

  it("finds unaccented text from an accented query", () => {
    expect(findMatchRanges("La cancion del faro", "canción", literal())).toEqual([
      { start: 3, end: 10 },
    ]);
  });

  it("matches Elena and Eléna in either direction", () => {
    expect(
      textOf("Eléna walked in", findMatchRanges("Eléna walked in", "ELENA", literal()))
    ).toEqual(["Eléna"]);
    expect(
      textOf("Elena walked in", findMatchRanges("Elena walked in", "eléna", literal()))
    ).toEqual(["Elena"]);
  });

  it("matches naïve from naive and back", () => {
    expect(findMatchRanges("a naïve idea", "naive", literal())).toEqual([{ start: 2, end: 7 }]);
    expect(findMatchRanges("a naive idea", "naïve", literal())).toEqual([{ start: 2, end: 7 }]);
  });

  it("folds ñ to n in both directions", () => {
    expect(textOf("mañana", findMatchRanges("mañana", "manana", literal()))).toEqual(["mañana"]);
    expect(textOf("manana", findMatchRanges("manana", "mañana", literal()))).toEqual(["manana"]);
  });

  it("lands on the original characters for composed and decomposed text", () => {
    const composed = "caf\u00e9"; // é as one code point
    const decomposed = "café"; // e + combining acute
    expect(composed.length).toBe(4);
    expect(decomposed.length).toBe(5);
    expect(textOf(composed, findMatchRanges(composed, "cafe", literal()))).toEqual([composed]);
    expect(textOf(decomposed, findMatchRanges(decomposed, "cafe", literal()))).toEqual([
      decomposed,
    ]);
    expect(findMatchRanges(composed, "café", literal())).toEqual([{ start: 0, end: 4 }]);
    expect(findMatchRanges(decomposed, "café", literal())).toEqual([{ start: 0, end: 5 }]);
  });

  it("keeps Whole word working on the folded text", () => {
    expect(
      findMatchRanges("cancionero canta la canción", "cancion", literal({ wholeWord: true }))
    ).toEqual([{ start: 20, end: 27 }]);
  });

  it("keeps Match case working: case-sensitive but still accent-insensitive", () => {
    // Off: case folds too.
    expect(findMatchRanges("Eléna walked in", "ELENA", literal())).toHaveLength(1);
    // On: the case must match exactly, the accent still folds.
    expect(findMatchRanges("Eléna walked in", "ELENA", literal({ caseSensitive: true }))).toEqual(
      []
    );
    expect(
      textOf(
        "ELÉNA walked in",
        findMatchRanges("ELÉNA walked in", "ELENA", literal({ caseSensitive: true }))
      )
    ).toEqual(["ELÉNA"]);
  });
});

describe("findMatchRanges with a Regex", () => {
  it("pins the exact accents", () => {
    expect(findMatchRanges("La canción del faro", "cancion", literal({ regex: true }))).toEqual([]);
    expect(findMatchRanges("La canción del faro", "canci.n", literal({ regex: true }))).toEqual([
      { start: 3, end: 10 },
    ]);
    expect(findMatchRanges("La cancion del faro", "canci.n", literal({ regex: true }))).toEqual([
      { start: 3, end: 10 },
    ]);
  });
});

describe("countMatches", () => {
  it("counts accent-insensitive matches the way Find and Replace shows them", () => {
    expect(countMatches("canción, cancion, CANCIÓN", "cancion", literal())).toBe(3);
  });
});

describe("Whole word across scripts", () => {
  const whole = (over: Partial<SearchOptions> = {}): SearchOptions =>
    literal({ wholeWord: true, ...over });

  it("matches a Cyrillic word but not a longer one", () => {
    expect(textOf("Привет мир", findMatchRanges("Привет мир", "мир", whole()))).toEqual(["мир"]);
    expect(findMatchRanges("Привет мира", "мир", whole())).toEqual([]);
  });

  it("matches a Greek word", () => {
    expect(textOf("Γειά σου", findMatchRanges("Γειά σου", "σου", whole()))).toEqual(["σου"]);
  });

  it("matches a Chinese word, where no boundary exists", () => {
    expect(
      textOf("我喜欢写小说和读书", findMatchRanges("我喜欢写小说和读书", "小说", whole()))
    ).toEqual(["小说"]);
  });

  it("does not match inside a kana or Hangul character that decomposes", () => {
    expect(findMatchRanges("がか", "か", literal())).toEqual([{ start: 1, end: 2 }]);
    expect(findMatchRanges("がか", "か", whole())).toEqual([{ start: 1, end: 2 }]);
    expect(findMatchRanges("한글", "하", literal())).toEqual([]);
    expect(findMatchRanges("한글", "한", literal())).toEqual([{ start: 0, end: 1 }]);
  });

  it("still keeps ASCII words whole", () => {
    expect(textOf("hello world", findMatchRanges("hello world", "world", whole()))).toEqual([
      "world",
    ]);
    expect(findMatchRanges("helloworld", "world", whole())).toEqual([]);
    expect(findMatchRanges("snake_case", "case", whole())).toEqual([]);
  });

  it("works the same through Regex", () => {
    expect(
      textOf("Привет мир", findMatchRanges("Привет мир", "мир", whole({ regex: true })))
    ).toEqual(["мир"]);
    expect(findMatchRanges("Привет мира", "мир", whole({ regex: true }))).toEqual([]);
  });

  it("keeps every branch of a Regex alternation whole", () => {
    expect(findMatchRanges("мирок домик", "мир|дом", whole({ regex: true }))).toEqual([]);
    expect(
      textOf("мир дом", findMatchRanges("мир дом", "мир|дом", whole({ regex: true })))
    ).toEqual(["мир", "дом"]);
  });

  it("does not let the boundary group make an invalid Regex valid", () => {
    expect(() => findMatchRanges("x", "a)(b", whole({ regex: true }))).toThrow();
  });

  it("keeps folding accents while keeping the word whole", () => {
    expect(
      textOf("una canción hoy", findMatchRanges("una canción hoy", "cancion", whole()))
    ).toEqual(["canción"]);
  });

  it("compiles legacy Regex syntax that the Unicode flag rejects", () => {
    expect(textOf("x a-b y", findMatchRanges("x a-b y", "a\\-b", whole({ regex: true })))).toEqual([
      "a-b",
    ]);
    expect(() => findMatchRanges("a{", "a{", whole({ regex: true }))).not.toThrow();
    expect(() => findMatchRanges("]x", "]x", whole({ regex: true }))).not.toThrow();
  });

  it("still throws for an invalid Regex, whole word or not", () => {
    expect(() => findMatchRanges("x", "(", whole({ regex: true }))).toThrow();
    expect(() => findMatchRanges("x", "(", literal({ regex: true, wholeWord: false }))).toThrow();
  });

  it("leaves the flags without u when Whole word is off", () => {
    expect(
      buildSearchRegExp("a", { caseSensitive: false, wholeWord: false, regex: false }).unicode
    ).toBe(false);
  });

  it("terminates on a zero-length match beside an emoji", () => {
    expect(
      findMatchRanges("😀😀", "x*", { caseSensitive: false, wholeWord: true, regex: true })
    ).toEqual([]);
  });
});
