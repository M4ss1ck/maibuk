/**
 * The Shelf Frame's cover jobs (#948): an imported Document lands on the Shelf
 * with a generated cover, and the Worker then hands the Shelf Frame one
 * `cover-job` at a time. The Frame owns parsing, so it opens that Document with
 * the engines it reads with (pdf.js for a PDF, foliate's parsers for the rest),
 * draws the cover through the metadata engine (`meta.ts`), and answers with
 * `cover`. Every read the job makes carries its `documentId`, so the Worker
 * answers it from that Document's File Grant, not the open Document's.
 *
 * Any failure answers with no cover: the row keeps its generated one, and
 * opening the Document still looks for the real one. A later job or an `open`
 * cancels the running job, which then answers nothing.
 *
 * Like the rest of `frame/`, this is inlined into one classic script; it may
 * import only Frame-local modules.
 */

import { createArchive, FB2_MAX_BYTES } from "./archive";
import { comicPages } from "./comic";
import { createMeta, type FoliateDocumentLike, type PdfDocumentLike } from "./meta";
import { RANGE_CHUNK_BYTES, type PdfJsModule } from "./pdf";
import type { FrameCoverJobMessage, FrameZipEntryData } from "./protocol";
import type { FrameZipEntry } from "./types";

/** The protocol requests and engine imports a cover job reads through. */
export interface FrameCoverDeps {
  /** Sends one message to the Worker. */
  post(message: unknown): void;
  requestBytes(offset: number, length: number, documentId: string): Promise<Uint8Array>;
  requestZipList(documentId: string): Promise<{ entries: FrameZipEntry[] }>;
  requestZipEntry(name: string, documentId: string): Promise<FrameZipEntryData>;
  /** foliate's parsers, from the source the job carries. */
  importFoliate(source: string): Promise<unknown>;
  /** pdf.js's display module, from the source the job carries. */
  importPdfjs(source: string): Promise<PdfJsModule>;
  /** The media type for one archive entry's name. */
  mediaTypeFor(name: string): string;
}

/** The cover jobs one Shelf Frame runs, one at a time. */
export interface FrameCovers {
  /** Draws the job's cover and answers the Worker, cancelling any job still running. */
  run(job: FrameCoverJobMessage): Promise<void>;
  /** Stops the running job; it answers nothing. */
  cancel(): void;
}

/** foliate's parsers, as far as a cover reads them. */
interface FoliateModule {
  EPUB: new (loader: unknown) => FoliateDocumentLike & { init(): Promise<unknown> };
  MOBI: new (options: {
    unzlib: unknown;
  }) => {
    open(file: unknown): Promise<FoliateDocumentLike>;
  };
  makeFB2(blob: Blob): Promise<FoliateDocumentLike>;
  unzlibSync: unknown;
}

/** A Document a cover job opened, as far as it is closed again. */
interface Closable {
  destroy?(): unknown;
}

/** Closes something a job opened, ignoring a close that throws. */
function close(target: Closable | null | undefined): void {
  try {
    void target?.destroy?.();
  } catch {
    /* Closing is best effort. */
  }
}

/** The cover jobs over the protocol client: one at a time, cancelled by the next. */
export function createCovers(deps: FrameCoverDeps): FrameCovers {
  let generation = 0;
  // Each import evaluates the module from a new `blob:` URL, and an evaluated
  // module is never freed, so a Frame imports each engine once for every job.
  let pdfjsModule: Promise<PdfJsModule> | null = null;
  let foliateModule: Promise<FoliateModule> | null = null;
  /** Releases what the running job opened. */
  let release: (() => void) | null = null;

  function releaseJob(): void {
    const releasing = release;
    release = null;
    releasing?.();
  }

  function cancel(): void {
    generation += 1;
    releaseJob();
  }

  /** A metadata engine over one job's Document, so its cover draws as an open one's does. */
  function metaFor(options: {
    format: string;
    pdf?: PdfDocumentLike;
    document?: FoliateDocumentLike;
    comicFiles?: string[];
    archive?: { bytes(name: string): Promise<Uint8Array> };
  }) {
    return createMeta({
      post: () => {},
      pdf: () => options.pdf ?? null,
      document: () => options.document ?? null,
      format: () => options.format,
      comicFiles: () => options.comicFiles ?? [],
      archive: options.archive ?? { bytes: () => Promise.reject(new Error("No archive")) },
      isPageMode: () => false,
      mediaTypeFor: deps.mediaTypeFor,
    });
  }

  /** A PDF's first page, rendered over the job's own pdf.js core. */
  async function pdfCover(job: FrameCoverJobMessage, isCurrent: () => boolean) {
    const { documentId, size } = job;
    if (!job.pdf || !job.pdfPort || size <= 0) return null;
    const port = job.pdfPort;
    pdfjsModule ??= deps.importPdfjs(job.pdf.displaySource);
    const pdfjs = await pdfjsModule.catch((error: unknown) => {
      pdfjsModule = null;
      throw error;
    });
    if (!isCurrent()) return null;
    port.start();
    const worker = new pdfjs.PDFWorker({ port });
    release = () => close(worker);
    const initial = await deps.requestBytes(0, Math.min(size, RANGE_CHUNK_BYTES), documentId);
    if (!isCurrent()) return null;
    const transport = new pdfjs.PDFDataRangeTransport(size, initial);
    transport.requestDataRange = (begin: number, end: number) => {
      void deps
        .requestBytes(begin, Math.min(end - begin, RANGE_CHUNK_BYTES), documentId)
        .then((bytes) => transport.onDataRange(begin, bytes))
        .catch(() => {
          /* A refused range fails the render; the job answers with no cover. */
        });
    };
    const task = pdfjs.getDocument({
      range: transport,
      worker,
      isEvalSupported: false,
      disableAutoFetch: true,
      disableStream: true,
      rangeChunkSize: RANGE_CHUNK_BYTES,
    });
    // A password-protected PDF keeps its generated cover; nobody is asked.
    task.onPassword = () => close(task);
    release = () => {
      close(task);
      close(worker);
    };
    const pdf = await task.promise;
    if (!isCurrent()) return null;
    return metaFor({ format: "pdf", pdf }).cover();
  }

  /** Any other format's own cover, through foliate's parsers or a CBZ's first page. */
  async function documentCover(job: FrameCoverJobMessage, isCurrent: () => boolean) {
    const { documentId, format, size } = job;
    if (typeof job.foliate !== "string") return null;
    foliateModule ??= deps.importFoliate(job.foliate) as Promise<FoliateModule>;
    const foliate = await foliateModule.catch((error: unknown) => {
      foliateModule = null;
      throw error;
    });
    if (!isCurrent()) return null;
    const archive = createArchive({
      requestZipList: () => deps.requestZipList(documentId),
      requestZipEntry: (name) => deps.requestZipEntry(name, documentId),
    });
    let opened: (FoliateDocumentLike & Closable) | null = null;
    release = () => {
      close(opened);
      archive.revoke();
    };
    let comicFiles: string[] = [];
    if (format === "epub") {
      await archive.open();
      const book = new foliate.EPUB(archive.loader());
      opened = book;
      await book.init();
    } else if (format === "cbz") {
      await archive.open();
      comicFiles = comicPages(archive.entries());
      if (comicFiles.length === 0) return null;
      opened = { sections: comicFiles };
    } else if (format === "fb2") {
      if (size <= 0 || size > FB2_MAX_BYTES) return null;
      const bytes = await deps.requestBytes(0, size, documentId);
      opened = await foliate.makeFB2(new Blob([bytes as BlobPart], { type: "application/xml" }));
    } else if (format === "mobi" || format === "azw3") {
      const mobi = new foliate.MOBI({ unzlib: foliate.unzlibSync });
      opened = await mobi.open(fileOver(documentId, size));
    } else {
      return null;
    }
    if (!isCurrent()) {
      close(opened);
      return null;
    }
    return metaFor({ format, document: opened, comicFiles, archive }).documentCover();
  }

  /** A File-like object whose `slice` reads the job's Document through the Worker. */
  function fileOver(documentId: string, size: number) {
    return {
      name: "document.mobi",
      size,
      slice(start: number, end?: number) {
        const from = Math.max(0, Math.floor(start));
        const to = Math.min(size, end === undefined ? size : Math.floor(end));
        return {
          async arrayBuffer() {
            const bytes = await deps.requestBytes(from, Math.max(0, to - from), documentId);
            return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
          },
        };
      },
    };
  }

  async function run(job: FrameCoverJobMessage): Promise<void> {
    cancel();
    const current = generation;
    const isCurrent = () => current === generation;
    let coverDataUrl: string | null = null;
    try {
      coverDataUrl =
        job.format === "pdf" ? await pdfCover(job, isCurrent) : await documentCover(job, isCurrent);
    } catch {
      coverDataUrl = null;
    }
    if (!isCurrent()) return;
    releaseJob();
    deps.post(
      coverDataUrl === null
        ? { kind: "cover", documentId: job.documentId }
        : { kind: "cover", documentId: job.documentId, coverDataUrl }
    );
  }

  return { run, cancel };
}
