/**
 * The Frame host side (ADR 0021, D1, D4): builds the Frame iframe and the one
 * `frame-load` message the shim consumes. The Frame is a visible sibling of the
 * hidden bootstrap frame, with a `title` for its accessible name and no
 * `aria-hidden`/`inert`; the host never parses Frame traffic.
 *
 * `buildFrameLoadMessage` reads the *verified* hashed folder and keeps only the
 * files a Frame may load — HTML, CSS, JS/MJS, images, fonts, and media, never
 * the manifest — with a MIME type from the extension. The bytes are cloned into
 * the message (nothing to transfer); the MessagePort is transferred separately
 * when the host posts it.
 */

import { createSandboxElement } from "@/features/plugins/frame/host-document";
import { FRAME_DOCUMENT, FRAME_LOAD_MESSAGE } from "@/features/plugins/frame/shim";
import { normalizeRelativePath } from "@/features/plugins/relative-path";
import type { PluginFolderFile } from "@/features/plugins/types";

/** One file a Frame may load, with its bytes and the MIME type of its extension. */
export interface FrameLoadFile {
  path: string;
  type: string;
  bytes: Uint8Array;
}

/** The host to Frame `frame-load` message. */
export interface FrameLoadMessage {
  kind: typeof FRAME_LOAD_MESSAGE.kind;
  /** The Plugin-folder-relative path of the page's HTML document. */
  html: string;
  files: FrameLoadFile[];
  /** Public `--maibuk-*` tokens; U4 fills them, an empty record is valid now. */
  tokens: Record<string, string>;
}

/** Refused because the page's declared HTML is not a loadable file in the set. */
export class FrameLoadError extends Error {
  readonly code = "frame-missing" as const;
  readonly path: string;

  constructor(path: string) {
    super(`The Frame page "${path}" is not a loadable HTML file in the Plugin folder`);
    this.name = "FrameLoadError";
    this.path = path;
  }
}

// The extension → MIME map of every file kind a Frame may load.
const FRAME_MIME_TYPES: Record<string, string> = {
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  js: "text/javascript",
  mjs: "text/javascript",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  eot: "application/vnd.ms-fontobject",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  opus: "audio/opus",
  mp4: "video/mp4",
  webm: "video/webm",
  ogv: "video/ogg",
  mov: "video/quicktime",
};

// The manifest is never loadable, whatever extension handling grows later.
const MANIFEST_BASENAME = "manifest.json";

/**
 * The MIME type a Frame serves this path as, or null when a Frame may not load
 * it (the manifest, or any extension outside the map).
 */
export function frameMimeType(path: string): string | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (name === MANIFEST_BASENAME) return null;
  const dot = name.lastIndexOf(".");
  if (dot < 0) return null;
  return FRAME_MIME_TYPES[name.slice(dot + 1).toLowerCase()] ?? null;
}

/**
 * Builds the one `frame-load` message for a page's HTML. Throws
 * `FrameLoadError` when `framePath` is not an HTML file in the set, so a Frame
 * can never be handed a path the host did not verify.
 */
export function buildFrameLoadMessage(
  files: readonly PluginFolderFile[],
  framePath: string,
  tokens: Record<string, string> = {}
): FrameLoadMessage {
  // The manifest validator accepts a leading `./` and checks the normalized
  // path, so match the same normalized path here or a validating manifest
  // renders broken. The shim looks the HTML up by this normalized path too.
  const html = normalizeRelativePath(framePath);
  const payload: FrameLoadFile[] = [];
  let frameIncluded = false;
  for (const file of files) {
    const type = frameMimeType(file.path);
    if (type === null) continue;
    if (file.path === html && type === "text/html") frameIncluded = true;
    payload.push({ path: file.path, type, bytes: file.bytes });
  }
  if (!frameIncluded) throw new FrameLoadError(html);
  return { kind: FRAME_LOAD_MESSAGE.kind, html, files: payload, tokens };
}

/**
 * Creates the Frame iframe, visible and named. The caller appends it; the host
 * posts `frame-load` to `element.contentWindow` once the document loads and
 * waits for `frame-ready`.
 */
export function createFrameElement(doc: Document, options: { title: string }): HTMLIFrameElement {
  const element = createSandboxElement(doc);
  element.title = options.title;
  element.style.cssText = "position:relative;display:block;width:100%;height:100%;border:0";
  element.srcdoc = FRAME_DOCUMENT;
  return element;
}
