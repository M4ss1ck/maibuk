/**
 * The Maps export core (#753). Everything here is pure and DOM-free: the pixel
 * sizes a print size and DPI give, the place size, the PNG-to-JPEG fallback
 * under the insert message cap, the base64 data URI, the @font-face block an
 * SVG export carries, the export SVG itself, its log line, and its file name.
 * `fitUnderCap` takes the encoder, so no test needs a canvas.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_DPI,
  ExportTooLargeError,
  type ExportMap,
  dataUri,
  defaultPrintWidthIn,
  embedFonts,
  exportFileName,
  exportLogLine,
  exportSvg,
  fitUnderCap,
  imageHtml,
  insertWhenReady,
  placePixelSize,
  PLACE_RETRY_DELAY_MS,
  PLACE_RETRY_TIMEOUT_MS,
  printPixelSize,
  svgAtPixelSize,
  svgPixelSize,
} from "./export";
import { bundledFonts } from "./font-bytes";
import {
  DEFAULT_LABEL_FONT,
  DEFAULT_LABEL_HALO_MM,
  DEFAULT_LABEL_SIZE_MM,
  DEFAULT_LABEL_WIDTH_MM,
  MAP_LABEL_FONT_FAMILIES,
  type MapLabelElement,
  type MapPage,
} from "./maps";

/** The four page sizes, exactly as `maps.ts` stores them. */
const PAGES: Readonly<Record<string, MapPage>> = {
  portrait: { preset: "portrait", widthMm: 152.4, heightMm: 228.6 },
  landscape: { preset: "landscape", widthMm: 228.6, heightMm: 152.4 },
  spread: { preset: "spread", widthMm: 304.8, heightMm: 228.6 },
  square: { preset: "square", widthMm: 203.2, heightMm: 203.2 },
};

/** A Map Label reading "The Reach", 40 mm wide at (20, 30), upright and flat. */
function label(overrides: Partial<MapLabelElement> = {}): MapLabelElement {
  return {
    id: "reach",
    kind: "label",
    name: "The Reach",
    hidden: false,
    locked: false,
    text: "The Reach",
    x: 20,
    y: 30,
    rotation: 0,
    width: DEFAULT_LABEL_WIDTH_MM,
    bend: 0,
    font: DEFAULT_LABEL_FONT,
    size: DEFAULT_LABEL_SIZE_MM,
    letterSpacing: 0,
    halo: DEFAULT_LABEL_HALO_MM,
    ...overrides,
  };
}

/** A Map of these elements on `page`, in the default Style. */
function mapWith(elements: MapLabelElement[], page: MapPage = PAGES.square): ExportMap {
  return { page, elements, styleId: "atlas" };
}

/** The base64 a byte range encodes to, so tests can name the exact `src`. */
function base64Of(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

describe("printPixelSize()", () => {
  it("gives a 12x9 in spread at 300 DPI 3600x2700 px", () => {
    expect(printPixelSize(PAGES.spread, 12, DEFAULT_DPI)).toEqual({
      widthPx: 3600,
      heightPx: 2700,
    });
  });

  it("gives a 6 in wide page at 150 DPI 900x1350 px", () => {
    // The page is 6x9 in, so 150 DPI draws it 900 px wide and the page aspect
    // makes the height 1350.
    expect(printPixelSize(PAGES.portrait, 6, 150)).toEqual({ widthPx: 900, heightPx: 1350 });
  });

  it("rounds a print width that lands between pixels", () => {
    // 6.5 in at 300 DPI is 1950 px; the height keeps the portrait aspect.
    expect(printPixelSize(PAGES.portrait, 6.5, DEFAULT_DPI)).toEqual({
      widthPx: 1950,
      heightPx: 2925,
    });
  });
});

describe("defaultPrintWidthIn()", () => {
  it("is the page's own physical width in inches", () => {
    expect(defaultPrintWidthIn(PAGES.spread)).toBe(12);
    expect(defaultPrintWidthIn(PAGES.portrait)).toBe(6);
    expect(defaultPrintWidthIn(PAGES.square)).toBe(8);
  });
});

describe("placePixelSize()", () => {
  it("is about 2000 px on the long side, keeping the page aspect", () => {
    expect(placePixelSize(PAGES.spread)).toEqual({ widthPx: 2000, heightPx: 1500 });
    expect(placePixelSize(PAGES.portrait)).toEqual({ widthPx: 1333, heightPx: 2000 });
  });
});

describe("dataUri()", () => {
  it("writes the bytes as a base64 data URI, without Buffer", () => {
    expect(dataUri("image/png", new Uint8Array([0, 255, 1]))).toBe("data:image/png;base64,AP8B");
  });

  it("handles more bytes than one call can spread", () => {
    const bytes = new Uint8Array(40_000).fill(65);
    const uri = dataUri("image/jpeg", bytes);
    expect(uri.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(uri.length).toBe("data:image/jpeg;base64,".length + 4 * Math.ceil(40_000 / 3));
  });
});

describe("fitUnderCap()", () => {
  it("keeps the PNG when its data URI fits the cap", async () => {
    const asked: string[] = [];
    const result = await fitUnderCap(async (format) => {
      asked.push(typeof format === "string" ? format : `jpeg:${format.jpeg}`);
      return new Uint8Array(3);
    }, 1000);

    expect(result.mime).toBe("image/png");
    expect(result.quality).toBeUndefined();
    expect(result.bytes).toHaveLength(3);
    // Only the PNG is asked for: nothing else is worth the encode.
    expect(asked).toEqual(["png"]);
  });

  it("falls back to JPEG at falling quality until the data URI fits", async () => {
    // The PNG's 3000 bytes become a 4000-char data URI, over the 1000 cap; the
    // JPEG encoder answers 600, 600, 600, then 600 bytes, and 600 bytes make an
    // 800-char URI, which fits.
    const capBytes = 1000;
    const qualities: number[] = [];
    const result = await fitUnderCap(async (format) => {
      if (format === "png") return new Uint8Array(3000);
      qualities.push(format.jpeg);
      return new Uint8Array(600);
    }, capBytes);

    expect(result.mime).toBe("image/jpeg");
    expect(result.quality).toBe(0.92);
    expect(qualities).toEqual([0.92]);
    expect(dataUri(result.mime, result.bytes).length).toBeLessThanOrEqual(capBytes);
  });

  it("keeps falling in quality while the JPEG is still over the cap", async () => {
    const capBytes = 4000;
    const qualities: number[] = [];
    const result = await fitUnderCap(async (format) => {
      if (format === "png") return new Uint8Array(6000);
      qualities.push(format.jpeg);
      // 3800 bytes (a 5068-char URI) at 0.92 and 0.85 are over the cap; 2900
      // bytes at 0.75 make a 3891-char URI, which fits, so 0.75 wins.
      return new Uint8Array(format.jpeg >= 0.85 ? 3800 : 2900);
    }, capBytes);

    expect(qualities).toEqual([0.92, 0.85, 0.75]);
    expect(result.quality).toBe(0.75);
    expect(dataUri(result.mime, result.bytes).length).toBeLessThanOrEqual(capBytes);
  });

  it("measures the data URI, not the raw bytes", async () => {
    // 900 raw bytes sit under the 1000 cap, but their data URI is 1222 chars,
    // and the message carries the URI.
    const result = await fitUnderCap(
      async (format) => (format === "png" ? new Uint8Array(900) : new Uint8Array(3)),
      1000
    );

    expect(result.mime).toBe("image/jpeg");
  });

  it("throws a typed error when nothing fits", async () => {
    await expect(fitUnderCap(async () => new Uint8Array(10_000), 1000)).rejects.toBeInstanceOf(
      ExportTooLargeError
    );
  });
});

describe("embedFonts()", () => {
  const cinzel = {
    family: MAP_LABEL_FONT_FAMILIES.cinzel,
    bytes: new Uint8Array([1, 2, 3]),
    mime: "font/ttf",
  };
  const fell = {
    family: MAP_LABEL_FONT_FAMILIES["im-fell-english"],
    bytes: new Uint8Array([4, 5]),
    mime: "font/ttf",
  };
  const uncial = {
    family: MAP_LABEL_FONT_FAMILIES["uncial-antiqua"],
    bytes: new Uint8Array([6]),
    mime: "font/ttf",
  };

  const SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g><text x="1" y="1" ' +
    `font-family="${MAP_LABEL_FONT_FAMILIES.cinzel}">A</text><text x="2" y="2" ` +
    `font-family="${MAP_LABEL_FONT_FAMILIES["im-fell-english"]}">B</text></g></svg>`;

  it("embeds one @font-face per family the SVG names, and no other", () => {
    const out = embedFonts(SVG, [cinzel, fell, uncial]);

    expect(out.match(/<style>/g)).toHaveLength(1);
    expect(out.match(/@font-face/g)).toHaveLength(2);
    expect(out).toContain(
      `@font-face{font-family:"${cinzel.family}";src:url(data:${cinzel.mime};base64,${base64Of(cinzel.bytes)})}`
    );
    expect(out).toContain(
      `@font-face{font-family:"${fell.family}";src:url(data:${fell.mime};base64,${base64Of(fell.bytes)})}`
    );
    expect(out).not.toContain(uncial.family);
    // The style lands right after the opening tag and before the picture.
    expect(out.indexOf("<style>")).toBeLessThan(out.indexOf("<g>"));
    expect(out.startsWith("<svg")).toBe(true);
  });

  it("reads a family out of a font-family list and a style attribute too", () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' +
      `<text style="font-family: '${MAP_LABEL_FONT_FAMILIES.cinzel}', serif">A</text>` +
      `<text font-family="${MAP_LABEL_FONT_FAMILIES["uncial-antiqua"]}, cinzel">B</text></svg>`;
    const out = embedFonts(svg, [cinzel, uncial]);

    expect(out.match(/@font-face/g)).toHaveLength(2);
  });

  it("puts the block into an existing <defs>", () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><filter id="f"/></defs>' +
      `<text font-family="${cinzel.family}">A</text></svg>`;
    const out = embedFonts(svg, [cinzel]);

    expect(out).toContain(`<defs><style>@font-face{font-family:"${cinzel.family}"`);
  });

  it("leaves an SVG that names no bundled family alone", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text font-family="serif">A</text></svg>';
    expect(embedFonts(svg, [cinzel])).toBe(svg);
  });
});

describe("exportSvg()", () => {
  it("has no editor markers, keeps the textPath, and carries the print size and fonts", () => {
    const map = mapWith([label({ font: "cinzel", bend: 8 })]);
    const svg = exportSvg(map, bundledFonts());

    expect(svg).not.toContain("data-element-id");
    expect(svg).not.toContain("data-selected");
    expect(svg).toContain("<textPath");
    // The viewBox stays in millimetres, and the explicit width/height give
    // Inkscape the print size.
    expect(svg).toContain('viewBox="0 0 203.2 203.2"');
    expect(svg).toContain('width="203.2mm"');
    expect(svg).toContain('height="203.2mm"');
    expect(svg).toContain(`@font-face{font-family:"${MAP_LABEL_FONT_FAMILIES.cinzel}"`);
    expect(svg).not.toContain(MAP_LABEL_FONT_FAMILIES["medieval-sharp"]);
  });

  it("includes the author's PDF Font when the Map labels ask for it", () => {
    const map = mapWith([label({ font: "pdf" })]);
    const pdfFont = {
      family: MAP_LABEL_FONT_FAMILIES.pdf,
      bytes: new Uint8Array([9, 9]),
      mime: "font/ttf",
    };
    const svg = exportSvg(map, [pdfFont]);

    expect(svg).toContain(`@font-face{font-family:"${pdfFont.family}"`);
  });
});

describe("exportLogLine()", () => {
  it("writes one line naming the action, format, pixel size, and bytes", () => {
    expect(
      exportLogLine({
        action: "save",
        format: "png",
        widthPx: 3600,
        heightPx: 2700,
        bytes: 1_234_567,
      })
    ).toBe("[maibuk-maps] export save png 3600x2700 1234567 bytes");
  });
});

describe("exportFileName()", () => {
  it("appends the extension to the Map's name", () => {
    expect(exportFileName("The Reach", "png")).toBe("The Reach.png");
  });

  it("drops path separators and characters a filesystem refuses", () => {
    expect(exportFileName('../../North / "South" <1>', "svg")).toBe("North South 1.svg");
  });

  it("falls back to a plain name when nothing is left", () => {
    expect(exportFileName("  ...  ", "png")).toBe("map.png");
  });
});

describe("the bundled font bytes", () => {
  it("decodes all four shipped faces, keyed by the family a label names", () => {
    const fonts = bundledFonts();
    expect(fonts.map((font) => font.family).sort()).toEqual(
      [
        MAP_LABEL_FONT_FAMILIES.cinzel,
        MAP_LABEL_FONT_FAMILIES["im-fell-english"],
        MAP_LABEL_FONT_FAMILIES["medieval-sharp"],
        MAP_LABEL_FONT_FAMILIES["uncial-antiqua"],
      ].sort()
    );
    for (const font of fonts) {
      // A TrueType file opens with 0x00010000.
      expect([...font.bytes.slice(0, 4)]).toEqual([0, 1, 0, 0]);
      expect(font.mime).toBe("font/ttf");
    }
  });

  it("decodes each face once, so an export does not copy it every time", () => {
    const [first] = bundledFonts();
    const [second] = bundledFonts();
    expect(second.bytes).toBe(first.bytes);
  });
});

describe("svgPixelSize()", () => {
  it("reads the page's millimetres as pixels at 96 DPI, for the SVG log line", () => {
    // A 6x9 in page is 152.4x228.6 mm, which a browser draws at 576x864 px.
    expect(svgPixelSize(PAGES.portrait)).toEqual({ widthPx: 576, heightPx: 864 });
  });
});

describe("svgAtPixelSize()", () => {
  it("replaces the millimetre print size with the pixel size a rasterizer draws at", () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 152.4 228.6" width="152.4mm" height="228.6mm"><g/></svg>';
    const out = svgAtPixelSize(svg, { widthPx: 900, heightPx: 1350 });

    expect(out).toContain('width="900"');
    expect(out).toContain('height="1350"');
    expect(out).not.toContain("mm");
    expect(out).toContain('viewBox="0 0 152.4 228.6"');
  });
});

describe("imageHtml()", () => {
  it("wraps the data URI in an img tag with the alt text escaped", () => {
    expect(imageHtml('The Reach & "Tides" <1>', "data:image/png;base64,AA")).toBe(
      '<img src="data:image/png;base64,AA" alt="The Reach &amp; &quot;Tides&quot; &lt;1&gt;">'
    );
  });
});

describe("insertWhenReady()", () => {
  /** An insert answering each outcome in turn, then the last one again. */
  function answers(...outcomes: Array<"applied" | "no-target">) {
    let calls = 0;
    const insert = () => {
      const status = outcomes[Math.min(calls, outcomes.length - 1)];
      calls += 1;
      return Promise.resolve({ status });
    };
    return { insert, calls: () => calls };
  }

  function recorder(): { sleep: (ms: number) => Promise<void>; waits: number[] } {
    const waits: number[] = [];
    return {
      waits,
      sleep: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    };
  }

  it("inserts once and waits not at all when the editor is already mounted", async () => {
    const { insert, calls } = answers("applied");
    const { sleep, waits } = recorder();

    await expect(insertWhenReady(insert, sleep)).resolves.toEqual({ status: "applied" });
    expect(calls()).toBe(1);
    expect(waits).toEqual([]);
  });

  it("retries a no-target answer after the delay, then applies", async () => {
    const { insert, calls } = answers("no-target", "applied");
    const { sleep, waits } = recorder();

    await expect(insertWhenReady(insert, sleep)).resolves.toEqual({ status: "applied" });
    expect(calls()).toBe(2);
    expect(waits).toEqual([PLACE_RETRY_DELAY_MS]);
  });

  it("gives up after the timeout with the last no-target answer", async () => {
    const { insert, calls } = answers("no-target");
    const { sleep, waits } = recorder();

    await expect(insertWhenReady(insert, sleep)).resolves.toEqual({ status: "no-target" });
    // One attempt, then one every delay until the timeout is spent.
    expect(waits).toHaveLength(Math.floor(PLACE_RETRY_TIMEOUT_MS / PLACE_RETRY_DELAY_MS));
    expect(calls()).toBe(waits.length + 1);
  });
});
