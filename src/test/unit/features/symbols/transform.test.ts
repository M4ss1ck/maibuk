import { describe, expect, it } from "vitest";
import { buildCharactersData, buildEmojiData } from "../../../../../scripts/symbols-data/transform";

const blocks = [
  { start: 0x2000, end: 0x206f, name: "General Punctuation" },
  { start: 0x4e00, end: 0x9fff, name: "CJK Unified Ideographs" },
];

describe("buildCharactersData", () => {
  it("packs named chars as [cp, name, blockIndex]", () => {
    const data = buildCharactersData(
      [{ cp: 0x2014, name: "EM DASH", category: "Pd" }],
      [],
      blocks,
      new Set()
    );
    expect(data.blocks).toEqual(["General Punctuation", "CJK Unified Ideographs"]);
    expect(data.chars).toEqual([[0x2014, "EM DASH", 0]]);
  });

  it("excludes control, surrogate, and private-use categories", () => {
    const data = buildCharactersData(
      [
        { cp: 0x0007, name: "<control>", category: "Cc" },
        { cp: 0xd800, name: "X", category: "Cs" },
        { cp: 0xe000, name: "X", category: "Co" },
      ],
      [],
      blocks,
      new Set()
    );
    expect(data.chars).toEqual([]);
  });

  it("excludes code points that live in the emoji dataset", () => {
    const data = buildCharactersData(
      [{ cp: 0x2014, name: "EM DASH", category: "Pd" }],
      [],
      blocks,
      new Set([0x2014])
    );
    expect(data.chars).toEqual([]);
  });

  it("maps UCD range labels to name-prefix ranges", () => {
    const data = buildCharactersData(
      [],
      [
        { start: 0x4e00, end: 0x9fff, rangeLabel: "CJK Ideograph" },
        { start: 0xac00, end: 0xd7a3, rangeLabel: "Hangul Syllable" },
        { start: 0xe000, end: 0xf8ff, rangeLabel: "Private Use" },
      ],
      blocks,
      new Set()
    );
    expect(data.ranges).toEqual([
      [0x4e00, 0x9fff, 1, "CJK UNIFIED IDEOGRAPH"],
      [0xac00, 0xd7a3, -1, "HANGUL"],
    ]);
  });
});

describe("buildEmojiData", () => {
  it("packs emoji with joined keywords", () => {
    const data = buildEmojiData(
      [
        {
          glyph: "😀",
          nameEn: "grinning face",
          nameEs: "cara sonriendo",
          keywordsEn: ["grin", "smile"],
          keywordsEs: ["sonrisa"],
          group: 0,
        },
      ],
      [["Smileys & Emotion", "Sonrisas y emociones"]]
    );
    expect(data.groups).toEqual([["Smileys & Emotion", "Sonrisas y emociones"]]);
    expect(data.emoji).toEqual([
      ["😀", "grinning face", "cara sonriendo", "grin|smile", "sonrisa", 0],
    ]);
  });
});
