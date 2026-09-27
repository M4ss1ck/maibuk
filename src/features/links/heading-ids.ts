export interface HeadingInfo {
  id: string;
  text: string;
  level: number;
}

export interface AssignHeadingIdsResult {
  html: string;
  headings: HeadingInfo[];
  changed: boolean;
}

export function newHeadingId(): string {
  return `h-${crypto.randomUUID().slice(0, 8)}`;
}

function hash32(input: string): string {
  // FNV-1a
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Ids for headings, in document order. A heading stored without an id gets one
 * derived from its text and how many id-less headings with that text precede
 * it, so every reader of the same content names it alike: the link picker, the
 * link resolver, an editor opening it, and the save that finally stores it.
 */
export function deriveHeadingIds(headings: { id: string | null; text: string }[]): string[] {
  const used = new Set(headings.map((heading) => heading.id).filter(Boolean));
  const occurrences = new Map<string, number>();
  return headings.map((heading) => {
    if (heading.id) return heading.id;
    const text = heading.text.replace(/\s+/g, " ").trim();
    const occurrence = occurrences.get(text) ?? 0;
    occurrences.set(text, occurrence + 1);
    let attempt = 0;
    let id = `h-${hash32(`${text}\u0000${occurrence}`)}`;
    while (used.has(id)) {
      attempt += 1;
      id = `h-${hash32(`${text}\u0000${occurrence}\u0000${attempt}`)}`;
    }
    used.add(id);
    return id;
  });
}

export function assignHeadingIds(html: string | null | undefined): AssignHeadingIdsResult {
  if (!html) return { html: html ?? "", headings: [], changed: false };
  const doc = new DOMParser().parseFromString(html, "text/html");
  const elements = Array.from(doc.body.querySelectorAll("h1, h2, h3"));
  const ids = deriveHeadingIds(
    elements.map((el) => ({ id: el.getAttribute("id"), text: el.textContent ?? "" }))
  );
  const headings: HeadingInfo[] = [];
  let changed = false;

  elements.forEach((el, index) => {
    const id = ids[index];
    if (el.getAttribute("id") !== id) {
      el.setAttribute("id", id);
      changed = true;
    }
    headings.push({
      id,
      text: el.textContent ?? "",
      level: Number(el.tagName.slice(1)),
    });
  });

  return { html: changed ? doc.body.innerHTML : html, headings, changed };
}
