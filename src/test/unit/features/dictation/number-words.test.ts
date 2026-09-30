import { describe, expect, it } from "vitest";
import { parseNumberWords, type ParsedNumber } from "@/features/dictation/number-words";

type Case = [words: string[], expected: ParsedNumber | null];

const EN_CASES: Case[] = [
  [[], null],
  [["bread"], null],
  [["zero"], { value: 0, length: 1 }],
  [["seven"], { value: 7, length: 1 }],
  [["nineteen"], { value: 19, length: 1 }],
  [["twenty", "one"], { value: 21, length: 2 }],
  [["one", "hundred"], { value: 100, length: 2 }],
  [["one", "hundred", "and", "five"], { value: 105, length: 4 }],
  [["one", "hundred", "five"], { value: 105, length: 3 }],
  [["one", "hundred", "and"], { value: 100, length: 2 }],
  [["one", "thousand"], { value: 1000, length: 2 }],
  [["one", "million"], { value: 1000000, length: 2 }],
  [["twelve", "thousand", "three", "hundred", "and", "forty", "five"], { value: 12345, length: 7 }],
  [
    [
      "nine",
      "hundred",
      "ninety",
      "nine",
      "million",
      "nine",
      "hundred",
      "ninety",
      "nine",
      "thousand",
      "nine",
      "hundred",
      "ninety",
      "nine",
    ],
    { value: 999999999, length: 14 },
  ],
  [["twenty", "twenty"], { value: 20, length: 1 }],
  [["three", "apples"], { value: 3, length: 1 }],
  [["and", "one"], null],
  [["one", "billion"], { value: 1, length: 1 }],
  // Own cases: connectors and scale boundaries.
  [["one", "hundred", "and", "bread"], { value: 100, length: 2 }],
  [["two", "thousand", "and"], { value: 2000, length: 2 }],
  [["two", "thousand", "and", "five"], { value: 2005, length: 4 }],
  [["one", "million", "and", "one"], { value: 1000001, length: 4 }],
  [["ten"], { value: 10, length: 1 }],
  [["forty", "two"], { value: 42, length: 2 }],
  [["twenty", "hundred"], { value: 20, length: 1 }],
  [["zero", "one"], { value: 0, length: 1 }],
  [["hundred"], null],
  [["thousand"], null],
  [["million"], null],
  [["five", "million", "bread"], { value: 5000000, length: 2 }],
];

const ES_CASES: Case[] = [
  [["cero"], { value: 0, length: 1 }],
  [["veintiun"], { value: 21, length: 1 }],
  [["veintiuno"], { value: 21, length: 1 }],
  [["treinta", "y", "uno"], { value: 31, length: 3 }],
  [["treinta", "y", "pan"], { value: 30, length: 1 }],
  [["cien"], { value: 100, length: 1 }],
  [["ciento", "cinco"], { value: 105, length: 2 }],
  [["doscientos"], { value: 200, length: 1 }],
  [["quinientas", "dos"], { value: 502, length: 2 }],
  [["mil"], { value: 1000, length: 1 }],
  [["dos", "mil"], { value: 2000, length: 2 }],
  [["un", "millon"], { value: 1000000, length: 2 }],
  [["dos", "millones"], { value: 2000000, length: 2 }],
  [["un", "millon", "doscientos", "mil"], { value: 1200000, length: 4 }],
  [["veintiun", "mil"], { value: 21000, length: 2 }],
  [["cien", "mil"], { value: 100000, length: 2 }],
  [
    [
      "novecientos",
      "noventa",
      "y",
      "nueve",
      "millones",
      "novecientos",
      "noventa",
      "y",
      "nueve",
      "mil",
      "novecientos",
      "noventa",
      "y",
      "nueve",
    ],
    { value: 999999999, length: 14 },
  ],
  [["dos", "tres"], { value: 2, length: 1 }],
  [["un", "mil"], { value: 1, length: 1 }],
  [["mil", "millones"], { value: 1000, length: 1 }],
  [["ciento"], null],
  [["pan"], null],
  // Own cases: connectors and scale boundaries.
  [["cero", "uno"], { value: 0, length: 1 }],
  [["treinta", "y"], { value: 30, length: 1 }],
  [["y", "uno"], null],
  [["diez"], { value: 10, length: 1 }],
  [["dieciseis"], { value: 16, length: 1 }],
  [["veintidos"], { value: 22, length: 1 }],
  [["cuarenta", "y", "dos"], { value: 42, length: 3 }],
  [["veinte", "y", "uno"], { value: 20, length: 1 }],
  [["cien", "cinco"], { value: 100, length: 1 }],
  [["ciento", "mil"], null],
  [["uno", "mil"], { value: 1, length: 1 }],
  [["uno", "millon"], { value: 1000000, length: 2 }],
  [["una", "millon"], { value: 1, length: 1 }],
  [["dos", "millon"], { value: 2, length: 1 }],
  [["un", "millones"], { value: 1, length: 1 }],
  [["millon"], null],
  [["mil", "mil"], { value: 1000, length: 1 }],
  [["dos", "millones", "tres"], { value: 2000003, length: 3 }],
  [["quinientos"], { value: 500, length: 1 }],
  [["setecientas", "treinta", "y", "tres"], { value: 733, length: 4 }],
];

describe("parseNumberWords() en", () => {
  it.each(EN_CASES)("%s -> %s", (words, expected) => {
    expect(parseNumberWords(words, "en")).toEqual(expected);
  });
});

describe("parseNumberWords() es", () => {
  it.each(ES_CASES)("%s -> %s", (words, expected) => {
    expect(parseNumberWords(words, "es")).toEqual(expected);
  });
});
