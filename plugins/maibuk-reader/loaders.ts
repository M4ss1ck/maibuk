/**
 * Reader's lazy loaders for the vendored rendering libraries (#653). The
 * Frame's content security policy forbids Workers and relative module imports
 * (docs/plugins/frame-ui.md, Restrictions), and the Plugin's own Worker may
 * start `blob:` Workers. So every library ships inside the Plugin entry as a
 * raw source string, evaluated only when a Document of its format opens:
 *
 * - pdf.js core (`pdf.worker.min.mjs`): {@link startPdfCore} starts a nested
 *   Worker from a `blob:` of the source. The Plugin Worker owns it and bridges
 *   its port to the Frame, so a long parse never blocks the broker.
 * - pdf.js display (`pdf.min.mjs`) and the text-layer CSS: {@link pdfDisplaySource}
 *   and {@link pdfViewerCss} hand the strings to the Frame over the port, which
 *   imports them from a `blob:` URL (the Frame CSP allows `blob:` scripts).
 * - the foliate-js parsers: {@link foliateSource} is one self-contained ESM
 *   module, because foliate's modules import each other relatively and a
 *   `blob:` module in an opaque origin cannot resolve a relative specifier.
 *
 * The Vite build has no code splitting, so these strings sit in the entry as
 * string literals; importing this module starts nothing.
 *
 * Provenance and licences: `./vendor/README.md`. Regenerate with
 * `node scripts/vendor-reader.mjs`.
 */

import foliateParsersSource from "./vendor/foliate/foliate-parsers.min.mjs?raw";
import pdfDisplay from "./vendor/pdfjs/pdf.min.mjs?raw";
import pdfWorker from "./vendor/pdfjs/pdf.worker.min.mjs?raw";
import pdfViewerStyles from "./vendor/pdfjs/pdf_viewer.css.txt?raw";

/** A started pdf.js core Worker and the way to give its resources back. */
export interface PdfCore {
  /** The nested Worker running `pdf.worker.min.mjs`; bridge its port to the Frame. */
  worker: Worker;
  /** Terminates the Worker and releases the `blob:` URL. */
  dispose(): void;
}

/**
 * Starts pdf.js's core in a nested Worker of the Plugin Worker. The sandbox
 * allows `worker-src blob:`, so the source travels as a Blob rather than as a
 * relative module the Worker global could not resolve.
 */
export function startPdfCore(): PdfCore {
  const url = URL.createObjectURL(new Blob([pdfWorker], { type: "text/javascript" }));
  const worker = new Worker(url, { type: "module" });
  return {
    worker,
    dispose() {
      worker.terminate();
      URL.revokeObjectURL(url);
    },
  };
}

/** The pdf.js display module's source, for the Frame to import from a `blob:` URL. */
export function pdfDisplaySource(): string {
  return pdfDisplay;
}

/** pdf.js's viewer CSS, which carries the text layer rules the Page view needs. */
export function pdfViewerCss(): string {
  return pdfViewerStyles;
}

/** The foliate-js parsers as one self-contained ESM module, for the Frame. */
export function foliateSource(): string {
  return foliateParsersSource;
}
