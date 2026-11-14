/**
 * A small TrueType reader that gives glyph advance widths for Map Label text
 * layout. It runs in the Worker, so it touches no DOM and imports nothing.
 *
 * It reads only four tables: `head` (units per em), `hhea` (ascender, descender,
 * numberOfHMetrics), `hmtx` (advance widths), and `cmap` (code point to glyph,
 * formats 4 and 12). It applies no kerning, so each glyph advances by its own
 * width. The Map Label layout uses it so the Frame, the SVG export and Place
 * share one line layout: all three measure the same advances in the same font
 * units, so a line breaks in the same place in each.
 *
 * Every multi-byte value in the file is big-endian, which is what `DataView`
 * reads by default. The reader works on a view of `bytes.buffer` that starts at
 * `bytes.byteOffset`, so a `Uint8Array` that is a slice of a larger buffer reads
 * the right bytes.
 */

export interface FontMetrics {
  /** Font units per em (head table, offset 18, uint16). */
  unitsPerEm: number;
  /** hhea ascender (offset 4, int16), in font units. */
  ascender: number;
  /** hhea descender (offset 6, int16, normally negative), in font units. */
  descender: number;
  /** The advance width, in font units, of the glyph `codePoint` maps to; glyph 0 (.notdef) when the cmap maps it to nothing. */
  advance(codePoint: number): number;
}

type GlyphLookup = (codePoint: number) => number;

const TABLE_DIRECTORY_COUNT_OFFSET = 4;
const TABLE_DIRECTORY_RECORDS_OFFSET = 12;
const TABLE_RECORD_SIZE = 16;
const CMAP_RECORDS_OFFSET = 4;
const CMAP_RECORD_SIZE = 8;
const UINT16_MAX = 0xffff;

/** The file offset of the table tagged `tag` in the table directory, or undefined when absent. */
function findTable(view: DataView, tag: string): number | undefined {
  const count = view.getUint16(TABLE_DIRECTORY_COUNT_OFFSET);
  for (let i = 0; i < count; i++) {
    const record = TABLE_DIRECTORY_RECORDS_OFFSET + i * TABLE_RECORD_SIZE;
    const recordTag = String.fromCharCode(
      view.getUint8(record),
      view.getUint8(record + 1),
      view.getUint8(record + 2),
      view.getUint8(record + 3)
    );
    if (recordTag === tag) {
      return view.getUint32(record + 8);
    }
  }
  return undefined;
}

function requireTable(view: DataView, tag: string): number {
  const offset = findTable(view, tag);
  if (offset === undefined) {
    throw new Error(`ttf: missing ${tag} table`);
  }
  return offset;
}

/**
 * The cmap subtable offset (from the start of the file) for the first record
 * that matches `accepts` and carries `format`, in record order.
 */
function findSubtable(
  view: DataView,
  cmapOffset: number,
  accepts: (platformId: number, encodingId: number) => boolean,
  format: number
): number | undefined {
  const count = view.getUint16(cmapOffset + 2);
  for (let i = 0; i < count; i++) {
    const record = cmapOffset + CMAP_RECORDS_OFFSET + i * CMAP_RECORD_SIZE;
    const platformId = view.getUint16(record);
    const encodingId = view.getUint16(record + 2);
    if (!accepts(platformId, encodingId)) {
      continue;
    }
    const subtable = cmapOffset + view.getUint32(record + 4);
    if (view.getUint16(subtable) === format) {
      return subtable;
    }
  }
  return undefined;
}

/**
 * Format 4 (segment mapping to delta values, BMP only). Segments are sorted by
 * endCode, so the first segment whose endCode reaches the code point is the
 * only candidate.
 */
function glyphFormat4(view: DataView, subtable: number, codePoint: number): number {
  if (codePoint > UINT16_MAX) {
    return 0;
  }
  const segCountX2 = view.getUint16(subtable + 6);
  const segCount = segCountX2 >> 1;
  const endCodeBase = subtable + 14;
  const startCodeBase = endCodeBase + segCountX2 + 2; // +2 skips reservedPad
  const idDeltaBase = startCodeBase + segCountX2;
  const idRangeOffsetBase = idDeltaBase + segCountX2;

  let low = 0;
  let high = segCount - 1;
  let segment = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (view.getUint16(endCodeBase + 2 * mid) >= codePoint) {
      segment = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }
  if (segment < 0) {
    return 0;
  }

  const startCode = view.getUint16(startCodeBase + 2 * segment);
  if (codePoint < startCode) {
    return 0;
  }
  const idDelta = view.getInt16(idDeltaBase + 2 * segment);
  const idRangeOffset = view.getUint16(idRangeOffsetBase + 2 * segment);
  if (idRangeOffset === 0) {
    return (codePoint + idDelta) & UINT16_MAX;
  }
  // The offset is relative to the idRangeOffset entry that holds it.
  const glyphAddress =
    idRangeOffsetBase + 2 * segment + idRangeOffset + 2 * (codePoint - startCode);
  const glyph = view.getUint16(glyphAddress);
  return glyph === 0 ? 0 : (glyph + idDelta) & UINT16_MAX;
}

/**
 * Format 12 (segmented coverage, full Unicode). Groups are sorted by
 * startCharCode and do not overlap, so a binary search finds the one group that
 * could hold the code point.
 */
function glyphFormat12(view: DataView, subtable: number, codePoint: number): number {
  const numGroups = view.getUint32(subtable + 12);
  const groupsBase = subtable + 16;
  const GROUP_SIZE = 12;

  let low = 0;
  let high = numGroups - 1;
  let group = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (view.getUint32(groupsBase + mid * GROUP_SIZE + 4) >= codePoint) {
      group = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }
  if (group < 0) {
    return 0;
  }

  const record = groupsBase + group * GROUP_SIZE;
  const startCharCode = view.getUint32(record);
  if (codePoint < startCharCode) {
    return 0;
  }
  return view.getUint32(record + 8) + (codePoint - startCharCode);
}

/**
 * Picks the subtable in the order the Map Label layout prefers: format 12 on
 * (3,10) or platform 0, then format 4 on (3,1) or platform 0.
 */
function cmapLookup(view: DataView, cmapOffset: number): GlyphLookup {
  const isFullUnicode = (platformId: number, encodingId: number) =>
    (platformId === 3 && encodingId === 10) || platformId === 0;
  const isBmpUnicode = (platformId: number, encodingId: number) =>
    (platformId === 3 && encodingId === 1) || platformId === 0;

  const format12 = findSubtable(view, cmapOffset, isFullUnicode, 12);
  if (format12 !== undefined) {
    return (codePoint) => glyphFormat12(view, format12, codePoint);
  }
  const format4 = findSubtable(view, cmapOffset, isBmpUnicode, 4);
  if (format4 !== undefined) {
    return (codePoint) => glyphFormat4(view, format4, codePoint);
  }
  throw new Error("ttf: no usable cmap");
}

export function readFontMetrics(bytes: Uint8Array): FontMetrics {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const headOffset = requireTable(view, "head");
  const hheaOffset = requireTable(view, "hhea");
  const hmtxOffset = requireTable(view, "hmtx");
  const cmapOffset = requireTable(view, "cmap");

  const unitsPerEm = view.getUint16(headOffset + 18);
  const ascender = view.getInt16(hheaOffset + 4);
  const descender = view.getInt16(hheaOffset + 6);
  const numberOfHMetrics = view.getUint16(hheaOffset + 34);
  const lookup = cmapLookup(view, cmapOffset);

  // Glyphs past numberOfHMetrics share the last record's advance width.
  const advanceOfGlyph = (glyphId: number): number => {
    if (numberOfHMetrics === 0) {
      return 0;
    }
    const record = Math.min(glyphId, numberOfHMetrics - 1);
    return view.getUint16(hmtxOffset + record * 4);
  };

  const memo = new Map<number, number>();
  return {
    unitsPerEm,
    ascender,
    descender,
    advance(codePoint: number): number {
      const cached = memo.get(codePoint);
      if (cached !== undefined) {
        return cached;
      }
      const width = advanceOfGlyph(lookup(codePoint));
      memo.set(codePoint, width);
      return width;
    },
  };
}
