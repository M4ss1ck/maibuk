export interface SymbolEntry {
  glyph: string;
  /** Display name — localized for emoji, English Unicode name for characters. */
  label: string;
  /** "U+2014" for single code points; null for multi-codepoint emoji sequences. */
  code: string | null;
  /** Block name (characters) or emoji group name. */
  category: string;
  /** Pre-lowercased haystack: label + keywords. */
  search: string;
}

/** Shape of generated data/characters.json */
export interface CharactersData {
  blocks: string[];
  /** [codePoint, name, blockIndex] */
  chars: [number, string, number][];
  /** [startCp, endCp, blockIndex, namePrefix] — namePrefix "HANGUL" = algorithmic */
  ranges: [number, number, number, string][];
}

/** Shape of generated data/emoji.json */
export interface EmojiData {
  /** [english, spanish] group names */
  groups: [string, string][];
  /** [glyph, nameEn, nameEs, keywordsEn "|"-joined, keywordsEs "|"-joined, groupIndex] */
  emoji: [string, string, string, string, string, number][];
}
