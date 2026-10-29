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
 * - DOMPurify: {@link purifySource} is its browser ESM build, which the Frame
 *   imports from a `blob:` URL and uses to sanitize every archive's markup.
 *
 * The Vite build has no code splitting, so these strings sit in the entry as
 * string literals; importing this module starts nothing.
 *
 * Provenance and licences: `./vendor/README.md`. Regenerate with
 * `node scripts/vendor-reader.mjs`.
 */

import foliateParsersSource from "./vendor/foliate/foliate-parsers.min.mjs?raw";
import domPurifySource from "./vendor/dompurify/purify.es.mjs?raw";
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
 * pdf.js ships its core as an ES module, but a module Worker cannot start from
 * a `blob:` URL inside the Plugin Worker: the Worker is created from a `blob:`
 * URL in the sandbox frame's opaque origin, and Chromium refuses a module
 * Worker's script fetch from there (it fails to load with no error text), while
 * a classic Worker loads the same URL. The core reaches its own handler through
 * `globalThis.pdfjsWorker`, so only its two module-only constructs have to go:
 * the trailing `export{…}` (a classic script cannot export) and `import.meta`
 * (a syntax error there), which only computes a base URL the wasm decoder glue
 * then ignores.
 */
export function classicPdfCoreSource(source: string): string {
  return source
    .replace(/\bexport\s*\{[^}]*\}\s*;?\s*$/, "")
    .replace(/\bimport\.meta\.url\b/g, "self.location.href");
}

/**
 * Starts pdf.js's core in a nested Worker of the Plugin Worker. The sandbox
 * allows `worker-src blob:`, so both the core and a tiny classic bootstrap that
 * `importScripts` it travel as Blobs. The bootstrap gives the core a MessagePort
 * the Plugin Worker transfers, instead of letting the core listen on its own
 * global: the Frame needs a port of its own to talk to the core.
 */
export function startPdfCore(): PdfCore {
  const coreUrl = URL.createObjectURL(
    new Blob([classicPdfCoreSource(pdfWorker)], { type: "text/javascript" })
  );
  const bootstrap = [
    `importScripts(${JSON.stringify(coreUrl)});`,
    "self.onmessage = (event) => {",
    "  const data = event.data;",
    '  if (!data || typeof data !== "object" || data.kind !== "maibuk:pdf-port") return;',
    "  const port = data.port;",
    "  if (!port) return;",
    "  self.pdfjsWorker.WorkerMessageHandler.initializeFromPort(port);",
    "  port.start();",
    "};",
  ].join("\n");
  const bootstrapUrl = URL.createObjectURL(new Blob([bootstrap], { type: "text/javascript" }));
  const worker = new Worker(bootstrapUrl);
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

/** DOMPurify's browser ESM build, for the Frame to import from a `blob:` URL. */
export function purifySource(): string {
  return domPurifySource;
}
