// @ts-check
/* Sanitizing and rewriting one EPUB section (#653). Book markup is untrusted:
   it may carry scripts, handlers, forms, frames, or URLs that reach the
   network, and the archive's own images, styles, and fonts are files the Frame
   asks the Worker for. This classic script (loaded before `reader.js`) does the
   two jobs in the Frame: DOMPurify strips everything dangerous, then every
   remaining relative reference is turned into a `blob:` URL from the archive.

   It is a separate file so the rules are testable on their own: the tests load
   it with `new Function(source)()` and hand it a DOMPurify instance. It never
   touches the port or the reading UI. */

(() => {
  // biome-ignore lint/suspicious/noRedundantUseStrict: the Frame loads this file as a classic script, not a module.
  "use strict";

  /** The tags that can execute, submit, embed, or restyle the whole Frame. */
  const FORBID_TAGS = [
    "script",
    "iframe",
    "frame",
    "frameset",
    "object",
    "embed",
    "applet",
    "form",
    "input",
    "button",
    "textarea",
    "select",
    "option",
    "optgroup",
    "base",
    "meta",
  ];

  /**
   * The URL schemes an attribute may keep: `blob:` and `data:` for images the
   * Frame already made, and relative references for archive files. Any other
   * scheme, `javascript:` above all, is dropped by DOMPurify.
   */
  const ALLOWED_URI_REGEXP = /^(?:(?:blob|data):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i;

  /** A reference that reaches the network: `http:`, `https:`, or `//host`. */
  const EXTERNAL_PATTERN = /^(?:https?:)?\/\//i;

  /** A reference that runs code when followed. */
  const SCRIPT_PATTERN = /^(?:javascript|vbscript):/i;

  /** A scheme prefix, which a relative archive path never carries. */
  const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;

  /** Widths of the reading column, in `em`, for each Reader setting. */
  const LINE_WIDTHS = { narrow: "30em", medium: "38em", wide: "48em" };

  /** @param {string} value @returns {boolean} */
  function isExternal(value) {
    const trimmed = value.trim();
    return EXTERNAL_PATTERN.test(trimmed) || /^https?:/i.test(trimmed);
  }

  /** @param {string} value @returns {boolean} */
  function isScriptUrl(value) {
    return SCRIPT_PATTERN.test(value.replace(/[\u0000-\u0020]/g, ""));
  }

  /**
   * The archive path `reference` names from the file at `base`, or null when it
   * is external, a `data:`/`blob:` URL, empty, or only a fragment.
   * @param {string} base
   * @param {string} reference
   * @returns {string | null}
   */
  function resolvePath(base, reference) {
    const trimmed = reference.trim();
    if (trimmed === "" || trimmed.startsWith("#")) return null;
    if (isExternal(trimmed) || isScriptUrl(trimmed)) return null;
    if (SCHEME_PATTERN.test(trimmed) && !/^[a-z]:[\\/]/i.test(trimmed)) return null;
    const withoutHash = trimmed.split("#")[0];
    let decoded = withoutHash;
    try {
      decoded = decodeURI(withoutHash);
    } catch {
      decoded = withoutHash;
    }
    const directory = base.slice(0, base.lastIndexOf("/") + 1);
    const segments = decoded.startsWith("/")
      ? decoded.slice(1).split("/")
      : (directory + decoded).split("/");
    /** @type {string[]} */
    const parts = [];
    for (const segment of segments) {
      if (segment === "" || segment === ".") continue;
      if (segment === "..") parts.pop();
      else parts.push(segment);
    }
    return parts.join("/");
  }

  /**
   * Removes an attribute that would reach the network or run code, and filters
   * `srcset` candidate by candidate. Relative URLs stay for the rewrite pass.
   * @param {Element} element
   * @param {string} name
   */
  function scrubAttribute(element, name) {
    const value = element.getAttribute(name);
    if (value === null) return;
    if (isScriptUrl(value) || isExternal(value)) {
      element.removeAttribute(name);
      return;
    }
    if (name === "srcset") {
      const kept = value
        .split(",")
        .map((candidate) => candidate.trim())
        .filter((candidate) => candidate !== "")
        .filter((candidate) => {
          const url = candidate.split(/\s+/)[0];
          return !isExternal(url) && !isScriptUrl(url);
        });
      if (kept.length === 0) element.removeAttribute("srcset");
      else element.setAttribute("srcset", kept.join(", "));
    }
  }

  /**
   * Strips external `@import`s and `url()`s from a style sheet or inline style,
   * leaving relative references for {@link rewriteCss}.
   * @param {string} css
   * @returns {string}
   */
  function scrubCss(css) {
    return css
      .replace(/@import\s+(?:url\(\s*)?["']?([^"')\s]+)["']?\s*\)?[^;]*;?/gi, (match, url) =>
        isExternal(url) || isScriptUrl(url) ? "" : match
      )
      .replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (match, _quote, url) =>
        isExternal(url) || isScriptUrl(url) ? 'url("")' : match
      );
  }

  /**
   * Strips everything the Frame must never run or fetch, in place. Protocol
   * relative and external URLs go first, because DOMPurify would let some of
   * them through, then DOMPurify removes scripts, handlers, forms, and frames.
   * @param {Document} doc
   * @param {{ sanitize: (node: Node, options?: Record<string, unknown>) => unknown }} purify
   * @returns {Document}
   */
  function sanitizeDocument(doc, purify) {
    for (const element of Array.from(doc.querySelectorAll("[src], [href], [poster], [data]"))) {
      for (const name of ["src", "href", "poster", "data"]) scrubAttribute(element, name);
    }
    for (const element of Array.from(doc.querySelectorAll("[srcset]"))) {
      scrubAttribute(element, "srcset");
    }
    for (const element of Array.from(doc.querySelectorAll("image, use"))) {
      const href = element.getAttributeNS("http://www.w3.org/1999/xlink", "href");
      if (href === null) continue;
      if (isExternal(href) || isScriptUrl(href))
        element.removeAttributeNS("http://www.w3.org/1999/xlink", "href");
    }
    for (const element of Array.from(doc.querySelectorAll("[style]"))) {
      const style = element.getAttribute("style");
      if (style !== null) element.setAttribute("style", scrubCss(style));
    }
    for (const style of Array.from(doc.querySelectorAll("style"))) {
      if (style.textContent !== null) style.textContent = scrubCss(style.textContent);
    }
    // An XHTML section parsed as XML has no `body` property; sanitize the
    // document element in that case, and the whole section stays untrusted.
    const target = doc.body || doc.querySelector("body") || doc.documentElement;
    purify.sanitize(target, {
      IN_PLACE: true,
      FORBID_TAGS,
      ALLOWED_URI_REGEXP,
      ALLOW_DATA_ATTR: true,
      KEEP_CONTENT: true,
    });
    return doc;
  }

  /** @param {string} path @returns {string} */
  function mediaTypeFor(path) {
    const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
    if (extension === "png") return "image/png";
    if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
    if (extension === "gif") return "image/gif";
    if (extension === "webp") return "image/webp";
    if (extension === "svg") return "image/svg+xml";
    if (extension === "css") return "text/css";
    if (extension === "woff") return "font/woff";
    if (extension === "woff2") return "font/woff2";
    if (extension === "ttf") return "font/ttf";
    if (extension === "otf") return "font/otf";
    return "application/octet-stream";
  }

  /**
   * Replaces every relative `url()` in `css` with the `blob:` URL the archive
   * hands back for it. `data:` and `blob:` URLs pass through; a reference that
   * resolves to nothing becomes `url("")`, so the rule fails closed.
   * @param {string} css
   * @param {{ base: string, assetUrl: (path: string, type: string) => Promise<string | null> }} options
   * @returns {Promise<string>}
   */
  async function rewriteCss(css, options) {
    const pattern = /url\(\s*(["']?)([^"')]+)\1\s*\)/gi;
    /** @type {RegExpExecArray[]} */
    const matches = [];
    let match = pattern.exec(css);
    while (match !== null) {
      matches.push(match);
      match = pattern.exec(css);
    }
    let result = css;
    for (const found of matches.reverse()) {
      const url = found[2].trim();
      let replacement = 'url("")';
      if (/^(?:data|blob):/i.test(url)) {
        replacement = found[0];
      } else {
        const path = resolvePath(options.base, url);
        if (path !== null) {
          const resolved = await options.assetUrl(path, mediaTypeFor(path));
          if (resolved !== null) replacement = `url("${resolved}")`;
        }
      }
      const start = found.index;
      result = result.slice(0, start) + replacement + result.slice(start + found[0].length);
    }
    return result;
  }

  /**
   * Turns every relative reference in a sanitized section into a `blob:` URL
   * from the archive, and inlines its linked style sheets as `<style>` elements
   * so the shadow root scopes them. The caller owns the returned object URLs.
   * @param {Document} doc
   * @param {{
   *   base: string,
   *   assetUrl: (path: string, type: string) => Promise<string | null>,
   *   assetText: (path: string) => Promise<string | null>,
   * }} options
   * @returns {Promise<void>}
   */
  async function rewriteDocument(doc, options) {
    const { base, assetUrl, assetText } = options;
    const targets = Array.from(
      doc.querySelectorAll("img[src], source[src], audio[src], video[src], [poster]")
    );
    for (const element of targets) {
      for (const name of ["src", "poster"]) {
        const value = element.getAttribute(name);
        if (value === null || /^(?:data|blob):/i.test(value)) continue;
        const path = resolvePath(base, value);
        if (path === null) {
          element.removeAttribute(name);
          continue;
        }
        const resolved = await assetUrl(path, mediaTypeFor(path));
        if (resolved === null) element.removeAttribute(name);
        else element.setAttribute(name, resolved);
      }
    }
    for (const image of Array.from(doc.querySelectorAll("image"))) {
      const href = image.getAttributeNS("http://www.w3.org/1999/xlink", "href");
      if (href === null || /^(?:data|blob):/i.test(href)) continue;
      const path = resolvePath(base, href);
      const resolved = path === null ? null : await assetUrl(path, mediaTypeFor(path));
      if (resolved === null) image.removeAttributeNS("http://www.w3.org/1999/xlink", "href");
      else image.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", resolved);
    }
    for (const style of Array.from(doc.querySelectorAll("style"))) {
      if (style.textContent !== null) {
        style.textContent = await rewriteCss(style.textContent, { base, assetUrl });
      }
    }
    for (const element of Array.from(doc.querySelectorAll("[style]"))) {
      const value = element.getAttribute("style");
      if (value !== null) {
        element.setAttribute("style", await rewriteCss(value, { base, assetUrl }));
      }
    }
    for (const link of Array.from(doc.querySelectorAll('link[rel~="stylesheet"]'))) {
      const href = link.getAttribute("href");
      if (href === null) {
        link.remove();
        continue;
      }
      const path = resolvePath(base, href);
      const css = path === null ? null : await assetText(path);
      if (css === null || path === null) {
        link.remove();
        continue;
      }
      const style = doc.createElement("style");
      style.textContent = await rewriteCss(css, { base: path, assetUrl });
      link.replaceWith(style);
    }
  }

  /**
   * The CSS Reader draws inside the shadow root around the book's own. The
   * book's rules stay scoped to the section; these override the reading
   * typography and, in dark mode, force text and background while leaving
   * images untouched.
   * @param {{ fontSize: number, lineWidth: string }} settings
   * @param {{ dark?: boolean }} [options]
   * @returns {string}
   */
  function readingCss(settings, options) {
    const scale = Math.max(0.6, Math.min(2, (settings.fontSize || 100) / 100));
    const width = LINE_WIDTHS[settings.lineWidth] || LINE_WIDTHS.medium;
    const dark = options && options.dark === true;
    const text = dark ? "#e5e5e5" : "var(--maibuk-color-foreground, #1a1a1a)";
    const background = dark ? "#111111" : "transparent";
    return [
      ":host { display: block; height: 100%; }",
      `.reader-flow { box-sizing: border-box; max-width: ${width}; margin: 0 auto;`,
      `  color: ${text}; background: ${background}; font-size: ${scale}em;`,
      "  line-height: 1.6; overflow-wrap: break-word; }",
      ".reader-flow img, .reader-flow svg, .reader-flow video { max-width: 100%; height: auto; }",
      ".reader-flow a { color: inherit; text-decoration: underline; }",
      ".reader-flow .reader-search-hit { background: var(--maibuk-color-warning-bg, #fde68a); color: inherit; }",
    ].join("\n");
  }

  // The Frame reads this global; there is no module system to export it.
  /** @type {any} */ (globalThis).ReaderSanitizer = {
    FORBID_TAGS,
    ALLOWED_URI_REGEXP,
    LINE_WIDTHS,
    isExternal,
    isScriptUrl,
    resolvePath,
    sanitizeDocument,
    rewriteDocument,
    rewriteCss,
    readingCss,
    mediaTypeFor,
  };
})();
