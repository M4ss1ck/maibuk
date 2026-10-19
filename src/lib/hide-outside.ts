// Hiding the page behind a dialog, cheaply.
//
// React Aria's ariaHideOutside walks every element outside the dialog and sets
// `inert` on each one. That is exact, but on WebKit setting `inert` on the
// long editor behind the dialog costs about 30 ms per open and per close: the
// engine restyles the whole subtree (#552). Hiding with `aria-hidden` on the
// dialog's sibling roots costs nothing measurable and hides the same subtree
// from assistive technology; the overlay's underlay blocks the pointer and
// FocusScope keeps Tab inside the dialog.
//
// The ref count keeps stacked overlays working: the last one to close lifts
// the attribute, and an `aria-hidden` someone else set is never removed.

const NO_RELEASE = () => {};

/** Attributes React Aria keeps visible while a modal is open. */
const ALWAYS_VISIBLE = ["data-live-announcer", "data-react-aria-top-layer"];

/** The child of `document.body` that holds `element`, when there is one. */
function bodyChildOf(element: Element): Element | null {
  let node: Element = element;
  while (node.parentElement && node.parentElement !== document.body) {
    node = node.parentElement;
  }
  return node.parentElement === document.body ? node : null;
}

function isAlwaysVisible(element: Element): boolean {
  return ALWAYS_VISIBLE.some((attribute) => element.hasAttribute(attribute));
}

function isHideable(element: Element): element is HTMLElement {
  return (
    element instanceof HTMLElement &&
    !isAlwaysVisible(element) &&
    !(element instanceof HTMLScriptElement) &&
    !(element instanceof HTMLStyleElement) &&
    !(element instanceof HTMLLinkElement)
  );
}

const ALWAYS_VISIBLE_SELECTOR = ALWAYS_VISIBLE.map((attribute) => `[${attribute}]`).join(",");

/**
 * Adds the widest element to hide for each branch: a branch with no live
 * announcer or top-layer descendant is hidden at its root (one attribute for
 * the whole subtree); a branch that holds one is descended so the announcer
 * stays reachable, as React Aria's own walk leaves it.
 */
function collectTargets(container: Element, portal: Element, targets: HTMLElement[]): void {
  for (const child of Array.from(container.children)) {
    if (child.contains(portal) || !isHideable(child)) continue;
    if (child.querySelector(ALWAYS_VISIBLE_SELECTOR)) {
      collectTargets(child, portal, targets);
    } else {
      targets.push(child);
    }
  }
}

/** How many open overlays currently need each element hidden. */
const claims = new WeakMap<HTMLElement, number>();
/** Elements this module hid, so it never removes another author's. */
const claimedByUs = new WeakSet<HTMLElement>();

function claim(element: HTMLElement): void {
  const count = claims.get(element) ?? 0;
  if (count === 0 && element.getAttribute("aria-hidden") !== "true") {
    element.setAttribute("aria-hidden", "true");
    claimedByUs.add(element);
  }
  claims.set(element, count + 1);
}

function release(element: HTMLElement): void {
  const count = claims.get(element) ?? 0;
  if (count > 1) {
    claims.set(element, count - 1);
    return;
  }
  claims.delete(element);
  if (claimedByUs.has(element)) {
    claimedByUs.delete(element);
    element.removeAttribute("aria-hidden");
  }
}

/**
 * Hides everything beside `portal` from assistive technology with one
 * attribute per widest branch. Returns a function that releases only what this
 * call claimed; it is safe to call more than once. Does nothing when `portal`
 * is not portaled under `document.body`, where there is no sibling root to
 * hide.
 */
export function hideOutsidePortal(portal: Element | null): () => void {
  if (!portal || typeof document === "undefined") return NO_RELEASE;
  if (!bodyChildOf(portal)) return NO_RELEASE;

  const targets: HTMLElement[] = [];
  collectTargets(document.body, portal, targets);
  if (targets.length === 0) return NO_RELEASE;

  for (const target of targets) claim(target);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const target of targets) release(target);
  };
}
