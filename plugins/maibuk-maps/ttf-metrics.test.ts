import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readFontMetrics } from "./ttf-metrics";

const FONT_NAMES = [
  "IMFeENrm28P.ttf",
  "Cinzel-wght.ttf",
  "UncialAntiqua-Regular.ttf",
  "MedievalSharp.ttf",
] as const;

/**
 * The bundled face's bytes, copied so the view starts at byteOffset 0. Resolved
 * from `__dirname` like the other Maps tests: under this vitest environment
 * `new URL(rel, import.meta.url)` resolves against `http://localhost:3000`.
 */
function loadFont(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(__dirname, "assets/ui/fonts", name)));
}

describe.each(FONT_NAMES)("ttf metrics: %s", (name) => {
  const bytes = loadFont(name);

  it("parses the head and hhea metrics", () => {
    const font = readFontMetrics(bytes);
    expect(Number.isInteger(font.unitsPerEm)).toBe(true);
    expect(font.unitsPerEm).toBeGreaterThan(0);
    expect(font.ascender).toBeGreaterThan(0);
    expect(font.descender).toBeLessThan(0);
  });

  it("gives positive advances for A and space, below two em, with W wider than i", () => {
    const font = readFontMetrics(bytes);
    const limit = 2 * font.unitsPerEm;
    for (const codePoint of [0x41, 0x20]) {
      const width = font.advance(codePoint);
      expect(width).toBeGreaterThan(0);
      expect(width).toBeLessThan(limit);
    }
    expect(font.advance(0x57)).toBeGreaterThan(font.advance(0x69));
  });

  it("gives every unmapped code point the same advance as glyph 0", () => {
    const font = readFontMetrics(bytes);
    expect(font.advance(0x10fffd)).toBe(font.advance(0x10fffe));
  });

  it("reads through a Uint8Array view with a non-zero byteOffset", () => {
    const buffer = new Uint8Array(bytes.length + 7 + 3);
    buffer.set(bytes, 7);
    const view = buffer.subarray(7, 7 + bytes.length);
    expect(view.byteOffset).toBe(7);
    expect(readFontMetrics(view).advance(0x41)).toBe(readFontMetrics(bytes).advance(0x41));
  });

  it("returns the same advance from the memo on a second call", () => {
    const font = readFontMetrics(bytes);
    expect(font.advance(0x41)).toBe(font.advance(0x41));
  });
});

/**
 * A minimal font with a format 12 cmap, since none of the bundled faces has one.
 * Advances are 100 + 10 * glyphId for the eight hmtx records. U+0041..U+0043 map
 * to glyphs 5..7, and U+1F600..U+1F601 map to glyph 20, past numberOfHMetrics.
 */
function syntheticFormat12Font(): Uint8Array {
  const numHMetrics = 8;
  const groups: [number, number, number][] = [
    [0x41, 0x43, 5],
    [0x1f600, 0x1f601, 20],
  ];
  const headOffset = 76; // 12-byte directory header + 4 records of 16 bytes
  const hheaOffset = headOffset + 54;
  const hmtxOffset = hheaOffset + 36;
  const cmapOffset = hmtxOffset + 4 * numHMetrics;
  const cmapLength = 12 + 16 + 12 * groups.length;
  const bytes = new Uint8Array(cmapOffset + cmapLength);
  const view = new DataView(bytes.buffer);

  view.setUint32(0, 0x00010000);
  view.setUint16(4, 4);
  const tables: [string, number, number][] = [
    ["cmap", cmapOffset, cmapLength],
    ["head", headOffset, 54],
    ["hhea", hheaOffset, 36],
    ["hmtx", hmtxOffset, 4 * numHMetrics],
  ];
  tables.forEach(([tag, offset, length], i) => {
    const record = 12 + 16 * i;
    for (let k = 0; k < 4; k++) {
      bytes[record + k] = tag.charCodeAt(k);
    }
    view.setUint32(record + 8, offset);
    view.setUint32(record + 12, length);
  });

  view.setUint16(headOffset + 18, 1000);
  view.setInt16(hheaOffset + 4, 800);
  view.setInt16(hheaOffset + 6, -200);
  view.setUint16(hheaOffset + 34, numHMetrics);
  for (let glyph = 0; glyph < numHMetrics; glyph++) {
    view.setUint16(hmtxOffset + 4 * glyph, 100 + 10 * glyph);
  }

  view.setUint16(cmapOffset, 0);
  view.setUint16(cmapOffset + 2, 1);
  view.setUint16(cmapOffset + 4, 3);
  view.setUint16(cmapOffset + 6, 10);
  view.setUint32(cmapOffset + 8, 12);
  const subtable = cmapOffset + 12;
  view.setUint16(subtable, 12);
  view.setUint32(subtable + 12, groups.length);
  groups.forEach(([start, end, glyph], i) => {
    const record = subtable + 16 + 12 * i;
    view.setUint32(record, start);
    view.setUint32(record + 4, end);
    view.setUint32(record + 8, glyph);
  });
  return bytes;
}

describe("ttf metrics: format 12 cmap", () => {
  it("maps supplementary-plane groups and uses the last hmtx record past numberOfHMetrics", () => {
    const font = readFontMetrics(syntheticFormat12Font());
    expect(font.unitsPerEm).toBe(1000);
    expect(font.ascender).toBe(800);
    expect(font.descender).toBe(-200);
    expect(font.advance(0x41)).toBe(150);
    expect(font.advance(0x43)).toBe(170);
    expect(font.advance(0x1f600)).toBe(170); // glyph 20: the last record, glyph 7
    expect(font.advance(0x1f601)).toBe(170);
  });

  it("gives code points outside every group the advance of glyph 0", () => {
    const font = readFontMetrics(syntheticFormat12Font());
    expect(font.advance(0x40)).toBe(100);
    expect(font.advance(0x44)).toBe(100);
    expect(font.advance(0x1f602)).toBe(100);
  });
});

describe("ttf metrics: malformed input", () => {
  it("throws when the table directory is empty", () => {
    expect(() => readFontMetrics(new Uint8Array(12))).toThrow("ttf: missing head table");
  });
});
