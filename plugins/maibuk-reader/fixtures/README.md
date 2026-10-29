# Reader fixtures

Small files the Reader tests read (#653): PDFs, EPUBs, a comic book, an FB2,
and MOBI/AZW3 books. They carry no third-party content — no fonts, no photos,
and only words written for these tests — so each file is a few kilobytes of
hand-written bytes and stays readable in a diff.

| File                | What it holds                                                                 |
| ------------------- | ----------------------------------------------------------------------------- |
| `twelve-pages.pdf`  | 12 blank pages, an outline with three chapters and one nested section, and page labels `i`, `ii`, `1`..`10` |
| `password.pdf`      | 2 blank pages behind PDF's Standard security handler, revision 2, user password `reader` |
| `flowing.epub`      | A reflowable EPUB: two spine chapters, a style sheet, a cover, and markup that must never run (script, handler, form, iframe, `javascript:` link) |
| `fixed-layout.epub` | A pre-paginated EPUB: two 600×800 plates, one image each                        |
| `encrypted.epub`    | An EPUB whose content `META-INF/encryption.xml` protects: Reader must refuse it as DRM |
| `corrupt.epub`      | Bytes that start like a zip but carry no end-of-central-directory record        |
| `pages.cbz`         | Eight PNG pages, `page-1.png`..`page-8.png`, so natural file-name order matters |
| `story.fb2`         | A FictionBook with a title, two sections, and an embedded cover                 |
| `story.mobi`        | A MOBI 6 book: PalmDB + PalmDOC + MOBI headers, one uncompressed text record, no DRM |
| `drm.mobi`          | The same book with the PalmDOC encryption flag set                              |
| `story.azw3`        | A KF8 (version 8) file without the INDX tables a real KF8 needs, so Reader reports it damaged |

Regenerate them with:

```bash
node plugins/maibuk-reader/scripts/generate-fixtures.mjs
```

`generate-fixtures.mjs` writes every object itself: it implements MD5 and RC4 for
the PDF security handler, the zip container for the archives, and the PalmDB /
PalmDOC / MOBI headers, because Reader has no library dependency for any of
them. It fixes every timestamp and identifier so a second run leaves the working
tree unchanged. `qpdf` is not needed and is not installed. `fixtures.test.ts`
runs the script into a temporary `scripts/` + `fixtures/` pair, checks the
committed bytes still match its output, and reads each file structurally: through
`pdf-lib` and the Reader's own `openZip` for PDFs and archives, and through the
PalmDB headers for the MOBI family.

The PalmDB, PalmDOC, and MOBI headers store every number big-endian, while the
zip records store theirs little-endian; the generator and the tests both follow
each format's own byte order.

The script lives in `scripts/` rather than here because the Plugin tooling's
import boundary refuses Node builtins in every non-test file, and a root
`scripts/` folder is the one place it never walks.

## Why there is no real-parse test

The fixtures would ideally be parsed by pdf.js's own core in Node. That needs
pdf.js's `legacy` (Node) build; this repository vendors only the browser build
(`vendor/pdfjs/pdf.min.mjs` and `pdf.worker.min.mjs`, pdfjs-dist 6.4.299), which
cannot start its fake Worker or lay out a page in Node without a DOM. So the real
parse tests are skipped and `fixtures.test.ts` checks the files structurally
instead: page counts, outline, page labels, and the encryption dictionary, via
`pdf-lib`.

The book formats are parsed for real, in jsdom, by the Frame tests: `frame.test.ts`
for PDFs and `frame-books.test.ts` for the EPUB, CBZ, FB2, and MOBI files, against
foliate's bundled parsers.
