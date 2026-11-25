/**
 * The Reader Frame's Document metadata and cover (#941): the title, author,
 * page count, and one small JPEG cover the Frame posts to the Worker once per
 * open (`meta`). A PDF reads them from pdf.js's document info and first page;
 * a document reads them from foliate's metadata and `getCover()`, or, for a
 * CBZ, from its first image.
 *
 * The engine reads the open Document through the accessors `entry.ts` supplies,
 * so it sees the same `pdfDoc`, `currentDocument`, format, and comic page list
 * the moved module-level functions read, and it owns the send-once flag that
 * `reset()` clears when the Frame opens another Document.
 *
 * Like the rest of `frame/`, this is inlined into one classic script; it may
 * import only Frame-local modules.
 */

/** The Document's own title, author, page count, and optional cover. */
interface FrameMetaMessage {
  kind: "meta";
  title?: string;
  author?: string;
  pageCount?: number;
  coverDataUrl?: string;
}

/** The widest a cover is drawn before JPEG encoding. */
const COVER_MAX_WIDTH = 240;
/** The largest cover data URL the Worker keeps. */
const COVER_MAX_BYTES = 50 * 1024;

/** One pdf.js page, as far as its cover render reads it. */
export interface PdfPageLike {
  getViewport(options: { scale: number }): { width: number; height: number };
  render(options: {
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
  }): { promise?: Promise<unknown> } | null | undefined;
}

/** The pdf.js Document as far as its metadata and first-page cover read it. */
export interface PdfDocumentLike {
  numPages: number;
  getMetadata(): Promise<unknown>;
  getPage(pageNumber: number): Promise<PdfPageLike>;
}

/** The foliate Document as far as its metadata and cover read it. */
export interface FoliateDocumentLike {
  metadata?: { title?: unknown; author?: unknown } | null;
  sections: ArrayLike<unknown>;
  getCover?(): Promise<Blob>;
}

/** The accessors `entry.ts` gives the engine over the open Document. */
export interface FrameMetaDeps {
  /** Sends one message to the Worker. */
  post(message: unknown): void;
  /** The open pdf.js Document, or null. */
  pdf(): PdfDocumentLike | null;
  /** The open foliate Document, or null. */
  document(): FoliateDocumentLike | null;
  /** The open Document's format (`cbz`, `epub`, `mobi`, …). */
  format(): string;
  /** A CBZ's page names, in reading order. */
  comicFiles(): string[];
  /** The archive a CBZ's first page is read from. */
  archive: { bytes(name: string): Promise<Uint8Array> };
  /** Whether the Document turns whole pages, so its section count is a page count. */
  isPageMode(): boolean;
  /** The media type for one archive entry's name. */
  mediaTypeFor(name: string): string;
}

/** The metadata and cover the Frame posts, and the reset the next open needs. */
export interface FrameMeta {
  /** Posts a PDF's metadata and cover; sends once per open. */
  send(): Promise<void>;
  /** Posts a document's metadata and cover; sends once per open. */
  sendDocument(): Promise<void>;
  /** The PDF's first page as a small JPEG data URL, or null. */
  cover(): Promise<string | null>;
  /** The document's own cover as a small JPEG data URL, or null. */
  documentCover(): Promise<string | null>;
  /** Clears the send-once flag, as opening another Document does. */
  reset(): void;
}

/** A metadata value as plain text: a string, a language map, or contributors. */
function textOf(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return (value as unknown[])
      .map(textOf)
      .filter((part) => part !== "")
      .join(", ");
  }
  if (value && typeof value === "object") {
    if ("name" in value) return textOf((value as { name: unknown }).name);
    const values = Object.values(value as Record<string, unknown>);
    if (values.length > 0) return textOf(values[0]);
  }
  return "";
}

/** The pdf.js `info` dictionary, or an empty one when pdf.js carries none. */
async function metadataInfo(pdf: PdfDocumentLike): Promise<Record<string, unknown>> {
  try {
    const metadata = await pdf.getMetadata();
    if (metadata && typeof metadata === "object" && "info" in metadata) {
      const info = (metadata as { info?: unknown }).info;
      if (info && typeof info === "object") return info as Record<string, unknown>;
    }
  } catch {
    /* A PDF may carry no info dictionary at all. */
  }
  return {};
}

/** A cover image as a small JPEG data URL, or null. */
async function coverDataUrl(blob: Blob): Promise<string | null> {
  let bitmap: ImageBitmap | HTMLImageElement | null = null;
  try {
    if (typeof createImageBitmap === "function") {
      bitmap = await createImageBitmap(blob);
    } else {
      bitmap = await loadImage(blob);
    }
  } catch {
    return null;
  }
  if (!bitmap) return null;
  const width = bitmap.width || 1;
  const height = bitmap.height || 1;
  const scale = Math.min(1, COVER_MAX_WIDTH / Math.max(1, width));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(width * scale));
  canvas.height = Math.max(1, Math.floor(height * scale));
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  let url = "";
  try {
    url = canvas.toDataURL("image/jpeg", 0.7);
  } catch {
    return null;
  }
  if (typeof url !== "string" || !url.startsWith("data:image/jpeg")) return null;
  if (url.length > COVER_MAX_BYTES) return null;
  return url;
}

/** Decodes an image Blob through an `<img>`, for platforms without `createImageBitmap`. */
function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("The cover image will not decode"));
    };
    image.src = url;
  });
}

/**
 * The metadata engine over the open Document: it reads the title, author, page
 * count, and cover through `deps` and posts them once per open.
 */
export function createMeta(deps: FrameMetaDeps): FrameMeta {
  let metaSent = false;

  async function cover(): Promise<string | null> {
    const pdf = deps.pdf();
    if (!pdf) return null;
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(1, COVER_MAX_WIDTH / Math.max(1, base.width));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const context = canvas.getContext("2d");
    if (!context) return null;
    const task = page.render({ canvasContext: context, viewport });
    if (task && task.promise) await task.promise;
    let url = "";
    try {
      url = canvas.toDataURL("image/jpeg", 0.7);
    } catch {
      return null;
    }
    if (typeof url !== "string" || !url.startsWith("data:image/jpeg")) return null;
    if (url.length > COVER_MAX_BYTES) return null;
    return url;
  }

  async function documentCover(): Promise<string | null> {
    const doc = deps.document();
    if (!doc) return null;
    let blob: Blob | null = null;
    try {
      if (deps.format() === "cbz") {
        const name = deps.comicFiles()[0];
        const bytes = await deps.archive.bytes(name);
        blob = new Blob([bytes as BlobPart], { type: deps.mediaTypeFor(name) });
      } else if (typeof doc.getCover === "function") {
        blob = await doc.getCover();
      }
    } catch {
      return null;
    }
    if (!(blob instanceof Blob)) return null;
    return await coverDataUrl(blob);
  }

  async function send(): Promise<void> {
    const pdf = deps.pdf();
    if (metaSent || !pdf) return;
    metaSent = true;
    const info = await metadataInfo(pdf);
    const message: FrameMetaMessage = { kind: "meta", pageCount: pdf.numPages };
    if (typeof info.Title === "string" && info.Title.trim() !== "") message.title = info.Title;
    if (typeof info.Author === "string" && info.Author.trim() !== "") message.author = info.Author;
    try {
      const dataUrl = await cover();
      if (dataUrl !== null) message.coverDataUrl = dataUrl;
    } catch {
      /* A cover is optional. */
    }
    deps.post(message);
  }

  async function sendDocument(): Promise<void> {
    const doc = deps.document();
    if (metaSent || !doc) return;
    metaSent = true;
    const metadata = doc.metadata || {};
    const message: FrameMetaMessage = { kind: "meta" };
    const title = textOf(metadata.title);
    const author = textOf(metadata.author);
    if (title !== "") message.title = title;
    if (author !== "") message.author = author;
    if (deps.isPageMode()) message.pageCount = doc.sections.length;
    try {
      const dataUrl = await documentCover();
      if (dataUrl !== null) message.coverDataUrl = dataUrl;
    } catch {
      /* A cover is optional. */
    }
    deps.post(message);
  }

  function reset(): void {
    metaSent = false;
  }

  return { send, sendDocument, cover, documentCover, reset };
}
