/**
 * Reader's book sanitizer (#653): the classic script the Frame loads before
 * `reader.js`, driven here with the real DOMPurify build and an XML document the
 * way an EPUB section is parsed. Book markup is untrusted, so every dangerous
 * tag, handler, scheme, and network URL must go, while archive-relative
 * references must come back as the `blob:` URLs the Frame owns.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error -- vendored plain JavaScript, no type declarations
import purify from "./vendor/dompurify/purify.es.mjs";

const SOURCE = readFileSync(join(__dirname, "assets/ui/sanitizer.js"), "utf8");

interface Sanitizer {
  FORBID_TAGS: string[];
  LINE_WIDTHS: Record<string, string>;
  isExternal(value: string): boolean;
  isScriptUrl(value: string): boolean;
  resolvePath(base: string, reference: string): string | null;
  sanitizeDocument(doc: Document, purify: unknown): Document;
  rewriteDocument(
    doc: Document,
    options: {
      base: string;
      assetUrl(path: string, type: string): Promise<string | null>;
      assetText(path: string): Promise<string | null>;
    }
  ): Promise<void>;
  rewriteCss(
    css: string,
    options: { base: string; assetUrl(path: string, type: string): Promise<string | null> }
  ): Promise<string>;
  readingCss(settings: { fontSize: number; lineWidth: string }, options?: { dark?: boolean }): string;
  mediaTypeFor(path: string): string;
}

/** Loads the classic script and returns the global it defines. */
function loadSanitizer(): Sanitizer {
  new Function(SOURCE)();
  const sanitizer = (globalThis as Record<string, unknown>).ReaderSanitizer;
  if (sanitizer === undefined) throw new Error("sanitizer.js did not define ReaderSanitizer");
  return sanitizer as Sanitizer;
}

/** Parses fixture markup the way foliate parses an EPUB section. */
function section(markup: string): Document {
  return new DOMParser().parseFromString(
    `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:xlink="http://www.w3.org/1999/xlink">
  <head><title>Fixture</title></head>
  <body>${markup}</body>
</html>`,
    "application/xhtml+xml"
  );
}

const sanitizer = loadSanitizer();

afterEach(() => {
  delete (globalThis as Record<string, unknown>).ReaderSanitizer;
});

describe("resolvePath", () => {
  it("resolves archive-relative references from the section's own folder", () => {
    expect(sanitizer.resolvePath("OEBPS/text/ch1.xhtml", "images/a.png")).toBe(
      "OEBPS/text/images/a.png"
    );
    expect(sanitizer.resolvePath("OEBPS/text/ch1.xhtml", "../images/a.png")).toBe(
      "OEBPS/images/a.png"
    );
    expect(sanitizer.resolvePath("OEBPS/text/ch1.xhtml", "/OEBPS/images/a.png")).toBe(
      "OEBPS/images/a.png"
    );
    expect(sanitizer.resolvePath("OEBPS/text/ch1.xhtml", "a%20b.png#frag")).toBe(
      "OEBPS/text/a b.png"
    );
  });

  it("drops references that leave the archive or reach the network", () => {
    expect(sanitizer.resolvePath("OEBPS/ch1.xhtml", "https://example.com/a.png")).toBeNull();
    expect(sanitizer.resolvePath("OEBPS/ch1.xhtml", "//example.com/a.png")).toBeNull();
    expect(sanitizer.resolvePath("OEBPS/ch1.xhtml", "javascript:alert(1)")).toBeNull();
    expect(sanitizer.resolvePath("OEBPS/ch1.xhtml", "data:image/png;base64,AA")).toBeNull();
    expect(sanitizer.resolvePath("OEBPS/ch1.xhtml", "#frag")).toBeNull();
    expect(sanitizer.resolvePath("OEBPS/ch1.xhtml", "")).toBeNull();
  });
});

describe("sanitizeDocument", () => {
  it("removes scripts, handlers, frames, forms, and network URLs", () => {
    const doc = section(`
      <script>globalThis.__readerScriptRan = true;</script>
      <p onclick="globalThis.__readerHandlerRan = true">handler</p>
      <a href="javascript:globalThis.__readerLinkRan = true">script link</a>
      <a href="https://example.com/away">external link</a>
      <img src="https://example.com/tracker.png" alt="tracker"/>
      <img src="images/kept.png" alt="kept"/>
      <iframe src="https://example.com/embed"></iframe>
      <form action="https://example.com/collect"><input name="q"/></form>
      <object data="movie.swf"></object>
      <base href="https://example.com/"/>
    `);
    sanitizer.sanitizeDocument(doc, purify);

    expect(doc.querySelector("script")).toBeNull();
    expect(doc.querySelector("iframe")).toBeNull();
    expect(doc.querySelector("form")).toBeNull();
    expect(doc.querySelector("input")).toBeNull();
    expect(doc.querySelector("object")).toBeNull();
    expect(doc.querySelector("base")).toBeNull();
    expect(doc.querySelector("[onclick]")).toBeNull();
    expect(doc.querySelector('a[href^="javascript"]')).toBeNull();
    expect(doc.querySelector('a[href^="https"]')).toBeNull();
    expect(doc.querySelector('img[src^="https"]')).toBeNull();
    expect(doc.querySelector('img[src="images/kept.png"]')).not.toBeNull();
  });

  it("keeps the section's text even when it strips a forbidden wrapper", () => {
    const doc = section(`<form><p>Still readable</p></form>`);
    sanitizer.sanitizeDocument(doc, purify);
    expect(doc.body.textContent).toContain("Still readable");
  });

  it("strips external urls from style sheets but keeps relative ones", () => {
    const doc = section(`
      <style>
        @import url("https://example.com/evil.css");
        .a { background: url(https://example.com/a.png); }
        .b { background: url("images/b.png"); }
      </style>
    `);
    sanitizer.sanitizeDocument(doc, purify);
    const css = doc.querySelector("style")?.textContent ?? "";
    expect(css).not.toContain("example.com");
    expect(css).toContain('url("images/b.png")');
  });

  it("sanitizes an XHTML section parsed as XML", () => {
    const doc = section(`<p onclick="alert(1)">text</p><script>alert(1)</script>`);
    expect(() => sanitizer.sanitizeDocument(doc, purify)).not.toThrow();
    expect(doc.querySelector("script")).toBeNull();
    expect(doc.querySelector("[onclick]")).toBeNull();
  });
});

describe("rewriteDocument", () => {
  const assets: Record<string, string> = {
    "OEBPS/images/figure.png": "blob:mock/figure",
    "OEBPS/images/cover.png": "blob:mock/cover",
    "OEBPS/style.css": "blob:mock/style",
  };
  const assetUrl = async (path: string) => assets[path] ?? null;
  const assetText = async (path: string) =>
    path === "OEBPS/style.css"
      ? `.a { background: url("images/figure.png"); } .b { background: url(https://example.com/x.png); }`
      : null;

  it("turns archive-relative images into blob urls and drops missing ones", async () => {
    const doc = section(`
      <img src="images/figure.png" alt="figure"/>
      <img src="images/missing.png" alt="missing"/>
      <img src="data:image/png;base64,AA" alt="inline"/>
    `);
    sanitizer.sanitizeDocument(doc, purify);
    await sanitizer.rewriteDocument(doc, {
      base: "OEBPS/chapter1.xhtml",
      assetUrl,
      assetText,
    });
    const images = Array.from(doc.querySelectorAll("img"));
    expect(images[0].getAttribute("src")).toBe("blob:mock/figure");
    expect(images[1].getAttribute("src")).toBeNull();
    expect(images[2].getAttribute("src")).toBe("data:image/png;base64,AA");
  });

  it("rewrites svg image references and inline styles", async () => {
    const doc = section(`
      <svg xmlns="http://www.w3.org/2000/svg">
        <image xlink:href="images/figure.png"/>
      </svg>
      <p style="background: url(images/figure.png)">styled</p>
    `);
    sanitizer.sanitizeDocument(doc, purify);
    await sanitizer.rewriteDocument(doc, {
      base: "OEBPS/chapter1.xhtml",
      assetUrl,
      assetText,
    });
    const image = doc.querySelector("image");
    expect(image?.getAttributeNS("http://www.w3.org/1999/xlink", "href")).toBe("blob:mock/figure");
    expect(doc.querySelector("p")?.getAttribute("style")).toContain('url("blob:mock/figure")');
  });

  it("inlines a linked style sheet and rewrites its urls against its own folder", async () => {
    const doc = section(`<link rel="stylesheet" href="style.css"/>`);
    await sanitizer.rewriteDocument(doc, {
      base: "OEBPS/chapter1.xhtml",
      assetUrl,
      assetText,
    });
    expect(doc.querySelector('link[rel~="stylesheet"]')).toBeNull();
    const style = doc.querySelector("style");
    expect(style?.textContent).toContain('url("blob:mock/figure")');
    expect(style?.textContent).toContain('url("")');
  });
});

describe("rewriteCss", () => {
  it("fails closed for a reference that resolves to nothing", async () => {
    const css = await sanitizer.rewriteCss(".a { background: url(images/none.png); }", {
      base: "OEBPS/chapter1.xhtml",
      assetUrl: async () => null,
    });
    expect(css).toBe('.a { background: url(""); }');
  });

  it("leaves data and blob urls alone", async () => {
    const css = await sanitizer.rewriteCss(
      `.a { background: url("data:image/png;base64,AA"); } .b { background: url(blob:mock/x); }`,
      { base: "OEBPS/chapter1.xhtml", assetUrl: async () => null }
    );
    expect(css).toContain("data:image/png;base64,AA");
    expect(css).toContain("blob:mock/x");
  });
});

describe("readingCss", () => {
  it("scales the reading column with the font-size setting", () => {
    const normal = sanitizer.readingCss({ fontSize: 100, lineWidth: "medium" });
    const large = sanitizer.readingCss({ fontSize: 200, lineWidth: "medium" });
    expect(normal).toContain("font-size: 1em");
    expect(large).toContain("font-size: 2em");
    expect(normal).toContain("max-width: 38em");
  });

  it("keeps the column width setting and forces dark colours", () => {
    const narrow = sanitizer.readingCss({ fontSize: 100, lineWidth: "narrow" });
    expect(narrow).toContain("max-width: 30em");
    const dark = sanitizer.readingCss({ fontSize: 100, lineWidth: "wide" }, { dark: true });
    expect(dark).toContain("#e5e5e5");
    expect(dark).toContain("max-width: 48em");
  });
});

describe("mediaTypeFor", () => {
  it("names the archive's own media types", () => {
    expect(sanitizer.mediaTypeFor("a/b.png")).toBe("image/png");
    expect(sanitizer.mediaTypeFor("a/b.JPG")).toBe("image/jpeg");
    expect(sanitizer.mediaTypeFor("a/b.svg")).toBe("image/svg+xml");
    expect(sanitizer.mediaTypeFor("a/b.css")).toBe("text/css");
    expect(sanitizer.mediaTypeFor("a/b.woff2")).toBe("font/woff2");
    expect(sanitizer.mediaTypeFor("a/b.bin")).toBe("application/octet-stream");
  });
});
