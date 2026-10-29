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

/** A started pdf.js core and the way to give its resources back. */
export interface PdfCore {
  /**
   * The pdf.js core's message sink. Post it one
   * `{ kind: "maibuk:pdf-port", port }` message (transferred) to give the core
   * the MessagePort the Frame holds the other end of. Shipped, it is a nested
   * Worker; the bench spike's inline mode answers in this Worker instead.
   */
  worker: { postMessage(message: unknown, transfer?: Transferable[]): void };
  /** Terminates the Worker (nested) and releases every `blob:` URL it created. */
  dispose(): void;
}

/**
 * The manifest-free flag the threading spike's harness sets on its Plugin
 * Worker to run the pdf.js core inline (issue #653, "Threading spike"). The
 * app never sets it, so a shipped Reader always gets the nested Worker.
 */
export const PDF_CORE_INLINE_FLAG = "__maibukDebugPdfCoreInline";

/** Whether the spike's flag asks for the inline core. */
export function pdfCoreInlineRequested(): boolean {
  return (globalThis as Record<string, unknown>)[PDF_CORE_INLINE_FLAG] === true;
}

/** Options for {@link startPdfCore}; the shipped call passes none. */
export interface PdfCoreOptions {
  /** Run the core in this Worker instead of a nested Worker (bench spike). */
  inline?: boolean;
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
 * The threading spike's inline core (issue #653): the pdf.js core runs in the
 * Plugin Worker itself, loaded with the same classic `importScripts` the nested
 * Worker uses, and answers the Frame's port there. It exists only so
 * `bench:reader --spike` can measure what a long parse does to the Plugin
 * Worker's replies. Nothing ships it: the flag that selects it is set by the
 * bench, and no app code sets it. A dynamic `import()` of a `blob:` URL is not
 * an option here: the Plugin host refuses any dynamic import whose argument is
 * not a string literal (src/features/plugins/modules.ts), so the Plugin would
 * not load at all.
 */
function startInlinePdfCore(): PdfCore {
  const coreUrl = URL.createObjectURL(
    new Blob([classicPdfCoreSource(pdfWorker)], { type: "text/javascript" })
  );
  let loaded = false;
  return {
    worker: {
      postMessage(message: unknown) {
        const data = message as { kind?: unknown; port?: MessagePort } | null;
        if (!data || data.kind !== "maibuk:pdf-port" || !data.port) return;
        const scope = globalThis as unknown as {
          importScripts(url: string): void;
          pdfjsWorker: { WorkerMessageHandler: { initializeFromPort(port: MessagePort): void } };
        };
        if (!loaded) {
          loaded = true;
          scope.importScripts(coreUrl);
        }
        scope.pdfjsWorker.WorkerMessageHandler.initializeFromPort(data.port);
        data.port.start();
      },
    },
    dispose() {
      URL.revokeObjectURL(coreUrl);
    },
  };
}

/**
 * Starts pdf.js's core in a nested Worker of the Plugin Worker. The sandbox
 * allows `worker-src blob:`, so both the core and a tiny classic bootstrap that
 * `importScripts` it travel as Blobs. The bootstrap gives the core a MessagePort
 * the Plugin Worker transfers, instead of letting the core listen on its own
 * global: the Frame needs a port of its own to talk to the core.
 *
 * The inline mode is the spike's only; with no option and no flag this is the
 * shipped nested Worker.
 */
export function startPdfCore(options: PdfCoreOptions = {}): PdfCore {
  if (options.inline ?? pdfCoreInlineRequested()) return startInlinePdfCore();
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
