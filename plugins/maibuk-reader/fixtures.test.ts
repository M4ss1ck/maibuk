/**
 * Reader's PDF fixtures (#653): the committed files must still be exactly what
 * `scripts/generate-fixtures.mjs` writes, and each must carry the structure the
 * Reader tests rely on — twelve pages with an outline and page labels, and a
 * password-protected Document. `pdf-lib` reads them here as an independent
 * parser; pdf.js's own core cannot run in Node without its `legacy` build,
 * which this repository does not vendor (`fixtures/README.md`).
 */

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { afterAll, describe, expect, it } from "vitest";

const HERE = join(__dirname, "fixtures");
const GENERATOR = join(__dirname, "scripts", "generate-fixtures.mjs");
const generated = mkdtempSync(join(tmpdir(), "maibuk-reader-fixtures-"));

afterAll(() => {
  rmSync(generated, { recursive: true, force: true });
});

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
  return {
    "twelve-pages.pdf": readFileSync(join(output, "twelve-pages.pdf")),
    "password.pdf": readFileSync(join(output, "password.pdf")),
  };
}

describe("the fixture generator", () => {
  it("writes byte-for-byte the files the tree commits", () => {
    const fresh = regenerate();
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

  it("keeps the password fixture encrypted, so a reader must ask", async () => {
    const bytes = new Uint8Array(readFileSync(join(HERE, "password.pdf")));
    const source = Buffer.from(bytes).toString("latin1");
    expect(source).toContain("/Filter /Standard");
    expect(source).toContain("/R 2");
    await expect(PDFDocument.load(bytes)).rejects.toThrow(/encrypted/i);
  });
});

describe.skip("pdf.js's own core parsing the fixtures", () => {
  it("runs in Node when a legacy build is vendored", () => {
    // Skipped: `vendor/pdfjs` carries pdfjs-dist's browser build only, and its
    // fake Worker cannot resolve its worker module in Node. See
    // `fixtures/README.md`.
  });
});
