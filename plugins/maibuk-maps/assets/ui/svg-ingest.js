// @ts-check
/* Cleaning one uploaded SVG (#756). An uploaded picture is untrusted: it may
   carry scripts, handlers, HTML islands, or references that reach the network,
   and the Worker that keeps its bytes has no DOM to clean it with. This classic
   script (loaded before `map.js`) does that half of the ingest in the Frame:
   DOMPurify strips everything a picture must not carry, then every surviving
   reference and paint is checked, and the result says whether the picture draws
   in a single paint, so a Custom Stamp can tint it.

   It is a separate file so the rules are testable on their own: the tests load
   it with `new Function(source)()` and hand it a DOMPurify instance. It never
   touches the port or the drawing surface. */

(() => {
  // biome-ignore lint/suspicious/noRedundantUseStrict: the Frame loads this file as a classic script, not a module.
  "use strict";

  /** The elements a picture must never carry: code, an HTML island, or whole-sheet styling. */
  const FORBID_TAGS = ["script", "foreignObject", "style"];

  /** The attributes that point somewhere, and may only point inside the picture itself. */
  const REFERENCE_ATTRIBUTE = /(^|:)href$|^src$/i;

  /** A `url()` reference, which may only name a fragment of the same picture. */
  const URL_REFERENCE = /url\(\s*(["']?)([^"')]*)\1\s*\)/gi;

  /** One `fill` or `stroke` declaration of a `style` attribute. */
  const PAINT_DECLARATION = /(?:^|;)\s*(fill|stroke)\s*:\s*([^;]*)/gi;

  /** The elements that paint, and so carry a paint of their own. */
  const PAINTED_TAGS = [
    "path",
    "rect",
    "circle",
    "ellipse",
    "polygon",
    "polyline",
    "line",
    "text",
    "tspan",
    "textPath",
  ];

  /** The paints that name no colour of their own, so they never count as one. */
  const UNPAINTED = ["", "none", "transparent", "currentcolor", "inherit"];

  /** @param {string} value @returns {boolean} */
  function isLocalReference(value) {
    return value.trim().startsWith("#");
  }

  /**
   * Whether every `url()` of an attribute value names a fragment of the same
   * file. A value with a `url(` this cannot read is refused, so the rule fails
   * closed rather than letting an unparsable reference through.
   * @param {string} value
   * @returns {boolean}
   */
  function hasOnlyLocalUrls(value) {
    const matches = Array.from(value.matchAll(URL_REFERENCE));
    if (matches.length === 0) return false;
    return matches.every((match) => isLocalReference(match[2]));
  }

  /**
   * Drops every attribute that points outside the picture, in place: an event
   * handler, a `href`, `xlink:href`, or `src` that is not a fragment of this
   * file, and any attribute whose `url()` fetches or imports something. A
   * picture that reaches the network would tell a host the author never chose
   * which Map was open.
   * @param {Element} element
   */
  function scrubAttributes(element) {
    for (const name of Array.from(element.getAttributeNames())) {
      if (/^on/i.test(name)) {
        element.removeAttribute(name);
        continue;
      }
      const value = element.getAttribute(name) ?? "";
      if (REFERENCE_ATTRIBUTE.test(name)) {
        if (!isLocalReference(value)) element.removeAttribute(name);
        continue;
      }
      if (/url\(/i.test(value) && !hasOnlyLocalUrls(value)) element.removeAttribute(name);
    }
  }

  /**
   * The paints one element draws with, from its `style` declarations and its
   * `fill` and `stroke` attributes. A shape with no fill draws SVG's default
   * paint, black, so a drawing that writes no colour at all is one paint; a
   * `line` encloses no area, so it has no fill to draw.
   * @param {Element} element
   * @returns {string[]}
   */
  function paintsOf(element) {
    /** @type {Record<string, string>} */
    const declared = {};
    for (const match of (element.getAttribute("style") ?? "").matchAll(PAINT_DECLARATION)) {
      declared[match[1].toLowerCase()] = match[2].trim();
    }
    const defaultFill = element.localName === "line" ? "none" : "black";
    return [
      declared.fill ?? element.getAttribute("fill") ?? defaultFill,
      declared.stroke ?? element.getAttribute("stroke") ?? "none",
    ];
  }

  /**
   * Whether the picture draws in a single paint, so a Custom Stamp can tint it
   * (#756). A two-colour picture loses its shading when tinted, so it keeps its
   * own colours and the properties panel offers no colour for it.
   * @param {Element} root
   * @returns {boolean}
   */
  function isRecolorable(root) {
    /** @type {Set<string>} */
    const paints = new Set();
    for (const element of [root, ...root.querySelectorAll("*")]) {
      if (!PAINTED_TAGS.includes(element.localName)) continue;
      for (const paint of paintsOf(element)) {
        const normalized = paint.trim().toLowerCase().replace(/\s+/g, " ");
        if (!UNPAINTED.includes(normalized)) paints.add(normalized);
        if (paints.size > 1) return false;
      }
    }
    return true;
  }

  /**
   * Sanitizes one uploaded SVG and says whether it draws in a single paint
   * (#756), or returns null when the text is not an SVG document: a file that
   * is not a picture is refused rather than stored. The sanitized markup is
   * what the Library keeps, never the bytes the file arrived with.
   * @param {string} text
   * @param {{ sanitize: (node: string, options: Record<string, unknown>) => unknown }} purify
   * @returns {{ svg: string, recolorable: boolean } | null}
   */
  function sanitizeSvg(text, purify) {
    if (typeof text !== "string" || text === "") return null;
    // DOMPurify is a callable object: its own factory is the export, with
    // `sanitize` and the version hung off it.
    const callable = typeof purify === "function" || typeof purify === "object";
    if (!callable || purify === null || typeof purify.sanitize !== "function") return null;
    const clean = purify.sanitize(text, {
      USE_PROFILES: { svg: true, svgFilters: true },
      FORBID_TAGS,
      KEEP_CONTENT: true,
    });
    if (typeof clean !== "string" || clean === "") return null;
    // The cleaned markup is parsed as XML, the way a picture file is: an HTML
    // parse would accept a fragment and lose the namespace the file declared.
    const doc = new DOMParser().parseFromString(clean, "image/svg+xml");
    const root = doc.documentElement;
    if (root === null || root.localName !== "svg") return null;
    for (const element of [root, ...root.querySelectorAll("*")]) scrubAttributes(element);
    return {
      svg: new XMLSerializer().serializeToString(root),
      recolorable: isRecolorable(root),
    };
  }

  // The Frame reads this global; there is no module system to export it.
  /** @type {any} */ (globalThis).maibukSvgIngest = { FORBID_TAGS, sanitizeSvg };
})();
