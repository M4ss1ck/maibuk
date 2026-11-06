import DOMPurify from "dompurify";

const CANVAS_LINK_URI =
  /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|maibuk):|[^a-z]|[-a-z+.]+(?:[^-a-z+.:]|$))/i;

const BLANK_TEXT_TAGS = new Set(
  "P BR DIV SPAN H1 H2 H3 H4 H5 H6 UL OL LI BLOCKQUOTE STRONG B EM I U S CODE PRE MARK A".split(" ")
);

/**
 * Whether Text Node HTML holds nothing an author could see: no text beyond
 * whitespace, and only elements that show nothing on their own. An element not
 * on the list (an image, a rule, a table) counts as content, so a node is never
 * treated as empty by mistake.
 */
export function isBlankTextNodeHtml(html: string): boolean {
  const { body } = new DOMParser().parseFromString(html, "text/html");
  if (body.textContent?.trim()) return false;
  return Array.from(body.querySelectorAll("*")).every((element) =>
    BLANK_TEXT_TAGS.has(element.tagName)
  );
}

/** Sanitize stored canvas node HTML with the canvas link-URI policy. */
function sanitizeNodeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ["class"],
    ALLOWED_URI_REGEXP: CANVAS_LINK_URI,
  });
}

/**
 * The sanitized form of one raw anchor, or null when the canvas policy drops
 * it: a rejected href loses the attribute (or the element), so it is no Link.
 */
function sanitizedAnchor(anchor: HTMLAnchorElement): HTMLAnchorElement | null {
  const doc = new DOMParser().parseFromString(sanitizeNodeHtml(anchor.outerHTML), "text/html");
  return doc.querySelector<HTMLAnchorElement>("a[href]");
}

/** A Link a resting Text Node shows, with the anchor stored HTML holds it in. */
export interface CanvasLinkAnchor {
  /** The anchor in the stored HTML, for edits that keep the rest of it as it was. */
  anchor: HTMLAnchorElement;
  href: string;
  text: string;
}

/**
 * The Links a resting Text Node shows, in document order, read through the
 * same sanitizer that renders them (`prepareStaticCanvasHtml`): an anchor whose
 * href the policy rejects is neither listed nor opened, and removing one by
 * this order removes the Link the author saw.
 */
export function canvasLinkAnchors(html: string): CanvasLinkAnchor[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return Array.from(doc.querySelectorAll<HTMLAnchorElement>("a[href]")).flatMap((anchor) => {
    const kept = sanitizedAnchor(anchor);
    const href = kept?.getAttribute("href");
    return href ? [{ anchor, href, text: kept?.textContent ?? "" }] : [];
  });
}

/**
 * Prepares stored canvas node HTML for idle (non-editing) rendering so it matches
 * the active editor: sanitizes with the canvas link policy, restores hard breaks
 * inside empty paragraphs, numbers footnote references in DOM order, and appends a
 * footnote definition section. Footnote definitions are assigned through
 * `textContent`, never interpolated as HTML. Stored HTML remains canonical TipTap
 * output; this transformation is for display only.
 */
export function prepareStaticCanvasHtml(html: string): string {
  const doc = new DOMParser().parseFromString(sanitizeNodeHtml(html), "text/html");
  const body = doc.body;

  // A resting Link is no Tab stop: its keyboard route is the node's Shift+F10
  // menu, and a focusable anchor inside a React Flow node traps Tab (#729).
  body.querySelectorAll("a[href]").forEach((anchor) => {
    anchor.setAttribute("tabindex", "-1");
  });

  body.querySelectorAll("p").forEach((paragraph) => {
    if (paragraph.childNodes.length === 0) {
      paragraph.appendChild(doc.createElement("br"));
    }
  });

  const refs = Array.from(body.querySelectorAll("sup[data-footnote]"));
  if (refs.length > 0) {
    const section = doc.createElement("div");
    section.className = "footnote-section";
    const divider = doc.createElement("hr");
    divider.className = "footnote-divider";
    section.appendChild(divider);

    const list = doc.createElement("ol");
    list.className = "footnote-list";

    refs.forEach((ref, index) => {
      ref.textContent = String(index + 1);
      ref.classList.add("footnote-ref");

      const item = doc.createElement("li");
      item.className = "footnote-item";
      const content = doc.createElement("span");
      content.className = "footnote-content";
      content.textContent = ref.getAttribute("data-footnote-content") ?? "";
      item.appendChild(content);
      list.appendChild(item);
    });

    section.appendChild(list);
    body.appendChild(section);
  }

  return body.innerHTML;
}
