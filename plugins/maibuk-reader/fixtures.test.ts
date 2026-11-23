/**
 * Reader's fixtures (#653): the committed files must still be exactly what
 * `scripts/generate-fixtures.mjs` writes, and each must carry the structure the
 * Reader tests rely on — PDFs with twelve pages that each draw their number, an
 * outline and page labels; a password PDF that really opens with `reader`; an
 * EPUB with two spine chapters, a fixed-layout one, and an encrypted one; a CBZ
 * of eight pages; an FB2; and MOBI/AZW3 files whose PalmDB headers carry the
 * version and encryption flag the Reader reads. The PDFs are parsed by the
 * vendored pdf.js itself, the engine Reader runs, through the helpers below;
 * `pdf-lib` and `openZip` read the structure beside it. The two bench-only image
 * fixtures (#925) are generated per run, so only their zip shape and size are
 * checked here.
 */

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PDFDocument, PDFRawStream } from "pdf-lib";
import { afterAll, describe, expect, it } from "vitest";
import { buildImageEpub, buildLargeComicBook } from "./scripts/generate-fixtures.mjs";
import { ZipError, openZip } from "./zip";

const HERE = join(__dirname, "fixtures");
const GENERATOR = join(__dirname, "scripts", "generate-fixtures.mjs");
const generated = mkdtempSync(join(tmpdir(), "maibuk-reader-fixtures-"));

afterAll(() => {
  rmSync(generated, { recursive: true, force: true });
});

/** Every fixture the generator writes, in a stable order. */
const FIXTURES = [
  "twelve-pages.pdf",
  "password.pdf",
  "flowing.epub",
  "fixed-layout.epub",
  "encrypted.epub",
  "corrupt.epub",
  "pages.cbz",
  "story.fb2",
  "story.mobi",
  "story.azw3",
  "drm.mobi",
];

/**
 * Runs the committed generator in a scratch directory laid out like the Plugin
 * folder — `scripts/` beside `fixtures/` — and returns the bytes it wrote.
 */
function regenerate(): Record<string, Buffer> {
  const scripts = join(generated, "scripts");
  const output = join(generated, "fixtures");
  mkdirSync(scripts, { recursive: true });
  mkdirSync(output, { recursive: true });
  copyFileSync(GENERATOR, join(scripts, "generate-fixtures.mjs"));
  execFileSync(process.execPath, [join(scripts, "generate-fixtures.mjs")], { stdio: "ignore" });
  return Object.fromEntries(FIXTURES.map((name) => [name, readFileSync(join(output, name))]));
}

/** The committed bytes of one fixture. */
function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(HERE, name)));
}

/** One page's text, as pdf.js reports it. */
interface PdfTextPage {
  getTextContent(): Promise<{ items: { str?: string }[] }>;
}

/** A loaded pdf.js document: the page count and one page's text. */
interface PdfDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfTextPage>;
}

/** The task `getDocument` returns; destroying it tears down the fake Worker. */
interface PdfLoadingTask {
  promise: Promise<PdfDocument>;
  destroy(): Promise<void>;
}

/** The slice of pdf.js this file drives. */
interface PdfJs {
  getDocument(params: Record<string, unknown>): PdfLoadingTask;
  GlobalWorkerOptions: { workerSrc: string };
  PasswordException: new (...args: never[]) => Error;
}

let pdfjsModule: Promise<PdfJs> | null = null;

/**
 * The vendored pdf.js, loaded into the plain Node test. Its browser build needs
 * what a Worker supplies: the core-js polyfills Node lacks
 * (`Uint8Array.prototype.toHex`), `self`, and a `workerSrc` pointing at the
 * vendored worker so pdf.js's fake Worker can start. Loaded once per file.
 */
function pdfjs(): Promise<PdfJs> {
  pdfjsModule ??= (async () => {
    const vendor = join(__dirname, "vendor", "pdfjs");
    const scope = globalThis as unknown as { self?: unknown };
    scope.self ??= globalThis;
    await import(/* @vite-ignore */ pathToFileURL(join(vendor, "polyfills.min.js")).href);
    const module = (await import(
      /* @vite-ignore */ pathToFileURL(join(vendor, "pdf.min.mjs")).href
    )) as PdfJs;
    module.GlobalWorkerOptions.workerSrc = pathToFileURL(join(vendor, "pdf.worker.min.mjs")).href;
    return module;
  })();
  return pdfjsModule;
}

/** Opens one committed fixture with pdf.js, or rejects with its PasswordException. */
async function openPdf(name: string, password?: string): Promise<PdfLoadingTask> {
  const module = await pdfjs();
  return module.getDocument({
    data: fixture(name),
    isEvalSupported: false,
    ...(password === undefined ? {} : { password }),
  });
}

/** The text on one page of an open pdf.js document. */
async function pageText(document: PdfDocument, pageNumber: number): Promise<string> {
  const page = await document.getPage(pageNumber);
  const content = await page.getTextContent();
  return content.items.map((item) => item.str ?? "").join("");
}

/** A ranged read over `bytes`, the way the Worker opens an archive. */
function ranged(bytes: Uint8Array) {
  return async (offset: number, length: number) => bytes.subarray(offset, offset + length);
}

/** The big-endian uint16/uint32 a PalmDB header stores. */
function u16be(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] as number) << 8) | (bytes[offset + 1] as number);
}

function u32be(bytes: Uint8Array, offset: number): number {
  return (
    (((bytes[offset] as number) << 24) |
      ((bytes[offset + 1] as number) << 16) |
      ((bytes[offset + 2] as number) << 8) |
      (bytes[offset + 3] as number)) >>>
    0
  );
}

const latin1 = new TextDecoder("latin1", { fatal: false });
const utf8 = new TextDecoder("utf-8");

describe("the fixture generator", () => {
  it("writes byte-for-byte the files the tree commits", () => {
    const fresh = regenerate();
    expect(Object.keys(fresh).sort()).toEqual([...FIXTURES].sort());
    for (const [name, bytes] of Object.entries(fresh)) {
      expect(readFileSync(join(HERE, name))).toEqual(bytes);
    }
  });

  it("labels the twelve pages and gives them an outline", async () => {
    const pdf = await PDFDocument.load(
      new Uint8Array(readFileSync(join(HERE, "twelve-pages.pdf")))
    );
    expect(pdf.getPageCount()).toBe(12);
    const source = readFileSync(join(HERE, "twelve-pages.pdf"), "latin1");
    expect(source).toContain("/Outlines");
    // Roman prelims for pages 1 and 2, then decimal from page 3 on.
    expect(source).toContain("/PageLabels << /Nums [0 << /S /r >> 2 << /S /D >>] >>");
    expect(source).toContain("(Chapter One)");
    expect(source).toContain("(A Section)");
  });

  it("gives every page a content stream that draws its number", async () => {
    const pdf = await PDFDocument.load(
      new Uint8Array(readFileSync(join(HERE, "twelve-pages.pdf")))
    );
    expect(pdf.getPageCount()).toBe(12);
    for (let index = 0; index < 12; index += 1) {
      const contents = pdf.getPage(index).node.Contents();
      if (!(contents instanceof PDFRawStream)) {
        throw new Error(`page ${index + 1} has no content stream`);
      }
      expect(Buffer.from(contents.getContents()).toString("latin1")).toContain(`(${index + 1}) Tj`);
    }
  });

  it("reads page 3's number as text through pdf.js", async () => {
    const task = await openPdf("twelve-pages.pdf");
    try {
      const document = await task.promise;
      expect(document.numPages).toBe(12);
      expect(await pageText(document, 3)).toContain("3");
      expect(await pageText(document, 1)).toContain("1");
      expect(await pageText(document, 12)).toContain("12");
    } finally {
      await task.destroy();
    }
  });

  it("keeps the password fixture encrypted, so a reader must ask", async () => {
    const bytes = new Uint8Array(readFileSync(join(HERE, "password.pdf")));
    const source = Buffer.from(bytes).toString("latin1");
    expect(source).toContain("/Filter /Standard");
    expect(source).toContain("/R 2");
    await expect(PDFDocument.load(bytes)).rejects.toThrow(/encrypted/i);
  });

  it("opens the password fixture with the documented user password", async () => {
    const task = await openPdf("password.pdf", "reader");
    try {
      const document = await task.promise;
      expect(document.numPages).toBe(2);
    } finally {
      await task.destroy();
    }
  });

  it("rejects a wrong password with a PasswordException", async () => {
    const module = await pdfjs();
    const task = await openPdf("password.pdf", "wrong");
    const error = await task.promise.catch((thrown: unknown) => thrown);
    // INCORRECT_PASSWORD: the password was read and did not match.
    expect(error).toBeInstanceOf(module.PasswordException);
    expect((error as { code?: number }).code).toBe(2);
    await task.destroy().catch(() => undefined);
  });

  it("asks for a password when none is supplied", async () => {
    const module = await pdfjs();
    const task = await openPdf("password.pdf");
    const error = await task.promise.catch((thrown: unknown) => thrown);
    // NEED_PASSWORD: the document opens only after the reader supplies one.
    expect(error).toBeInstanceOf(module.PasswordException);
    expect((error as { code?: number }).code).toBe(1);
    await task.destroy().catch(() => undefined);
  });
});

describe("the Flowing EPUB", () => {
  it("is a zip whose mimetype entry comes first and is stored", async () => {
    const bytes = fixture("flowing.epub");
    const archive = await openZip(ranged(bytes), bytes.length);
    expect(archive.entries[0]).toMatchObject({ name: "mimetype", method: 0 });
    expect(await archive.readText("mimetype")).toBe("application/epub+zip");
  });

  it("names two spine chapters and carries hostile markup as data", async () => {
    const bytes = fixture("flowing.epub");
    const archive = await openZip(ranged(bytes), bytes.length);
    const opf = (await archive.readText("OEBPS/content.opf")) ?? "";
    expect(opf).toContain('<itemref idref="ch1"/>');
    expect(opf).toContain('<itemref idref="ch2"/>');
    const chapter = (await archive.readText("OEBPS/chapter1.xhtml")) ?? "";
    expect(chapter).toContain("The spice must flow");
    const hostile = (await archive.readText("OEBPS/chapter2.xhtml")) ?? "";
    expect(hostile).toContain("<script>");
    expect(hostile).toContain("onclick=");
    expect(hostile).toContain('src="https://example.com/embed"');
  });
});

describe("the fixed-layout EPUB and the encrypted one", () => {
  it("declares itself pre-paginated with one image per page", async () => {
    const bytes = fixture("fixed-layout.epub");
    const archive = await openZip(ranged(bytes), bytes.length);
    const opf = (await archive.readText("OEBPS/content.opf")) ?? "";
    expect(opf).toContain('<meta property="rendition:layout">pre-paginated</meta>');
    const page = (await archive.readText("OEBPS/page1.xhtml")) ?? "";
    expect(page).toContain('content="width=600, height=800"');
    expect(page).toContain('<img src="images/page1.png"');
  });

  it("keeps the encrypted EPUB refusing to open with DRM", async () => {
    const bytes = fixture("encrypted.epub");
    const error = await openZip(ranged(bytes), bytes.length).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(ZipError);
    expect((error as ZipError).code).toBe("drm");
  });

  it("keeps the corrupt EPUB a zip with no directory", async () => {
    const bytes = fixture("corrupt.epub");
    const error = await openZip(ranged(bytes), bytes.length).catch((thrown: unknown) => thrown);
    expect((error as ZipError).code).toBe("corrupt");
  });
});

describe("the CBZ", () => {
  it("holds eight pages in natural file-name order", async () => {
    const bytes = fixture("pages.cbz");
    const archive = await openZip(ranged(bytes), bytes.length);
    const pages = archive.entries.map(({ name }) => name).filter((name) => name.endsWith(".png"));
    expect(pages).toEqual(Array.from({ length: 8 }, (_, index) => `page-${index + 1}.png`));
    const first = await archive.read("page-1.png");
    // A PNG signature, so the Frame can turn the entry into a blob image.
    expect(Array.from(first.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });
});

describe("the FB2", () => {
  it("keeps its title, two sections, and an embedded cover", () => {
    const source = utf8.decode(fixture("story.fb2"));
    expect(source).toContain("<book-title>Notes from the Archive</book-title>");
    expect(source.match(/<section>/g)).toHaveLength(2);
    expect(source).toContain("The archive keeps every draft.");
    expect(source).toContain('<binary id="cover.png" content-type="image/png">');
  });
});

describe("the MOBI-family headers", () => {
  /** The PalmDB type, the MOBI version, and the PalmDOC encryption flag. */
  function palmHeader(name: string) {
    const bytes = fixture(name);
    // Record 0 starts where the PalmDB's first record offset points.
    const record = u32be(bytes, 78);
    const type = latin1.decode(bytes.slice(60, 68));
    const version = u32be(bytes, record + 36);
    const encryption = u16be(bytes, record + 12);
    const recordCount = u16be(bytes, 76);
    return { type, version, encryption, recordCount };
  }

  it("writes a readable MOBI 6 with one unencrypted text record", () => {
    expect(palmHeader("story.mobi")).toMatchObject({
      type: "BOOKMOBI",
      version: 6,
      encryption: 0,
      recordCount: 2,
    });
    const text = utf8.decode(fixture("story.mobi"));
    expect(text).toContain("The desert keeps its own record of the journey.");
  });

  it("marks drm.mobi's text as encrypted", () => {
    expect(palmHeader("drm.mobi")).toMatchObject({
      type: "BOOKMOBI",
      version: 6,
      encryption: 2,
    });
  });

  it("marks story.azw3 KF8, so Reader reports it damaged without INDX tables", () => {
    expect(palmHeader("story.azw3")).toMatchObject({ type: "BOOKMOBI", version: 8 });
    // No INDX record: the pointer the KF8 reader needs stays empty.
    const bytes = fixture("story.azw3");
    expect(u32be(bytes, u32be(bytes, 78) + 244)).toBe(0xffffffff);
  });
});

describe("the bench image fixtures", () => {
  it.each([
    ["buildImageEpub", buildImageEpub],
    ["buildLargeComicBook", buildLargeComicBook],
  ])("%s builds a zip of twenty page images over 10 MB", async (_name, build) => {
    const bytes = new Uint8Array(build());
    const archive = await openZip(ranged(bytes), bytes.length);
    expect(archive.entries.filter(({ name }) => name.endsWith(".png"))).toHaveLength(20);
    expect(bytes.length).toBeGreaterThan(10_000_000);
  });
});
