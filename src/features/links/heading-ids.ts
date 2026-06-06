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

export function assignHeadingIds(html: string | null | undefined): AssignHeadingIdsResult {
  if (!html) return { html: html ?? "", headings: [], changed: false };
  const doc = new DOMParser().parseFromString(html, "text/html");
  const headings: HeadingInfo[] = [];
  let changed = false;

  for (const el of Array.from(doc.body.querySelectorAll("h1, h2, h3"))) {
    let id = el.getAttribute("id");
    if (!id) {
      id = newHeadingId();
      el.setAttribute("id", id);
      changed = true;
    }
    headings.push({
      id,
      text: el.textContent ?? "",
      level: Number(el.tagName.slice(1)),
    });
  }

  return { html: changed ? doc.body.innerHTML : html, headings, changed };
}
