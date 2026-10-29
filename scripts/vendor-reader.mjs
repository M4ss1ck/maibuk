#!/usr/bin/env node
// Vendors Reader's rendering libraries into plugins/maibuk-reader/vendor/
// (issue #653): pdf.js (core worker, display, text-layer CSS) and the foliate-js
// parser modules, plus a self-contained bundle of the parsers the Frame can
// import from a blob: URL. Run it with `node scripts/vendor-reader.mjs`; the
// output is committed, so a second run leaves the working tree unchanged.
//
// The Frame's content security policy forbids Workers and relative module
// imports (docs/plugins/frame-ui.md), so every library ships as source text the
// Plugin carries as `?raw` strings and evaluates only when a Document opens.
// See plugins/maibuk-reader/vendor/README.md for provenance and licences.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

/** The pdf.js release Reader pins. */
export const PDFJS_VERSION = "6.4.299";

/** The foliate-js commit Reader pins. */
export const FOLIATE_COMMIT = "78914aef4466eb960965702401634c2cb348e9b1";

/** The `npm pack pdfjs-dist@6.4.299` tarball, pinned so a changed package fails loudly. */
export const PDFJS_TARBALL_SHA256 =
  "86269b40170eb41740ea05ad2102d71d33de4f122b34eb2f478be0ea7779c415";

/**
 * The foliate-js files Reader vendors, each pinned by SHA-256 so a commit that
 * no longer serves these bytes fails loudly. `epubcfi.js` is imported by
 * `epub.js`; the rest are self-contained.
 */
export const FOLIATE_FILES = {
  "comic-book.js": "7f3bf77561ca77300d5244015fcb1f73805787db246928074dc49fb56c88762e",
  "epub.js": "dfe347495039e9b5991478986ec6b7713cf9efbcd8f475a77ef7b967c5176298",
  "epubcfi.js": "e1a688ad5c84bf31f33cef467f92c7a6d060a0f17ec37c1d3c048e9c7b1cf645",
  "fb2.js": "09a7890bf191f1b6c6dd435fae2868b86c75e73e00731b0051c02f2a998a180a",
  LICENSE: "b621ffc351fe263bc9b09dd0bc1c9332fda9c462a3904c1e4f0b4d3236b9c28c",
  "mobi.js": "016526df13a9f11ee6671a8c74346e1cf41fe6bdfe50165fdcbf744f015694f3",
  "search.js": "31e846bdc095a645de0e94f7baa2c9e136561a363a2f774d4032e72cfa1fb0ef",
};

/** The repo root, from this script's own location (`scripts/`). */
const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "../..");

/** Where the vendored files land. */
export const VENDOR_DIR = join(REPO_ROOT, "plugins/maibuk-reader/vendor");

/** The foliate bundle's entry, bundled into `foliate-parsers.min.mjs`. */
const FOLIATE_ENTRY = join(VENDOR_DIR, "foliate/bundle.ts");

/** The single ESM module the Frame imports for every reflowable format. */
export const FOLIATE_BUNDLE = join(VENDOR_DIR, "foliate/foliate-parsers.min.mjs");

/** The SHA-256 of some bytes, lowercase hex. */
function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Writes `bytes` to `path` only when they differ, so a rerun keeps mtimes still. */
function writeIfChanged(path, bytes) {
  const next = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (existsSync(path) && readFileSync(path).equals(next)) return false;
  writeFileSync(path, next);
  return true;
}

/** Downloads `url`, failing loudly on a non-200 or on a hash mismatch. */
async function download(url, expectedSha256) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = sha256(bytes);
  if (actual !== expectedSha256) {
    throw new Error(`${url}: expected SHA-256 ${expectedSha256}, got ${actual}`);
  }
  return bytes;
}

/** `npm pack pdfjs-dist@<version>` in a temp dir, verified against the pinned hash. */
function packPdfjs(tempDir) {
  execFileSync(
    "npm",
    ["pack", `pdfjs-dist@${PDFJS_VERSION}`, "--pack-destination", tempDir, "--loglevel=error"],
    { cwd: tempDir, stdio: ["ignore", "ignore", "inherit"] }
  );
  const tarball = readdirSync(tempDir).find((name) => name.endsWith(".tgz"));
  if (tarball === undefined) throw new Error(`npm pack wrote no tarball into ${tempDir}`);
  const path = join(tempDir, tarball);
  const bytes = readFileSync(path);
  const actual = sha256(bytes);
  if (actual !== PDFJS_TARBALL_SHA256) {
    throw new Error(
      `pdfjs-dist@${PDFJS_VERSION}: expected SHA-256 ${PDFJS_TARBALL_SHA256}, got ${actual}`
    );
  }
  execFileSync("tar", ["-xzf", path, "-C", tempDir], { stdio: "inherit" });
  return join(tempDir, "package");
}

/** Copies pdf.js's worker, display module, text-layer CSS, and licence into `vendor/pdfjs/`. */
function vendorPdfjs(packageDir, outDir) {
  mkdirSync(outDir, { recursive: true });
  const files = [
    ["build/pdf.worker.min.mjs", "pdf.worker.min.mjs"],
    ["build/pdf.min.mjs", "pdf.min.mjs"],
    ["web/pdf_viewer.css", "pdf_viewer.css.txt"],
    ["LICENSE", "LICENSE"],
  ];
  for (const [from, to] of files) {
    copyFileSync(join(packageDir, from), join(outDir, to));
  }
}

/** Downloads the foliate-js parser modules and licence at the pinned commit. */
async function vendorFoliate(outDir) {
  mkdirSync(outDir, { recursive: true });
  for (const [name, expectedSha256] of Object.entries(FOLIATE_FILES)) {
    const url = `https://raw.githubusercontent.com/johnfactotum/foliate-js/${FOLIATE_COMMIT}/${name}`;
    writeIfChanged(join(outDir, name), await download(url, expectedSha256));
  }
}

/** Bundles `bundle.ts` into one minified, self-contained ESM string module. */
async function bundleFoliate() {
  const result = await build({
    configFile: false,
    logLevel: "warn",
    publicDir: false,
    build: {
      write: false,
      minify: "esbuild",
      emptyOutDir: false,
      lib: {
        entry: FOLIATE_ENTRY,
        formats: ["es"],
        fileName: () => "foliate-parsers.min",
      },
      rollupOptions: { external: [] },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  const chunk = outputs
    .flatMap((output) => ("output" in output ? output.output : []))
    .find((file) => file.type === "chunk");
  if (chunk === undefined || !("code" in chunk)) {
    throw new Error("the foliate bundle produced no chunk");
  }
  writeIfChanged(FOLIATE_BUNDLE, `${chunk.code.trimEnd()}\n`);
}

async function main() {
  const tempDir = mkdtempSync(join(tmpdir(), "maibuk-vendor-reader-"));
  try {
    vendorPdfjs(packPdfjs(tempDir), join(VENDOR_DIR, "pdfjs"));
    await vendorFoliate(join(VENDOR_DIR, "foliate"));
    await bundleFoliate();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
  console.log(`vendored pdf.js ${PDFJS_VERSION} and foliate-js ${FOLIATE_COMMIT.slice(0, 12)}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
