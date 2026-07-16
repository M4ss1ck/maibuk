// Regenerate: pnpm generate:symbols  (after bumping ucd-full / emojibase-data)
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import {
  buildCharactersData,
  buildEmojiData,
  type EmojiInput,
  type UcdBlockInput,
  type UcdCharInput,
  type UcdRangeInput,
} from "./symbols-data/transform";

const require = createRequire(import.meta.url);
const OUT_DIR = join(import.meta.dirname, "../src/features/symbols/data");

// --- UCD adapters (field names verified against ucd-full 17.x in Task 4 Step 6) ---
const unicodeData: { codepoint: string; name: string; category: string }[] =
  require("ucd-full/UnicodeData.json").UnicodeData;
const blocksData: { range: string[]; block: string }[] = require("ucd-full/Blocks.json").Blocks;

const chars: UcdCharInput[] = [];
const ranges: UcdRangeInput[] = [];
for (let i = 0; i < unicodeData.length; i++) {
  const row = unicodeData[i];
  const cp = Number.parseInt(row.codepoint, 16);
  const firstMatch = row.name.match(/^<(.+), First>$/);
  if (firstMatch) {
    const last = unicodeData[i + 1];
    ranges.push({ start: cp, end: Number.parseInt(last.codepoint, 16), rangeLabel: firstMatch[1] });
    i++; // skip the paired "<..., Last>" row
    continue;
  }
  if (row.name.startsWith("<")) continue; // e.g. "<control>"
  chars.push({ cp, name: row.name, category: row.category });
}

const blocks: UcdBlockInput[] = blocksData.map((b) => ({
  start: Number.parseInt(b.range[0], 16),
  end: Number.parseInt(b.range[1], 16),
  name: b.block,
}));

// --- emojibase adapters ---
type EmojibaseEntry = {
  emoji: string;
  label: string;
  tags?: string[];
  group?: number;
  skins?: EmojibaseEntry[];
};
const emojiEn: EmojibaseEntry[] = require("emojibase-data/en/data.json");
const emojiEs: EmojibaseEntry[] = require("emojibase-data/es/data.json");
type Messages = { groups: { key: string; order: number; message: string }[] };
const messagesEn: Messages = require("emojibase-data/en/messages.json");
const messagesEs: Messages = require("emojibase-data/es/messages.json");

const esByGlyph = new Map<string, EmojibaseEntry>();
for (const e of emojiEs) {
  esByGlyph.set(e.emoji, e);
  for (const skin of e.skins ?? []) esByGlyph.set(skin.emoji, skin);
}

const groups: [string, string][] = messagesEn.groups.map((g) => {
  const es = messagesEs.groups.find((m) => m.key === g.key);
  return [g.message, es?.message ?? g.message];
});

const emojiInputs: EmojiInput[] = [];
const addEmoji = (entry: EmojibaseEntry, group: number) => {
  const es = esByGlyph.get(entry.emoji);
  emojiInputs.push({
    glyph: entry.emoji,
    nameEn: entry.label,
    nameEs: es?.label ?? entry.label,
    keywordsEn: entry.tags ?? [],
    keywordsEs: es?.tags ?? [],
    group,
  });
};
for (const entry of emojiEn) {
  if (entry.group === undefined) continue; // skip components (skin-tone swatches etc.)
  addEmoji(entry, entry.group);
  for (const skin of entry.skins ?? []) addEmoji(skin, entry.group); // skins flattened into the grid
}

// Single-code-point emoji are excluded from characters.json (they live here instead).
const emojiCodePoints = new Set<number>();
for (const e of emojiInputs) {
  if ([...e.glyph].length === 1) emojiCodePoints.add(e.glyph.codePointAt(0) as number);
}

const charactersData = buildCharactersData(chars, ranges, blocks, emojiCodePoints);
const emojiData = buildEmojiData(emojiInputs, groups);

// --- Invariant checks: fail loudly if an adapter drifted from the package shape ---
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`generate-symbols-data invariant failed: ${msg}`);
}
assert(
  charactersData.chars.some(([cp, name]) => cp === 0x2014 && name === "EM DASH"),
  "EM DASH missing"
);
assert(charactersData.blocks.includes("General Punctuation"), "blocks missing General Punctuation");
assert(
  charactersData.ranges.some(([start]) => start === 0xac00),
  "Hangul range missing"
);
assert(charactersData.chars.length > 20000, `too few chars: ${charactersData.chars.length}`);
assert(emojiData.emoji.length > 3000, `too few emoji: ${emojiData.emoji.length}`);
assert(
  emojiData.emoji.some(
    ([glyph, , nameEs]) => glyph === "😀" && nameEs.toLowerCase().includes("cara")
  ),
  "Spanish emoji names missing"
);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "characters.json"), JSON.stringify(charactersData));
writeFileSync(join(OUT_DIR, "emoji.json"), JSON.stringify(emojiData));
console.log(
  `characters: ${charactersData.chars.length} chars, ${charactersData.ranges.length} ranges, ${charactersData.blocks.length} blocks; emoji: ${emojiData.emoji.length} in ${emojiData.groups.length} groups`
);
