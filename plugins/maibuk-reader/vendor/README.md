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

## Threading spike

Issue #653 asks whether a long pdf.js core parse inside the Plugin Worker delays
the Worker's broker replies enough to trip a Stopped Plugin limit, and so
whether the core must run in a nested Worker. The spike parses the bench's
50 MB, 96-page PDF two ways and records how long the Plugin Worker's message loop
stalls during the open.

- **Inline**: the core runs in the Plugin Worker (`startPdfCore({ inline: true })`,
  selected by `globalThis.__maibukDebugPdfCoreInline`, which only the bench sets
  in the Plugin Worker). It loads the core with the same classic `importScripts`
  the nested Worker uses. A dynamic `import()` of a `blob:` URL does not work
  here: the Plugin host refuses any non-literal dynamic import
  (`src/features/plugins/modules.ts`), and the Plugin then does not load.
- **Nested**: the shipped default. The core runs in its own Worker, started by
  the Plugin Worker.

**Measure.** `pnpm bench:reader --spike` (`e2e/reader-bench/spike.bench.ts`).
The Plugin Worker is the first `blob:` Worker the page creates. A 5 ms timer
inside it records how late each tick runs while the open is in progress (open
key press to page 1 shown). The stall is that lateness minus 5 ms.

**Not measured.** This is a proxy, not the broker round trip the issue names.
The host sends `health.check` only at start-up (`lifecycle.ts`), and no
periodic probe exists to time during a parse. A host probe would need new
instrumentation in `lifecycle.ts`, which this lane does not touch. The Worker's
loop stall is the delay a `health.check` reply would wait behind, so it bounds
the broker's reply delay from below. The closest limit found is the start-up
health timeout, `STARTUP_TIMEOUT_MS` (10 s, `runtime.ts`); the exact
"no answer" threshold of the Stopped Plugin read was not located.

**Results.** Date 2026-10-29. Repo `0d06dff9` with the uncommitted Reader
changes. Machine: 16 CPUs, AMD Ryzen 7 8700G w/ Radeon 780M Graphics (`nproc`
16, `/proc/cpuinfo` model name as above). Chromium headless under Playwright
1.64.1. Two runs of the same command, `pnpm bench:reader --spike`, printed:

| run | mode | first page (ms) | samples | max stall (ms) | p95 stall (ms) | blob Workers |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 1 | nested | 1190 | 237 | 6.6 | 0.1 | 2 |
| 1 | inline | 1258 | 239 | 46.4 | 0.3 | 1 |
| 2 | nested | 1223 | 244 | 5.4 | 0.1 | 2 |
| 2 | inline | 1266 | 241 | 46.9 | 0.2 | 1 |

Reading the numbers: inline stalls the Plugin Worker for up to about 47 ms in
one step of the parse, while nested stays under about 7 ms. Both p95 values
are near zero, so the tail is one event per open, not a steady slowdown. The
blob Worker count confirms the mode: nested starts two (the Plugin Worker and
the core), inline one. Neither run came near the 10 s start-up timeout, and the
numbers do not show an inline run causing a "no answer" stop. The nested
Worker stays the shipped default, which keeps the Plugin Worker's loop free of
parse steps at all; the margin it buys is about 40 ms here, and whether that
margin matters on a slower device was not measured (`bench:reader --spike`
on such a device would show it). Opening a 50 MB PDF is about 1.2 s on this
machine in both modes; the inline mode is about 40 to 45 ms slower to the
first page.
