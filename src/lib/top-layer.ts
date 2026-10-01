// The topmost layer a voice or Click-by-Name action may touch: the last
// modal in document order that is not inside an inert subtree, else the
// page itself. Later siblings paint above earlier ones, so the last one is
// the one the author sees.
export function topmostLayer(doc: Document = document): HTMLElement {
  const modals = [...doc.querySelectorAll<HTMLElement>('[aria-modal="true"]')];
  for (let index = modals.length - 1; index >= 0; index -= 1) {
    const candidate = modals[index];
    if (candidate.closest("[inert]") === null) return candidate;
  }
  return doc.body;
}

// True when the element is hidden from the author: inside an inert subtree
// (the app under a running Tutorial) or inside aria-hidden content.
export function isOutsideLayer(element: Element): boolean {
  return element.closest("[inert]") !== null || element.closest('[aria-hidden="true"]') !== null;
}
