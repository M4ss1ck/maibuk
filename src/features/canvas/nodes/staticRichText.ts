import DOMPurify from "dompurify";

const CANVAS_LINK_URI =
  /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|maibuk):|[^a-z]|[-a-z+.]+(?:[^-a-z+.:]|$))/i;

/** Sanitize stored canvas node HTML with the canvas link-URI policy. */
function sanitizeNodeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ["class"],
    ALLOWED_URI_REGEXP: CANVAS_LINK_URI,
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
