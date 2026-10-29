/**
 * Reader's lazy loaders for the vendored rendering libraries (#653). The
 * Frame's content security policy forbids Workers and relative module imports
 * (docs/plugins/frame-ui.md, Restrictions), and the Plugin's own Worker may
 * start `blob:` Workers. So every library ships inside the Plugin entry as a
 * raw source string, evaluated only when a Document of its format opens:
 *
 * - pdf.js core (`pdf.worker.min.mjs`): {@link startPdfCore} starts a nested
 *   module Worker from a `blob:` bootstrap that imports the core's `blob:` URL.
 *   The Plugin Worker owns it and transfers a MessagePort to it, bridging that
 *   port to the Frame so a long parse never blocks the broker.
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
  /**
   * The nested Worker running the pdf.js core. Post it one
   * `{ kind: "maibuk:pdf-port", port }` message (transferred) to give the core
   * the MessagePort the Frame holds the other end of.
   */
  worker: Worker;
  /** Terminates the Worker and releases every `blob:` URL it created. */
  dispose(): void;
}

/**
 * Starts pdf.js's core in a nested Worker of the Plugin Worker. The sandbox
 * allows `worker-src blob:`, so both the core module and a tiny bootstrap that
 * imports it travel as Blobs. The bootstrap gives the core a MessagePort the
 * Plugin Worker transfers, instead of letting the core listen on its own
 * global: the Frame needs a port of its own to talk to the core.
 *
 * The bootstrap is a module Worker so it can `import` the core's `blob:` URL.
 * `pdf.worker.min.mjs` also self-initializes on `self`; that handler ignores
 * messages aimed at the port, so both the automatic handler and the one the
 * bootstrap installs can coexist harmlessly.
 */
export function startPdfCore(): PdfCore {
  const coreUrl = URL.createObjectURL(new Blob([pdfWorker], { type: "text/javascript" }));
  const bootstrap = [
    `import { WorkerMessageHandler } from ${JSON.stringify(coreUrl)};`,
    "self.onmessage = (event) => {",
    "  const data = event.data;",
    '  if (!data || typeof data !== "object" || data.kind !== "maibuk:pdf-port") return;',
    "  const port = data.port;",
    "  if (!port) return;",
    "  WorkerMessageHandler.initializeFromPort(port);",
    "  port.start();",
    "};",
  ].join("\n");
  const bootstrapUrl = URL.createObjectURL(new Blob([bootstrap], { type: "text/javascript" }));
  const worker = new Worker(bootstrapUrl, { type: "module" });
  return {
    worker,
    dispose() {
      worker.terminate();
      URL.revokeObjectURL(bootstrapUrl);
      URL.revokeObjectURL(coreUrl);
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
