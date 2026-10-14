import { describe, expect, it } from "vitest";
import {
  type Token,
  baseLanguage,
  breaksBetween,
  createAnalyzer,
  languageSupport,
  tokenize,
} from "./language";

describe("baseLanguage()", () => {
  it("keeps a bare subtag", () => {
    expect(baseLanguage("en")).toBe("en");
  });

  it("drops a region subtag", () => {
    expect(baseLanguage("en-US")).toBe("en");
  });

  it("lowercases and drops a region subtag separated by an underscore", () => {
    expect(baseLanguage("EN_gb")).toBe("en");
  });

  it("maps a regional tag to its base language", () => {
    expect(baseLanguage("es-MX")).toBe("es");
  });

  it("keeps the base subtag of an unsupported language", () => {
    expect(baseLanguage("fr")).toBe("fr");
  });

  it("returns an empty string for an empty tag", () => {
    expect(baseLanguage("")).toBe("");
  });
});

describe("languageSupport()", () => {
  it("reports full support for English", () => {
    expect(languageSupport("en")).toBe("full");
    expect(languageSupport("en-US")).toBe("full");
  });

  it("reports full support for Spanish", () => {
    expect(languageSupport("es")).toBe("full");
    expect(languageSupport("es-MX")).toBe("full");
  });

  it("reports limited support for an unsupported language", () => {
    expect(languageSupport("fr")).toBe("limited");
    expect(languageSupport("de")).toBe("limited");
    expect(languageSupport("")).toBe("limited");
  });
});

describe("tokenize()", () => {
  it("reports offsets whose slice is the word exactly as written", () => {
    const text = "The cat sat";
    const tokens = tokenize(text);
    expect(tokens.map((token) => text.slice(token.from, token.to))).toEqual(["The", "cat", "sat"]);
  });

  it("keeps a straight and a curly apostrophe inside a word", () => {
    const text = "don't it’s";
    const tokens = tokenize(text);
    expect(tokens.map((token) => text.slice(token.from, token.to))).toEqual(["don't", "it’s"]);
  });

  it("keeps accented letters and folds them as written", () => {
    const tokens = tokenize("canción sé");
    expect(tokens.map((token) => token.folded)).toEqual(["canción", "sé"]);
  });

  it("splits words on digits", () => {
    const text = "abc123def";
    const tokens = tokenize(text);
    expect(tokens.map((token) => text.slice(token.from, token.to))).toEqual(["abc", "def"]);
  });

  it("splits words on hyphens", () => {
    const text = "well-known";
    const tokens = tokenize(text);
    expect(tokens.map((token) => text.slice(token.from, token.to))).toEqual(["well", "known"]);
  });

  it("drops leading and trailing punctuation", () => {
    const text = '"(hello), world!"';
    const tokens = tokenize(text);
    expect(tokens.map((token) => text.slice(token.from, token.to))).toEqual(["hello", "world"]);
  });

  it("counts the letters in an accented word", () => {
    expect(tokenize("canción")[0]?.letters).toBe(7);
  });

  it("counts only letters, ignoring combining marks", () => {
    const text = "e\u0301";
    const tokens = tokenize(text);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.letters).toBe(1);
  });

  it("keeps accents when folding, so é and e stay apart", () => {
    const tokens = tokenize("Sé se");
    expect(tokens[0]?.folded).toBe("sé");
    expect(tokens[1]?.folded).toBe("se");
    expect(tokens[0]?.folded).not.toBe(tokens[1]?.folded);
  });

  it("normalizes a decomposed é to its composed form", () => {
    const text = "e\u0301";
    const tokens = tokenize(text);
    expect(tokens[0]?.folded).toBe("\u00e9");
  });
});

describe("createAnalyzer()", () => {
  it("treats a typographic apostrophe like the ASCII one, so the stop list matches", () => {
    const [token] = tokenize("didn’t");
    expect(createAnalyzer("en", { stemming: true }).isStopWord(token.folded)).toBe(true);
  });

  it("knows English stop words", () => {
    const analyzer = createAnalyzer("en", { stemming: true });
    expect(analyzer.isStopWord("the")).toBe(true);
    expect(analyzer.isStopWord("garden")).toBe(false);
  });

  it("knows Spanish stop words", () => {
    const analyzer = createAnalyzer("es", { stemming: true });
    expect(analyzer.isStopWord("de")).toBe(true);
    expect(analyzer.isStopWord("jardín")).toBe(false);
  });

  it("never treats a word as a stop word under limited support", () => {
    const analyzer = createAnalyzer("fr", { stemming: true });
    expect(analyzer.support).toBe("limited");
    expect(analyzer.isStopWord("the")).toBe(false);
    expect(analyzer.isStopWord("de")).toBe(false);
  });

  it("stems English words to one key when stemming is on", () => {
    const analyzer = createAnalyzer("en", { stemming: true });
    expect(analyzer.key("running")).toBe(analyzer.key("runs"));
  });

  it("uses the folded word as the key when stemming is off", () => {
    const analyzer = createAnalyzer("en", { stemming: false });
    expect(analyzer.key("running")).toBe("running");
  });

  it("stems Spanish words to one key when stemming is on", () => {
    const analyzer = createAnalyzer("es", { stemming: true });
    expect(analyzer.key("puertas")).toBe(analyzer.key("puerta"));
  });

  it("uses the folded word as the key under limited support", () => {
    const analyzer = createAnalyzer("fr", { stemming: true });
    expect(analyzer.key("running")).toBe("running");
  });
});

describe("breaksBetween()", () => {
  const text = "one. two\nthree—four five, six";
  const tokens = tokenize(text);

  function pair(a: number, b: number): [string, Token, Token] {
    const first = tokens[a];
    const second = tokens[b];
    if (first === undefined || second === undefined) {
      throw new Error(`missing token ${a} or ${b}`);
    }
    return [text, first, second];
  }

  it("breaks on a period followed by a space", () => {
    expect(breaksBetween(...pair(0, 1))).toBe(true);
  });

  it("breaks on a newline", () => {
    expect(breaksBetween(...pair(1, 2))).toBe(true);
  });

  it("breaks on an em dash", () => {
    expect(breaksBetween(...pair(2, 3))).toBe(true);
  });

  it("does not break on a single space", () => {
    expect(breaksBetween(...pair(3, 4))).toBe(false);
  });

  it("does not break on a comma", () => {
    expect(breaksBetween(...pair(4, 5))).toBe(false);
  });
});
