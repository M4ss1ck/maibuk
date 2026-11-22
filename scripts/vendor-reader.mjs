#!/usr/bin/env node
// Vendors Reader's rendering libraries into plugins/maibuk-reader/vendor/
// (issue #653): pdf.js (core worker, display, text-layer CSS) and the foliate-js
// parser modules, plus a self-contained bundle of the parsers the Frame can
// import from a blob: URL, and the core-js polyfills pdf.js needs on the oldest
// engine Reader supports (READER_ENGINE_FLOOR). Run it with `node scripts/vendor-reader.mjs`; the
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
import coreJsCompat from "core-js-compat";
import { build } from "vite";

/** The pdf.js release Reader pins. */
export const PDFJS_VERSION = "6.5.438";

/** The foliate-js commit Reader pins. */
export const FOLIATE_COMMIT = "78914aef4466eb960965702401634c2cb348e9b1";

/** The `npm pack pdfjs-dist@6.5.438` tarball, pinned so a changed package fails loudly. */
export const PDFJS_TARBALL_SHA256 =
  "7461aefcd27c4ef0dd76f9ca5760f09466eb6b3f934432670c12132e7b3d6faa";

/**
 * The oldest engine Reader runs pdf.js on, as core-js-compat targets. Maibuk
 * supports Android 8 onwards, and Chrome 138 is the last Android System WebView
 * Android 8 and 9 receive (Chrome 139 dropped them). pdf.js's modern build
 * calls some newer APIs unguarded, so the polyfills that engine lacks ship with
 * it; core-js installs each one only where the engine has no working native.
 */
export const READER_ENGINE_FLOOR = { chrome: "138", android: "138" };

/** pdf.js's iterator helper calls on a Map or Set iterator, as core-js modules. */
const ITERATOR_HELPERS = [
  ["map", "map"],
  ["filter", "filter"],
  ["find", "find"],
  ["some", "some"],
  ["every", "every"],
  ["toArray", "to-array"],
  ["reduce", "reduce"],
  ["forEach", "for-each"],
  ["flatMap", "flat-map"],
  ["take", "take"],
  ["drop", "drop"],
];

/** The Set methods of ES2025, as core-js modules. */
const SET_METHODS = [
  ["union", "union"],
  ["intersection", "intersection"],
  ["difference", "difference"],
  ["symmetricDifference", "symmetric-difference"],
  ["isSubsetOf", "is-subset-of"],
  ["isSupersetOf", "is-superset-of"],
  ["isDisjointFrom", "is-disjoint-from"],
];

/**
 * Each recent API pdf.js may call, as the pattern that finds a call in its
 * minified source and the core-js modules that polyfill it. A call pdf.js
 * guards itself (`Float16Array` behind `FeatureTest`) is left out. A false
 * match costs only a polyfill core-js skips at runtime; a missing row is the
 * risk, so a pdf.js update reviews this table against its release notes.
 */
export const PDFJS_RECENT_APIS = [
  [/\bPromise\.try\b/, ["es.promise.try"]],
  [/\bPromise\.withResolvers\b/, ["es.promise.with-resolvers"]],
  [/\bPromise\.allSettled\b/, ["es.promise.all-settled"]],
  [
    /\.getOrInsertComputed\(/,
    ["es.map.get-or-insert-computed", "es.weak-map.get-or-insert-computed"],
  ],
  [/\.getOrInsert\(/, ["es.map.get-or-insert", "es.weak-map.get-or-insert"]],
  [/\bMath\.sumPrecise\b/, ["es.math.sum-precise"]],
  [/\bUint8Array\.fromBase64\b/, ["es.uint8-array.from-base64"]],
  [/\bUint8Array\.fromHex\b/, ["es.uint8-array.from-hex"]],
  [/\.setFromBase64\(/, ["es.uint8-array.set-from-base64"]],
  [/\.setFromHex\(/, ["es.uint8-array.set-from-hex"]],
  [/\.toBase64\(/, ["es.uint8-array.to-base64"]],
  [/\.toHex\(/, ["es.uint8-array.to-hex"]],
  [/\bIterator\b/, ["es.iterator.constructor"]],
  [/\bIterator\.from\b/, ["es.iterator.from"]],
  ...ITERATOR_HELPERS.map(([method, module]) => [
    new RegExp(`\\.(?:values|keys|entries)\\(\\)\\.${method}\\(`),
    ["es.iterator.constructor", `es.iterator.${module}`],
  ]),
  ...SET_METHODS.map(([method, module]) => [
    new RegExp(`\\.${method}\\(`),
    [`es.set.${module}.v2`],
  ]),
  [/\bArray\.fromAsync\b/, ["es.array.from-async"]],
  [/\.findLast(?:Index)?\(/, ["es.array.find-last", "es.array.find-last-index"]],
  [/\bObject\.groupBy\b/, ["es.object.group-by"]],
  [/\bMap\.groupBy\b/, ["es.map.group-by"]],
  [/\bURL\.parse\b/, ["web.url.parse"]],
  [/\bURL\.canParse\b/, ["web.url.can-parse"]],
];

/**
 * The core-js modules pdf.js's `sources` need on {@link READER_ENGINE_FLOOR},
 * sorted: the recent APIs they call, less those core-js-compat says the floor
 * engine already has.
 */
export function pdfjsPolyfillModules(sources) {
  const used = new Set(
    PDFJS_RECENT_APIS.filter(([pattern]) => sources.some((source) => pattern.test(source))).flatMap(
      ([, modules]) => modules
    )
  );
  return coreJsCompat({ targets: READER_ENGINE_FLOOR, modules: [...used] }).list.sort();
}

/** The entry module's text for `modules`. */
export function polyfillEntrySource(modules) {
  return [
    "// Generated by scripts/vendor-reader.mjs from pdf.js's sources and",
    "// READER_ENGINE_FLOOR. Do not edit; rerun the script.",
    ...modules.map((module) => `import "core-js/modules/${module}.js";`),
    "",
  ].join("\n");
}

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

/** The polyfill entry, generated from {@link pdfjsPolyfillModules}. */
export const POLYFILL_ENTRY = join(VENDOR_DIR, "pdfjs/polyfills.ts");

/** The polyfills as one classic script, prepended to both pdf.js sources. */
export const POLYFILL_BUNDLE = join(VENDOR_DIR, "pdfjs/polyfills.min.js");

/** The core-js release the polyfill bundle is built from (its `package.json`). */
const CORE_JS_VERSION = JSON.parse(
  readFileSync(join(REPO_ROOT, "node_modules/core-js/package.json"), "utf8")
).version;

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

/** Bundles `entry` into one minified, self-contained chunk of `format` and returns its code. */
async function bundle(entry, format, fileName) {
  const result = await build({
    configFile: false,
    logLevel: "warn",
    publicDir: false,
    build: {
      write: false,
      minify: "esbuild",
      emptyOutDir: false,
      lib: {
        entry,
        formats: [format],
        name: "maibukReaderPolyfills",
        fileName: () => fileName,
      },
      rollupOptions: { external: [] },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  const chunk = outputs
    .flatMap((output) => ("output" in output ? output.output : []))
    .find((file) => file.type === "chunk");
  if (chunk === undefined || !("code" in chunk)) {
    throw new Error(`the ${fileName} bundle produced no chunk`);
  }
  return chunk.code.trimEnd();
}

/** Bundles `bundle.ts` into one minified, self-contained ESM string module. */
async function bundleFoliate() {
  writeIfChanged(FOLIATE_BUNDLE, `${await bundle(FOLIATE_ENTRY, "es", "foliate-parsers.min")}\n`);
}

/**
 * Writes the polyfill entry for the vendored pdf.js and bundles it into one
 * classic script with no exports, so it runs as the head of both the core's
 * classic script and the display module.
 */
async function bundlePolyfills() {
  const sources = ["pdf.min.mjs", "pdf.worker.min.mjs"].map((name) =>
    readFileSync(join(VENDOR_DIR, "pdfjs", name), "utf8")
  );
  writeIfChanged(POLYFILL_ENTRY, polyfillEntrySource(pdfjsPolyfillModules(sources)));
  const code = await bundle(POLYFILL_ENTRY, "iife", "polyfills.min");
  const banner = `/*! core-js ${CORE_JS_VERSION} | MIT | https://github.com/zloirock/core-js */`;
  writeIfChanged(POLYFILL_BUNDLE, `${banner}\n${code}\n`);
  copyFileSync(
    join(REPO_ROOT, "node_modules/core-js/LICENSE"),
    join(VENDOR_DIR, "pdfjs/core-js.LICENSE")
  );
}

async function main() {
  const tempDir = mkdtempSync(join(tmpdir(), "maibuk-vendor-reader-"));
  try {
    vendorPdfjs(packPdfjs(tempDir), join(VENDOR_DIR, "pdfjs"));
    await vendorFoliate(join(VENDOR_DIR, "foliate"));
    await bundleFoliate();
    await bundlePolyfills();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
  console.log(
    `vendored pdf.js ${PDFJS_VERSION}, foliate-js ${FOLIATE_COMMIT.slice(0, 12)}, core-js ${CORE_JS_VERSION}`
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
