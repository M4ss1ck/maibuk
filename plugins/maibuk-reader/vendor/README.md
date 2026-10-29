# Vendored Reader libraries

Reader's Frame renders PDF, EPUB, MOBI, AZW3, FB2, and CBZ with two third-party
libraries, copied in here because the Frame's sandbox cannot load them the usual
way (issue #653). The Frame's content security policy forbids Workers and
relative module imports, and its origin is opaque (`docs/plugins/frame-ui.md`,
Restrictions). So every library ships inside the Plugin entry as a raw source
string, evaluated only when a Document of its format opens
(`../loaders.ts`):

- pdf.js's core runs in a nested Worker the Plugin Worker starts from a `blob:`
  of the worker source (the Plugin sandbox allows `worker-src blob:`).
- pdf.js's display module and viewer CSS travel to the Frame over the port, which
  imports the module from a `blob:` URL (`script-src blob:`).
- foliate-js's parser modules import each other relatively, and a `blob:` module
  in an opaque origin cannot resolve a relative specifier, so they are bundled
  into one self-contained ESM module at build time.

Do not edit the vendored files. Regenerate them with:

```bash
node scripts/vendor-reader.mjs
```

The script downloads both libraries, verifies every byte against a pinned
SHA-256, and rebuilds the foliate bundle. Its output is committed, so a second
run leaves the working tree unchanged.

## Provenance

| Library  | Version                                | Source                                                                                                     | Licence                              | Files                                                                                                                                                                                                 |
| -------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pdf.js   | 6.4.299 (`pdfjs-dist`)                 | https://www.npmjs.com/package/pdfjs-dist/v/6.4.299 (https://github.com/mozilla/pdf.js)                     | Apache-2.0, `pdfjs/LICENSE`          | `pdfjs/pdf.worker.min.mjs` (package `build/pdf.worker.min.mjs`), `pdfjs/pdf.min.mjs` (package `build/pdf.min.mjs`), `pdfjs/pdf_viewer.css.txt` (package `web/pdf_viewer.css`), `pdfjs/LICENSE`        |
| foliate-js | commit `78914aef4466eb960965702401634c2cb348e9b1` | https://github.com/johnfactotum/foliate-js/tree/78914aef4466eb960965702401634c2cb348e9b1 | MIT, `foliate/LICENSE`               | `foliate/epub.js`, `foliate/mobi.js`, `foliate/fb2.js`, `foliate/comic-book.js`, `foliate/epubcfi.js`, `foliate/search.js`, `foliate/LICENSE`, `foliate/bundle.ts`, `foliate/foliate-parsers.min.mjs` |

`pdfjs/pdf_viewer.css.txt` is pdf.js's `web/pdf_viewer.css` under a `.txt`
extension, so Vite hands the Plugin the file's bytes as a `?raw` string instead
of treating it as a stylesheet; the whole file is kept so the text layer rules
arrive with it.

`foliate/bundle.ts` is the only hand-written file here: it re-exports the parser
surface Reader needs (`EPUB`, `MOBI`, `isMOBI`, `makeFB2`, `makeComicBook`,
`CFI`, `search`). `foliate/foliate-parsers.min.mjs` is its minified, bundled
output. Parser modules only: foliate's `paginator.js`, `fixed-layout.js`, and
`view.js` render into nested iframes and read `contentDocument`, which the
Frame's `sandbox="allow-scripts"` forbids.

fflate and DOMPurify, which the reading surface also uses, are ordinary Maibuk
dependencies and are imported normally, not vendored here.
