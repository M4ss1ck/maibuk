/**
 * The Map Frame's SVG ingest (#756): the classic script the Frame loads before
 * `map.js`, driven here with the real vendored DOMPurify build the Frame loads
 * beside it. An uploaded picture is untrusted, so every script, handler, HTML
 * island, and reference that leaves the file must go, while a fragment
 * reference inside the picture stays; and only a single-paint picture may be
 * tinted by a Custom Stamp.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SOURCE = readFileSync(join(__dirname, "assets/ui/svg-ingest.js"), "utf8");
const PURIFY_BYTES = readFileSync(join(__dirname, "assets/ui/lib/purify.min.js"));
const PURIFY = PURIFY_BYTES.toString("utf8");

interface SvgIngest {
  FORBID_TAGS: string[];
  sanitizeSvg(
    text: string,
    purify: {
      sanitize(node: string, options: Record<string, unknown>): unknown;
    }
  ): { svg: string; recolorable: boolean } | null;
}

/** The `window.DOMPurify` the Frame gets from the vendored file beside it. */
function loadPurify(): {
  version: string;
  sanitize(node: string, options: Record<string, unknown>): unknown;
} {
  new Function(PURIFY)();
  const purify = (globalThis as Record<string, unknown>).DOMPurify;
  if (purify === undefined) throw new Error("purify.min.js did not define DOMPurify");
  return purify as {
    version: string;
    sanitize(node: string, options: Record<string, unknown>): unknown;
  };
}

/** Loads the classic script and returns the global it defines. */
function loadIngest(): SvgIngest {
  new Function(SOURCE)();
  const ingest = (globalThis as Record<string, unknown>).maibukSvgIngest;
  if (ingest === undefined) throw new Error("svg-ingest.js did not define maibukSvgIngest");
  return ingest as SvgIngest;
}

/** One picture, in the namespace an SVG file declares. */
function picture(body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}

const ingest = loadIngest();
const purify = loadPurify();

afterEach(() => {
  delete (globalThis as Record<string, unknown>).maibukSvgIngest;
  delete (globalThis as Record<string, unknown>).DOMPurify;
});

/** The one result a picture that survives the sanitizer must have. */
function sanitized(markup: string): { svg: string; recolorable: boolean } {
  const result = ingest.sanitizeSvg(markup, purify);
  if (result === null) throw new Error("the picture did not survive the sanitizer");
  return result;
}

describe("the vendored DOMPurify", () => {
  it("is the build the folder's README records, unmodified", () => {
    const readme = readFileSync(join(__dirname, "assets/ui/lib/README.md"), "utf8");
    const sha256 = createHash("sha256").update(PURIFY_BYTES).digest("hex");

    // The README pins the version and the sha256 of the file beside it, so a
    // hand-edited sanitizer cannot pass as the library the licence names.
    expect(readme).toContain(`dompurify@${purify.version}/dist/purify.min.js`);
    expect(readme).toContain(sha256);
  });
});

describe("sanitizeSvg", () => {
  it("strips a script element", () => {
    const { svg } = sanitized(picture(`<script>alert(1)</script><rect width="10" height="10"/>`));

    expect(svg).not.toContain("script");
    expect(svg).toContain("<rect");
  });

  it("strips an event handler attribute", () => {
    const { svg } = sanitized(picture(`<rect onload="alert(1)" onclick="alert(2)" width="10"/>`));

    expect(svg).not.toMatch(/on[a-z]+=/i);
    expect(svg).toContain("<rect");
  });

  it("drops a foreignObject island and keeps the picture around it", () => {
    const { svg } = sanitized(
      picture(`<foreignObject><div>hi</div></foreignObject><rect width="4" height="4"/>`)
    );

    expect(svg).not.toContain("foreignObject");
    expect(svg).not.toContain("hi");
    expect(svg).toContain("<rect");
  });

  it("drops a style element, so a sheet cannot restyle the Frame", () => {
    const { svg } = sanitized(picture(`<style>rect { display: none }</style><rect width="4"/>`));

    expect(svg).not.toContain("<style");
    expect(svg).not.toContain("display");
  });

  it("drops references outside the picture and keeps the file's own fragments", () => {
    const markup = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
      <a href="https://example.com/away"><rect width="2" height="2"/></a>
      <image xlink:href="https://example.com/tracker.png" width="4" height="4"/>
      <image href="https://example.com/other.png" width="4" height="4"/>
      <image href="#inside" width="4" height="4"/>
      <image xlink:href="#also-inside" width="4" height="4"/>
    </svg>`;
    const { svg } = sanitized(markup);

    expect(svg).not.toContain("example.com");
    expect(svg).toContain('href="#inside"');
    expect(svg).toContain('xlink:href="#also-inside"');
  });

  it("drops a url() that points anywhere but a fragment of the picture", () => {
    const { svg } = sanitized(
      picture(`
        <defs><linearGradient id="ink"><stop offset="0" stop-color="#fff"/></linearGradient></defs>
        <rect fill="url(https://example.com/paint.svg#p)" width="2" height="2"/>
        <rect fill="url('http://example.com/paint.svg#p')" width="2" height="2"/>
        <rect style="fill: url('https://example.com/paint.svg#p')" width="2" height="2"/>
        <rect style="fill: url(#ink)" width="2" height="2"/>
        <rect fill="url(#ink)" width="2" height="2"/>
      `)
    );

    expect(svg).not.toContain("example.com");
    expect(svg).toContain('style="fill: url(#ink)"');
    expect(svg).toContain('fill="url(#ink)"');
  });

  it("returns null for markup that is not an SVG document", () => {
    expect(ingest.sanitizeSvg("<div>not a picture</div>", purify)).toBeNull();
    expect(ingest.sanitizeSvg("", purify)).toBeNull();
    expect(ingest.sanitizeSvg("just words", purify)).toBeNull();
  });

  it("returns null when there is no sanitizer to run", () => {
    expect(ingest.sanitizeSvg(picture(`<rect width="1"/>`), undefined as never)).toBeNull();
  });
});

describe("a picture's paints", () => {
  it("calls a one-colour picture recolorable, whether it writes its paint or not", () => {
    // A shape with no fill draws black, so a drawing that writes no colour is
    // a one-colour drawing too.
    expect(sanitized(picture(`<path d="M 0 0 L 4 0 L 4 4 Z"/>`)).recolorable).toBe(true);
    expect(
      sanitized(
        picture(`
          <path d="M 0 0 L 4 0 L 4 4 Z" fill="#1F2933"/>
          <path d="M 6 0 L 8 0" fill="none" stroke="#1f2933"/>
          <rect style="fill: #1F2933; stroke: none" width="1" height="1"/>
        `)
      ).recolorable
    ).toBe(true);
  });

  it("ignores the paints that draw no colour", () => {
    expect(
      sanitized(
        picture(`
          <path d="M 0 0 L 4 0 L 4 4 Z" fill="#8b1a1a"/>
          <path d="M 6 0 L 8 0" fill="none" stroke="#8b1a1a"/>
          <rect fill="transparent" width="1" height="1"/>
          <text fill="currentColor">A</text>
        `)
      ).recolorable
    ).toBe(true);
  });

  it("calls a two-colour picture not recolorable", () => {
    expect(
      sanitized(
        picture(`
          <path d="M 0 0 L 4 0 L 4 4 Z" fill="#8b1a1a"/>
          <path d="M 6 0 L 8 0" stroke="#3b6e8f"/>
        `)
      ).recolorable
    ).toBe(false);
  });

  it("sees a colour written in a style declaration as its own paint", () => {
    expect(
      sanitized(
        picture(`
          <rect width="4" height="4"/>
          <rect style="fill: #3b6e8f" width="4" height="4"/>
        `)
      ).recolorable
    ).toBe(false);
  });
});
