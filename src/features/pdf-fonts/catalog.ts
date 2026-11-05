// The two families the PDF exporter can embed are pinned to upstream commits
// and never mirrored. Re-pinning a file is an edit here; an old copy on a
// device then reads as not installed.
//
// `coverage` is the intersection of the fontkit `characterSet` over every file
// of that font (all four Latin styles, both CJK styles), so a listed code point
// exists in every style the exporter may ask for. Re-pinning a file must
// regenerate these ranges.
import { builtInFontsCanRender } from "@/features/export/pdf-text-support";
import type { PdfFont, PdfFontId, PdfFontPlan } from "@/features/pdf-fonts/types";
import type { PinnedFile } from "@/lib/verified-download";

export const LATIN_FONT_COMMIT = "a5fca98891563057e7f65c1c4bf3f2a58c7704a4";
export const CJK_FONT_COMMIT = "f8d157532fbfaeda587e826d4cd5b21a49186f7c";

const LATIN_COVERAGE =
  "0,d,20-7e,a0-377,37a-37f,384-38a,38c,38e-3a1,3a3-3e1,3f0-52f,1ab0-1ac0,1ac5,1ac7-1ace,1c80-1c88,1d00-1df9,1dfb-1f15,1f18-1f1d,1f20-1f45,1f48-1f4d,1f50-1f57,1f59,1f5b,1f5d,1f5f-1f7d,1f80-1fb4,1fb6-1fc4,1fc6-1fd3,1fd6-1fdb,1fdd-1fef,1ff2-1ff4,1ff6-1ffe,2000-2064,2066-2071,2074-208e,2090-209c,20a0-20bf,20f0,2100-215f,2184,2189,2212,25cc,2c60-2c7f,2de0-2e5d,a640-a69f,a700-a7ca,a7d0-a7d1,a7d3,a7d5-a7d9,a7f2-a7ff,a92e,ab30-ab6b,fb00-fb06,fe00,fe20-fe2f,feff,fffc-fffd,10780-10785,10787-107b0,107b2-107ba,1df00-1df1e";
const CJK_COVERAGE =
  "20-7e,a0-103,110-113,11a-11b,128-12b,143-144,147-148,14c-14f,152-153,168-16d,192,1a0-1a1,1af-1b0,1cd-1dc,1f8-1f9,251,261,2bb,2c7,2c9-2cb,2d9,2ea-2eb,300-301,304,307,30c,391-3a1,3a3-3a9,3b1-3c9,401,410-44f,451,1e3e-1e3f,1ea0-1ef9,2002-2003,2010-2016,2018-201a,201c-201e,2020-2022,2025-2027,2030,2032-2033,2035,2039-203c,2042,2047-2049,2051,2074,20a9,20ab-20ac,20dd-20de,2100,2103,2105,2109-210a,210f,2113,2116,2121-2122,2126-2127,212b,212e,2135,213b,2160-216b,2170-217b,2190-2199,21b8-21b9,21c4-21c6,21cb-21cc,21d0,21d2,21d4,21e6-21e9,21f5,2200,2202-2203,2205-220b,220f,2211-2213,2215,221a,221d-2220,2223,2225-222e,2234-2237,223d,2243,2245,2248,224c,2260-2262,2264-2267,226a-226b,226e-226f,2272-2273,2276-2277,2282-2287,228a-228b,2295-2299,22a0,22a5,22bf,22da-22db,22ef,2305-2307,2312,2318,2329-232a,23b0-23b1,23be-23cc,23ce,23da-23db,2423,2460-25ab,25b1-25b3,25b6-25b7,25bc-25bd,25c0-25c1,25c6-25c7,25c9-25cc,25ce-25d3,25e2-25e6,25ef,2600-2603,2605-2606,2609,260e-260f,2616-2617,261c-261f,262f,2640-2642,2660-266f,2672-267d,26a0,26bd-26be,2702,2713,271a,273d,273f-2740,2756,2776-2793,27a1,2934-2935,29bf,29fa-29fb,2b05-2b07,2b1a,2b95,2e3a-2e3b,2e80-2e99,2e9b-2ef3,2f00-2fd5,2ff0-2ffb,3000-303f,3041-3096,3099-30ff,3105-312f,3131-3163,3165-318e,3190-31bb,31c0-31e3,31f0-321e,3220-332b,332d-4dbf,4e00-9fff,f901-f903,f905-f906,f90a-f90c,f915-f91a,f91d-f91f,f92c-f92d,f92f,f931-f935,f937,f939-f93a,f943,f947-f948,f94a,f94e,f952-f953,f95e,f962-f968,f96e,f972-f974,f976,f979-f97b,f97e-f980,f984-f985,f98a-f98c,f98e,f991,f993,f995,f998,f99b-f99c,f99e-f99f,f9a5,f9ae,f9b5,f9b7-f9b8,f9ba-f9bb,f9bd-f9be,f9c0,f9c5-f9c6,f9d0,f9d8-f9da,f9dc-f9e4,f9e7,f9e9,f9f1,f9f4-f9f5,f9fa-f9fb,f9fd,f9ff,fa02,fa05-fa08,fa0a,fa0c-fa0f,fa11,fa13-fa14,fa18,fa1f-fa21,fa23-fa24,fa27-fa29,fa2f,fa33-fa35,fa37-fa38,fa3a,fa47,fa49,fa4b,fa5c-fa5e,fb00-fb04,fe10-fe19,fe30-fe52,fe54-fe66,fe68-fe6b,ff01-ff9f,ffa1-ffbe,ffc2-ffc7,ffca-ffcf,ffd2-ffd7,ffda-ffdc,ffe0-ffe6,ffe8-ffee,1f100-1f10c,1f110-1f16c,1f170-1f1ac,1f200-1f202,1f210-1f23b,1f240-1f248,1f250-1f251,20087,20089,200cc,20164,20628,20676,20cd0,2139a,21413,215d7,2298f,235cb,23c97-23c98,23e23,241fe,2420e,248e9,249db,24a01,24a7d,24ac9,25532,25562,255a8,25ed7,26221,2648d,26676,2677c,26951,26b5c,26c21,278b2,27eaf,27ff9,28408,28678,28695,287e0,28b49,28c47,28c4f,28c51,28c54,28e0f,28e99,2967f,29810,29f7e,29f83,29f8c,2a7dd,2a8fb,2a917,2aa30,2aa36,2aa58,2afa2,2b127-2b128,2b137-2b138,2b1ed,2b300,2b363,2b36f,2b372,2b37d,2b404,2b410,2b413,2b461,2b4e7,2b4ef,2b4f6,2b4f9,2b50d-2b50e,2b536,2b5ae-2b5af,2b5b3,2b5e7,2b5f4,2b61c-2b61d,2b626-2b628,2b62a,2b62c,2b695-2b696,2b6ad,2b6ed,2b7a9,2b7c5,2b7e6,2b7f9,2b7fc,2b806,2b80a,2b81c,2b8b8,2bac7,2bb5f,2bb62,2bb7c,2bb83,2bc1b,2bd77,2bd87,2bdf7,2be29,2c029-2c02a,2c0a9,2c0ca,2c1d5,2c1d9,2c1f9,2c27c,2c288,2c2a4,2c317,2c35b,2c361,2c364,2c488,2c494,2c497,2c542,2c613,2c618,2c621,2c629,2c62b-2c62d,2c62f,2c642,2c64a-2c64b,2c72c,2c72f,2c79f,2c7c1,2c7fd,2c8d9,2c8de,2c8e1,2c8f3,2c907,2c90a,2c91d,2ca02,2ca0e,2ca7d,2caa9,2cb29,2cb2d-2cb2e,2cb31,2cb38-2cb39,2cb3b,2cb3f,2cb41,2cb4a,2cb4e,2cb5a-2cb5b,2cb64,2cb69,2cb6c,2cb6f,2cb73,2cb76,2cb78,2cb7c,2cbb1,2cbbf-2cbc0,2cbce,2cc56,2cc5f,2ccf5-2ccf6,2ccfd,2ccff,2cd02-2cd03,2cd0a,2cd8b,2cd8d,2cd8f-2cd90,2cd9f-2cda0,2cda8,2cdad-2cdae,2cdd5,2ce18,2ce1a,2ce23,2ce26,2ce2a,2ce7c,2ce88,2ce93,2d544,2f878,2f884,2f8b6,2f920";

function latinFile(name: string, bytes: number, sha256: string): PinnedFile {
  return {
    url: `https://raw.githubusercontent.com/notofonts/notofonts.github.io/${LATIN_FONT_COMMIT}/fonts/NotoSerif/hinted/ttf/${name}`,
    bytes,
    sha256,
  };
}

function cjkFile(name: string, bytes: number, sha256: string): PinnedFile {
  return {
    url: `https://raw.githubusercontent.com/notofonts/noto-cjk/${CJK_FONT_COMMIT}/Serif/SubsetOTF/SC/${name}`,
    bytes,
    sha256,
  };
}

export const PDF_FONT_CATALOG: readonly PdfFont[] = [
  {
    id: "latin",
    family: "Noto Serif",
    files: {
      regular: latinFile(
        "NotoSerif-Regular.ttf",
        712444,
        "19e72cd8d595fae5bd74a5206f5d938512e1183d4fed7abb1ec1be1d7efa5f88"
      ),
      bold: latinFile(
        "NotoSerif-Bold.ttf",
        747144,
        "96656aa5cec8f1d6fd0e804c1fad397e1a1cfa082e6642124e0bda68cd8363ce"
      ),
      italic: latinFile(
        "NotoSerif-Italic.ttf",
        756796,
        "749e80e313ef711f9373c6cce17c72297ef05490b3dcda7967d1d5d90bf1183f"
      ),
      boldItalic: latinFile(
        "NotoSerif-BoldItalic.ttf",
        779236,
        "c710c5b9cf354ae46e7a10472a08019b28220fafeb5887a482a76856f8f6fc0b"
      ),
    },
    coverage: LATIN_COVERAGE,
    license: "OFL-1.1",
    source:
      "https://github.com/notofonts/notofonts.github.io/tree/a5fca98891563057e7f65c1c4bf3f2a58c7704a4/fonts/NotoSerif",
  },
  {
    id: "cjk",
    family: "Noto Serif CJK",
    files: {
      regular: cjkFile(
        "NotoSerifSC-Regular.otf",
        11625800,
        "e8f396decc1f0963a016a989c3d8852e863d1350996f573860a80767c83a1cd3"
      ),
      bold: cjkFile(
        "NotoSerifSC-Bold.otf",
        12094336,
        "24693d48bdb9152f0a06b02af625638a1097abd6de4010ebba027f6e82710527"
      ),
    },
    coverage: CJK_COVERAGE,
    license: "OFL-1.1",
    source:
      "https://github.com/notofonts/noto-cjk/tree/f8d157532fbfaeda587e826d4cd5b21a49186f7c/Serif/SubsetOTF/SC",
  },
];

/** The i18n key naming what each font can show. */
export const PDF_FONT_NAME_KEYS = {
  latin: "settings.pdfFontLatinName",
  cjk: "settings.pdfFontCjkName",
} as const;

/** Download size in decimal megabytes, for display. */
export function pdfFontSizeMb(font: PdfFont): number {
  const { regular, bold, italic, boldItalic } = font.files;
  const files = [regular, bold, italic, boldItalic].filter((file) => file !== undefined);
  return Math.round(files.reduce((total, file) => total + file.bytes, 0) / 1_000_000);
}

export function pdfFontFor(id: string): PdfFont | undefined {
  return PDF_FONT_CATALOG.find((font) => font.id === id);
}

const parsedRanges = new Map<string, readonly (readonly [number, number])[]>();

function ranges(coverage: string): readonly (readonly [number, number])[] {
  const cached = parsedRanges.get(coverage);
  if (cached) return cached;
  const parsed = coverage.split(",").map((range): readonly [number, number] => {
    const [start, end] = range.split("-");
    return [Number.parseInt(start!, 16), Number.parseInt(end ?? start!, 16)];
  });
  parsedRanges.set(coverage, parsed);
  return parsed;
}

function covers(coverage: string, codePoint: number): boolean {
  const list = ranges(coverage);
  let low = 0;
  let high = list.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const [start, end] = list[middle]!;
    if (codePoint < start) high = middle - 1;
    else if (codePoint > end) low = middle + 1;
    else return true;
  }
  return false;
}

const CONTROL = /\p{Cc}/u;
const SOFT_HYPHEN = 0xad;

/**
 * What the PDF needs to render `text`: which installed fonts to embed, whether
 * anything stays uncovered, and which uninstalled fonts would fix that.
 * A font joins the stack only for code points earlier ones do not cover, so a
 * Latin-only book never loads the CJK font.
 */
export function pdfFontPlan(text: string, installedIds: readonly PdfFontId[]): PdfFontPlan {
  if (builtInFontsCanRender(text)) return { stack: [], missing: false, offers: [] };

  const required = new Set<number>();
  for (const char of text) {
    const codePoint = char.codePointAt(0)!;
    if (codePoint === SOFT_HYPHEN || CONTROL.test(char)) continue;
    required.add(codePoint);
  }

  const points = [...required];
  const covered = new Set<number>();
  const addedBy = (font: PdfFont) =>
    points.filter((codePoint) => !covered.has(codePoint) && covers(font.coverage, codePoint));

  const stack: PdfFont[] = [];
  for (const font of PDF_FONT_CATALOG) {
    if (!installedIds.includes(font.id)) continue;
    const added = addedBy(font);
    if (added.length === 0) continue;
    for (const codePoint of added) covered.add(codePoint);
    stack.push(font);
  }

  const uncovered = points.filter((codePoint) => !covered.has(codePoint));
  // With no font embedded the built-in fonts still draw the WinAnsi characters,
  // so only the characters they cannot show justify a download (Latin does not
  // fix an emoji). Once a font is embedded every uncovered character is a gap.
  const offered =
    stack.length === 0
      ? uncovered.filter((codePoint) => !builtInFontsCanRender(String.fromCodePoint(codePoint)))
      : uncovered;
  const offeredBy = (font: PdfFont) =>
    offered.filter((codePoint) => !covered.has(codePoint) && covers(font.coverage, codePoint));

  const offers: PdfFont[] = [];
  // Pick the font that adds the most uncovered code points first, so mixed
  // text suggests CJK before Latin and a Polish book suggests Latin alone.
  const candidates = PDF_FONT_CATALOG.filter((font) => !installedIds.includes(font.id));
  while (true) {
    let best: PdfFont | null = null;
    let bestAdded: number[] = [];
    for (const font of candidates) {
      if (offers.includes(font)) continue;
      const added = offeredBy(font);
      if (added.length > bestAdded.length) {
        best = font;
        bestAdded = added;
      }
    }
    if (!best) break;
    for (const codePoint of bestAdded) covered.add(codePoint);
    offers.push(best);
  }

  return { stack, missing: uncovered.length > 0, offers };
}
