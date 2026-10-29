/**
 * The foliate-js parser modules Reader needs, gathered into one entry
 * (issue #653). `scripts/vendor-reader.mjs` bundles this file into
 * `foliate-parsers.min.mjs`, a single self-contained ESM module the Frame
 * imports from a `blob:` URL: foliate's own modules import each other
 * relatively, and a relative specifier cannot resolve inside an opaque-origin
 * `blob:` module (docs/plugins/frame-ui.md, Restrictions).
 *
 * Parser modules only: `paginator.js`, `fixed-layout.js`, and `view.js` render
 * into nested iframes and read `contentDocument`, which the Frame's
 * `sandbox="allow-scripts"` forbids. See `../README.md` for provenance.
 *
 * The vendored modules are plain JavaScript with no type declarations, so each
 * re-export carries a `@ts-expect-error` for the missing types.
 */

// @ts-expect-error -- vendored plain JavaScript, no type declarations
export { EPUB } from "./epub.js";
// @ts-expect-error -- vendored plain JavaScript, no type declarations
export { MOBI, isMOBI } from "./mobi.js";
// @ts-expect-error -- vendored plain JavaScript, no type declarations
export { makeFB2 } from "./fb2.js";
// @ts-expect-error -- vendored plain JavaScript, no type declarations
export { makeComicBook } from "./comic-book.js";
// @ts-expect-error -- vendored plain JavaScript, no type declarations
export * as CFI from "./epubcfi.js";
// @ts-expect-error -- vendored plain JavaScript, no type declarations
export { search } from "./search.js";
// `mobi.js` decompresses its embedded fonts through a caller-supplied zlib
// inflater; the bundle carries one so the Frame needs no second module.
export { unzlibSync } from "fflate";
