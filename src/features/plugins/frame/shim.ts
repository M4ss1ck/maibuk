/**
 * The Frame's host document and its in-document shim (ADR 0021, D1, D4). The
 * Frame is the second UI path: an iframe with `sandbox="allow-scripts"` only
 * (opaque origin, never `allow-same-origin`) whose document is *this* fixed
 * host code, never Plugin bytes. The host posts one `frame-load` message with
 * the Plugin's verified files, and the shim turns them into `blob:` URLs
 * *inside* the Frame — a host-origin `blob:` URL is not loadable from an opaque
 * origin, which is why the bootstrap frame's blobs are made where they load
 * too. The host never parses Frame traffic; the Frame talks to its Worker only
 * through the transferred port exposed as `window.maibuk.port`.
 *
 * `frameShim` is a real function serialized into the `srcdoc` with
 * `Function.prototype.toString`, so it is unit-testable in jsdom by calling it
 * directly. It is therefore self-contained: it references nothing from this
 * module at runtime, and its message kinds are literals that the exported
 * constants below must match (a test asserts the generated document carries
 * them).
 */

import { hostDocument } from "@/features/plugins/frame/host-document";

/**
 * The Frame CSP (D4): the only sources are the Plugin's own verified set, as
 * `blob:` and `data:` resources, plus inline style. `script-src` needs
 * `'unsafe-inline'` for this shim; `blob:` is where the Frame's own URLs live.
 * `connect-src`, `frame-src`, and `worker-src` are `'none'`: a Frame reaches
 * no network, no nested frame, and starts no Worker; `form-action`, `base-uri`,
 * and `object-src` are `'none'` too.
 */
export const FRAME_CSP =
  "default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline' blob: data:; img-src blob: data:; font-src blob: data:; media-src blob: data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'";

/** Host to Frame: the one load message, carrying the hashed set and the tokens. */
export const FRAME_LOAD_MESSAGE = { kind: "frame-load" } as const;
/** Host to Frame: a live theme-token update; the shim applies it any time. */
export const FRAME_THEME_MESSAGE = { kind: "frame-theme" } as const;
/** Frame to host: the only message the host accepts from a Frame window. */
export const FRAME_READY_MESSAGE = { kind: "frame-ready" } as const;

/**
 * The shim the Frame document runs. It accepts messages only from
 * `window.parent`, one `frame-load` and any later `frame-theme`; creates the
 * Plugin's `blob:` URLs in-frame; rewrites relative CSS and HTML references;
 * defines a frozen `window.maibuk.port`; and posts `frame-ready`.
 */
export function frameShim(win: Window): void {
  // biome-ignore lint/suspicious/noRedundantUseStrict: serialized into a classic <script>, not redundant there.
  "use strict";
  const parent = win.parent;
  const doc = win.document;
  let blobUrls = new Map<string, string>();
  let loaded = false;

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }

  // A reference the Frame must neither rewrite nor load: an inline `data:` URL
  // or a bare fragment. These are allowed by the CSP and stay as written.
  function isInline(reference: string): boolean {
    return reference.startsWith("data:") || reference.startsWith("#");
  }

  // Resolves `specifier` against the folder-relative file `fromPath`; null when
  // it escapes the folder or is not a plain relative path.
  function resolvePath(fromPath: string, specifier: string): string | null {
    const segments = fromPath.split("/").slice(0, -1);
    for (const part of specifier.split("/")) {
      if (part === "" || part === ".") continue;
      if (part === "..") {
        if (segments.length === 0) return null;
        segments.pop();
        continue;
      }
      segments.push(part);
    }
    return segments.length === 0 ? null : segments.join("/");
  }

  // The blob URL of the file a relative reference names, or null. Inline
  // references are left alone; a remote or scheme reference is never resolvable.
  function blobUrlFor(fromPath: string, reference: string): string | null {
    if (reference === "" || isInline(reference)) return null;
    if (reference.startsWith("//") || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(reference)) return null;
    const target = resolvePath(fromPath, reference);
    return target === null ? null : (blobUrls.get(target) ?? null);
  }

  const urlPattern = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;

  // A style sheet: a relative `url()` becomes its blob URL; anything else is
  // left untouched so it fails closed under the CSP.
  function rewriteCss(css: string, cssPath: string): string {
    return css.replace(urlPattern, (match, _quote: string, reference: string) => {
      const url = blobUrlFor(cssPath, reference.trim());
      return url === null ? match : `url("${url}")`;
    });
  }

  // An inline `style` value: a relative `url()` becomes its blob URL; a
  // declaration whose reference cannot be resolved is dropped whole.
  function rewriteInlineStyle(style: string, basePath: string): string {
    const kept: string[] = [];
    for (const declaration of style.split(";")) {
      if (declaration.trim() === "") continue;
      let unresolved = false;
      const rewritten = declaration.replace(
        urlPattern,
        (match, _quote: string, reference: string) => {
          const url = blobUrlFor(basePath, reference.trim());
          if (url === null) {
            unresolved = true;
            return match;
          }
          return `url("${url}")`;
        }
      );
      if (!unresolved) kept.push(rewritten);
    }
    return kept.join(";");
  }

  // One URL-bearing attribute: an unresolvable reference is removed.
  function rewriteReference(element: Element, attribute: string, basePath: string): void {
    const reference = element.getAttribute(attribute);
    if (reference === null || isInline(reference)) return;
    const url = blobUrlFor(basePath, reference);
    if (url === null) element.removeAttribute(attribute);
    else element.setAttribute(attribute, url);
  }

  function decode(bytes: unknown): string {
    return new TextDecoder().decode(bytes as ArrayBufferView);
  }

  // Adopts a parsed head or body into the live document. A script is re-created
  // with `createElement` so it runs, in document order (`async=false`) and with
  // its `type` kept. A relative import inside a module script is *not*
  // supported: a `blob:` module cannot resolve relative specifiers in an opaque
  // origin, and reusing the host's module graph would need the lexer in-frame,
  // so it fails closed instead (docs/agents/utilities-and-components.md).
  function adopt(source: HTMLElement, target: HTMLElement): void {
    for (const child of Array.from(source.childNodes)) {
      if (child.nodeType === 1 && (child as Element).tagName.toLowerCase() === "script") {
        const original = child as Element;
        const script = doc.createElement("script");
        for (const attribute of Array.from(original.attributes)) {
          script.setAttribute(attribute.name, attribute.value);
        }
        script.textContent = original.textContent;
        script.async = false;
        target.appendChild(script);
      } else {
        target.appendChild(doc.importNode(child, true));
      }
    }
  }

  function rewriteHtml(htmlPath: string, html: string): void {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    for (const element of parsed.querySelectorAll("script[src]")) {
      rewriteReference(element, "src", htmlPath);
    }
    for (const element of parsed.querySelectorAll('link[rel="stylesheet"]')) {
      rewriteReference(element, "href", htmlPath);
    }
    for (const element of parsed.querySelectorAll("img[src], source[src], video[src], audio[src]")) {
      rewriteReference(element, "src", htmlPath);
    }
    for (const element of parsed.querySelectorAll("[style]")) {
      const style = element.getAttribute("style");
      if (style !== null) element.setAttribute("style", rewriteInlineStyle(style, htmlPath));
    }
    adopt(parsed.head, doc.head);
    adopt(parsed.body, doc.body);
  }

  function applyTokens(value: unknown): void {
    if (!isRecord(value)) return;
    for (const [name, raw] of Object.entries(value)) {
      if (typeof raw === "string") doc.documentElement.style.setProperty(name, raw);
    }
  }

  function createUrls(files: unknown[]): Map<string, string> {
    const urls = new Map<string, string>();
    for (const file of files) {
      if (!isRecord(file) || typeof file.path !== "string") continue;
      const type = typeof file.type === "string" ? file.type : "";
      urls.set(file.path, URL.createObjectURL(new Blob([file.bytes as BlobPart], { type })));
    }
    return urls;
  }

  function load(event: MessageEvent, message: Record<string, unknown>): void {
    const htmlPath = typeof message.html === "string" ? message.html : "";
    const files = Array.isArray(message.files) ? message.files : [];
    blobUrls = createUrls(files);
    // A style sheet is rewritten in-frame after the URLs exist, then its own
    // blob URL is replaced by one holding the rewritten text.
    for (const file of files) {
      if (!isRecord(file) || typeof file.path !== "string" || file.type !== "text/css") continue;
      const previous = blobUrls.get(file.path);
      if (previous !== undefined) URL.revokeObjectURL(previous);
      const rewritten = rewriteCss(decode(file.bytes), file.path);
      blobUrls.set(file.path, URL.createObjectURL(new Blob([rewritten], { type: "text/css" })));
    }
    applyTokens(message.tokens);
    const port = event.ports.length > 0 ? event.ports[0] : null;
    Object.defineProperty(win, "maibuk", {
      value: Object.freeze({ port }),
      writable: false,
      enumerable: true,
      configurable: false,
    });
    const htmlFile = files.find((file) => isRecord(file) && file.path === htmlPath);
    if (isRecord(htmlFile)) rewriteHtml(htmlPath, decode(htmlFile.bytes));
    parent.postMessage({ kind: "frame-ready" }, "*");
  }

  win.addEventListener("message", (event: MessageEvent) => {
    // Only the host window may talk to this frame.
    if (event.source !== parent) return;
    const message = event.data;
    if (!isRecord(message)) return;
    if (message.kind === "frame-theme") {
      applyTokens(message.tokens);
      return;
    }
    if (message.kind !== "frame-load" || loaded) return;
    loaded = true;
    load(event, message);
  });
}

/** The Frame's `srcdoc`: the CSP meta tag and the serialized shim, nothing else. */
export const FRAME_DOCUMENT = hostDocument(
  FRAME_CSP,
  `<script>
(${frameShim.toString()})(window);
</script>`
);
