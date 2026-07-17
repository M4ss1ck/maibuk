import { formatCodePoint, rangeCharName } from "./names";
import type { CharactersData, EmojiData, SymbolEntry } from "./types";

export interface SymbolsCatalog {
  categories: string[];
  entries: SymbolEntry[];
  rangesByCategory: ReadonlyMap<string, [number, number, string][]>;
}

const cache = new Map<string, Promise<SymbolsCatalog>>();
const emojiCache = new Map<string, Promise<SymbolEntry[]>>();

export function loadEmojiSymbols(locale: string): Promise<SymbolEntry[]> {
  const key = locale.startsWith("es") ? "es" : "en";
  let promise = emojiCache.get(key);
  if (!promise) {
    promise = buildEmojiSymbols(key);
    emojiCache.set(key, promise);
  }
  return promise;
}

export function loadSymbolsCatalog(locale: string): Promise<SymbolsCatalog> {
  const key = locale.startsWith("es") ? "es" : "en";
  let promise = cache.get(key);
  if (!promise) {
    promise = buildCatalog(key);
    cache.set(key, promise);
  }
  return promise;
}

async function buildCatalog(locale: "en" | "es"): Promise<SymbolsCatalog> {
  const [charsModule, emojiEntries] = await Promise.all([
    import("./data/characters.json"),
    loadEmojiSymbols(locale),
  ]);
  const charsData = charsModule.default as unknown as CharactersData;
  const entries = [...emojiEntries];
  const emojiGroupNames = [...new Set(emojiEntries.map((entry) => entry.category))];

  const blocksWithChars = new Set<number>();
  for (const [cp, name, block] of charsData.chars) {
    blocksWithChars.add(block);
    entries.push({
      glyph: String.fromCodePoint(cp),
      label: name,
      code: formatCodePoint(cp),
      category: charsData.blocks[block],
      search: name.toLowerCase(),
    });
  }

  const rangesByCategory = new Map<string, [number, number, string][]>();
  for (const [start, end, block, prefix] of charsData.ranges) {
    const category = charsData.blocks[block];
    if (!category) continue;
    blocksWithChars.add(block);
    const list = rangesByCategory.get(category) ?? [];
    list.push([start, end, prefix]);
    rangesByCategory.set(category, list);
  }

  const categories = [
    ...emojiGroupNames,
    ...charsData.blocks.filter((_, index) => blocksWithChars.has(index)),
  ];

  return { categories, entries, rangesByCategory };
}

async function buildEmojiSymbols(locale: "en" | "es"): Promise<SymbolEntry[]> {
  const emojiModule = await import("./data/emoji.json");
  const emojiData = emojiModule.default as unknown as EmojiData;
  const groupNames = emojiData.groups.map(([en, es]) => (locale === "es" ? es : en));

  return emojiData.emoji.map(([glyph, nameEn, nameEs, kwEn, kwEs, group]) => {
    const label = locale === "es" ? nameEs : nameEn;
    return {
      glyph,
      label,
      code: [...glyph].length === 1 ? formatCodePoint(glyph.codePointAt(0) as number) : null,
      category: groupNames[group],
      search: `${label}|${nameEn}|${nameEs}|${kwEn}|${kwEs}`.toLowerCase(),
    };
  });
}

export function entriesForCategory(
  catalog: SymbolsCatalog,
  category: string | null
): SymbolEntry[] {
  if (category === null) return catalog.entries;
  const named = catalog.entries.filter((e) => e.category === category);
  const ranges = catalog.rangesByCategory.get(category);
  if (!ranges) return named;
  const expanded: SymbolEntry[] = [];
  for (const [start, end, prefix] of ranges) {
    for (let cp = start; cp <= end; cp++) {
      const label = rangeCharName(cp, prefix);
      expanded.push({
        glyph: String.fromCodePoint(cp),
        label,
        code: formatCodePoint(cp),
        category,
        search: label.toLowerCase(),
      });
    }
  }
  return [...expanded, ...named];
}

export function lookupByCodePoint(catalog: SymbolsCatalog, cp: number): SymbolEntry | null {
  const code = formatCodePoint(cp);
  const named = catalog.entries.find((e) => e.code === code);
  if (named) return named;
  for (const [category, ranges] of catalog.rangesByCategory) {
    for (const [start, end, prefix] of ranges) {
      if (cp >= start && cp <= end) {
        const label = rangeCharName(cp, prefix);
        return {
          glyph: String.fromCodePoint(cp),
          label,
          code,
          category,
          search: label.toLowerCase(),
        };
      }
    }
  }
  return null;
}
