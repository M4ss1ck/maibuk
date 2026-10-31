import { describe, expect, it } from "vitest";
import {
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
