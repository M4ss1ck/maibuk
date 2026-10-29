# Reader fixtures

Small PDFs the Reader tests read (#653). They carry no third-party content —
no fonts, images, or text — so each file is a few kilobytes of hand-written
objects and stays readable in a diff.

| File               | What it holds                                                                   |
| ------------------ | ------------------------------------------------------------------------------- |
| `twelve-pages.pdf` | 12 blank pages, an outline with three chapters and one nested section, and page labels `i`, `ii`, `1`..`10` |
| `password.pdf`     | 2 blank pages behind PDF's Standard security handler, revision 2, user password `reader` |

Regenerate them with:

```bash
node plugins/maibuk-reader/scripts/generate-fixtures.mjs
```

`generate-fixtures.mjs` writes every object itself: it implements MD5 and RC4 for
the security handler because Reader has no PDF library dependency, and it fixes
the file identifier so a second run leaves the working tree unchanged. `qpdf` is
not needed and is not installed. `fixtures.test.ts` runs the script into a
temporary `scripts/` + `fixtures/` pair and checks the committed bytes still
match its output.

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
