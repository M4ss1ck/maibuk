# Reader fixtures

Small files the Reader tests read (#653): PDFs, EPUBs, a comic book, an FB2,
and MOBI/AZW3 books. They carry no third-party content — no embedded fonts, no
photos, and only words written for these tests — so each file is a few kilobytes
of hand-written bytes and stays readable in a diff.

| File                | What it holds                                                                 |
| ------------------- | ----------------------------------------------------------------------------- |
| `twelve-pages.pdf`  | 12 pages, each drawing its page number (`1`..`12`) in Helvetica, an outline with three chapters and one nested section, and page labels `i`, `ii`, `1`..`10` |
| `password.pdf`      | 2 blank pages behind PDF's Standard security handler, revision 2 (RC4-40): user password `reader`, owner password `maibuk` |
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
them. The security handler follows the Standard algorithms: the password is
padded with its own bytes first and then the spec's padding string, the file key
hashes the padded password, `/O`, `/P` as four little-endian bytes, and the
first file identifier, and `/O` and `/U` are RC4 results under keys from those
hashes. It fixes every timestamp and identifier so a second run leaves the
working tree unchanged. `qpdf` is not needed and is not installed.
`fixtures.test.ts` runs the script into a temporary `scripts/` + `fixtures/`
pair, checks the committed bytes still match its output, and reads each file
structurally: through `pdf-lib` and the Reader's own `openZip` for PDFs and
archives, and through the PalmDB headers for the MOBI family.

The PalmDB, PalmDOC, and MOBI headers store every number big-endian, while the
zip records store theirs little-endian; the generator and the tests both follow
each format's own byte order.

The script lives in `scripts/` rather than here because the Plugin tooling's
import boundary refuses Node builtins in every non-test file, and a root
`scripts/` folder is the one place it never walks.

## How the tests parse the PDFs

`fixtures.test.ts` parses both PDFs with the vendored pdf.js (`vendor/pdfjs/`,
pdfjs-dist 6.4.299), the engine Reader runs. The browser build normally wants a
Worker and a DOM, so the test supplies what Node lacks: it imports
`vendor/pdfjs/polyfills.min.js` first (the core-js bundle for the `Uint8Array`
methods Node lacks), points `GlobalWorkerOptions.workerSrc` at
`vendor/pdfjs/pdf.worker.min.mjs` so pdf.js can start its fake Worker, and
aliases `self` on `globalThis`. With that, `getDocument` opens `password.pdf`
with `reader`, reports its two pages, rejects a wrong password and a missing one
with a `PasswordException`, and reads page 3's `(3) Tj` off `twelve-pages.pdf`.
`pdf-lib` still checks the structural facts: the page count, outline, page
labels, and that `password.pdf` is encrypted.

The book formats are parsed for real, in jsdom, by the Frame tests: `frame.test.ts`
for PDFs and `frame-books.test.ts` for the EPUB, CBZ, FB2, and MOBI files, against
foliate's bundled parsers.
