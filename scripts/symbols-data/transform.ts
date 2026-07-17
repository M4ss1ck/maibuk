import type { CharactersData, EmojiData } from "../../src/features/symbols/types";

export interface UcdCharInput {
  cp: number;
  name: string;
  category: string;
}
export interface UcdRangeInput {
  start: number;
  end: number;
  rangeLabel: string;
}
export interface UcdBlockInput {
  start: number;
  end: number;
  name: string;
}
export interface EmojiInput {
  glyph: string;
  nameEn: string;
  nameEs: string;
  keywordsEn: string[];
  keywordsEs: string[];
  group: number;
}

const EXCLUDED_CATEGORIES = new Set(["Cc", "Cs", "Co", "Cn"]);

const RANGE_PREFIXES: [pattern: RegExp, prefix: string][] = [
  [/^CJK Ideograph/, "CJK UNIFIED IDEOGRAPH"],
  [/^Hangul Syllable/, "HANGUL"],
  [/^Tangut Ideograph/, "TANGUT IDEOGRAPH"],
];

export function buildCharactersData(
  chars: UcdCharInput[],
  ranges: UcdRangeInput[],
  blocks: UcdBlockInput[],
  emojiCodePoints: Set<number>
): CharactersData {
  const blockNames = blocks.map((b) => b.name);
  const blockIndexOf = (cp: number) => blocks.findIndex((b) => cp >= b.start && cp <= b.end);

  const packedChars: CharactersData["chars"] = [];
  for (const c of chars) {
    if (EXCLUDED_CATEGORIES.has(c.category)) continue;
    if (emojiCodePoints.has(c.cp)) continue;
    const block = blockIndexOf(c.cp);
    if (block === -1) continue;
    packedChars.push([c.cp, c.name, block]);
  }

  const packedRanges: CharactersData["ranges"] = [];
  for (const r of ranges) {
    const match = RANGE_PREFIXES.find(([pattern]) => pattern.test(r.rangeLabel));
    if (!match) continue;
    packedRanges.push([r.start, r.end, blockIndexOf(r.start), match[1]]);
  }

  return { blocks: blockNames, chars: packedChars, ranges: packedRanges };
}

export function buildEmojiData(emoji: EmojiInput[], groups: [string, string][]): EmojiData {
  return {
    groups,
    emoji: emoji.map((e) => [
      e.glyph,
      e.nameEn,
      e.nameEs,
      e.keywordsEn.join("|"),
      e.keywordsEs.join("|"),
      e.group,
    ]),
  };
}
