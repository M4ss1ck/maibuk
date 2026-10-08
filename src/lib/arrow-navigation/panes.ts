// Panes: the screen areas F6 cycles through (`data-focus-pane`), and where
// focus lands when F6 or an arrow enters one (ADR 0025 rule 8).
import { getFocusableTreeWalker } from "react-aria/private/focus/FocusScope";
import { isOutsideLayer } from "@/lib/top-layer";
import { landOn, stopsIn } from "@/lib/arrow-navigation/stops";

/** Matches every Pane container. */
export const PANE_SELECTOR = "[data-focus-pane]";

function isVisiblePane(pane: HTMLElement): boolean {
  if (pane.closest('[hidden], [inert], [aria-hidden="true"], [data-closed]')) return false;
  const style = window.getComputedStyle(pane);
  return style.display !== "none" && style.visibility !== "hidden";
}

const isNested = (pane: HTMLElement) => pane.hasAttribute("data-focus-pane-nested");

/**
 * The Panes F6 stops on, in DOM order. Panes nest (the Book Editor's chapter
 * wrapper holds the Chapter list); only the innermost are stops, since the
 * outer one is the same region. A Pane marked nested (the Footnotes after the
 * text) is a region of its own inside its outer Pane, so both stay stops.
 */
export function visiblePanes(): HTMLElement[] {
  const visible = [...document.querySelectorAll<HTMLElement>(PANE_SELECTOR)].filter(isVisiblePane);
  return visible.filter(
    (pane) =>
      isNested(pane) ||
      !visible.some((other) => other !== pane && !isNested(other) && pane.contains(other))
  );
}

/** The innermost stop Pane holding `el`; focus on an outer wrapper counts as its first inner Pane. */
export function paneOf(el: Element | null, panes = visiblePanes()): HTMLElement | null {
  if (!el) return null;
  let found: HTMLElement | null = null;
  // Document order puts an outer Pane before a nested one, so the last match is the innermost.
  for (const pane of panes) if (pane === el || pane.contains(el)) found = pane;
  if (found) return found;
  if (el instanceof HTMLElement && el.matches(PANE_SELECTOR)) {
    return panes.find((pane) => el.contains(pane)) ?? null;
  }
  return null;
}

// The control last focused in each Pane, so F6 returns there.
const lastFocused = new WeakMap<HTMLElement, HTMLElement>();

function remember(event: FocusEvent): void {
  const target = event.target;
  if (!(target instanceof HTMLElement) || target.matches(PANE_SELECTOR)) return;
  // A nested Pane's controls are not its outer Pane's: F6 to the editor
  // returns to the text, not to the Footnotes inside it.
  for (let pane = target.closest<HTMLElement>(PANE_SELECTOR); pane; ) {
    lastFocused.set(pane, target);
    if (isNested(pane)) break;
    pane = pane.parentElement?.closest<HTMLElement>(PANE_SELECTOR) ?? null;
  }
}

/** True when `el` is in `pane` itself rather than in a nested Pane inside it. */
function isOwnedBy(el: Element, pane: HTMLElement): boolean {
  const nested = el.closest<HTMLElement>("[data-focus-pane-nested]");
  return !nested || nested === pane || !pane.contains(nested);
}

/** Starts recording the last focused control per Pane. Returns the uninstaller. */
export function installPaneMemory(): () => void {
  document.addEventListener("focusin", remember, true);
  return () => document.removeEventListener("focusin", remember, true);
}

// A remembered control may since have been removed, hidden, or disabled;
// focus() on it then does nothing, which is how a stale memory is detected.
function tryFocus(el: HTMLElement | undefined, pane: HTMLElement): boolean {
  if (!el || !el.isConnected || !pane.contains(el) || isOutsideLayer(el)) return false;
  el.focus();
  return document.activeElement === el;
}

/**
 * Focuses where entering `pane` should land: the control last used there,
 * else the Pane's declared entry (`data-focus-pane-entry`), else its first
 * arrow stop that is not text entry, else its first tabbable, else the Pane.
 */
export function landInPane(pane: HTMLElement): void {
  if (tryFocus(lastFocused.get(pane), pane)) return;
  const entry = [...pane.querySelectorAll<HTMLElement>("[data-focus-pane-entry]")].find(
    (candidate) => isOwnedBy(candidate, pane) && !isOutsideLayer(candidate)
  );
  if (entry) {
    landOn(entry);
    return;
  }
  const stop = stopsIn(pane).find((candidate) => isOwnedBy(candidate, pane));
  if (stop) {
    landOn(stop);
    return;
  }
  const walker = getFocusableTreeWalker(pane, { tabbable: true });
  walker.currentNode = pane;
  let first = walker.nextNode();
  while (first && !isOwnedBy(first as Element, pane)) first = walker.nextNode();
  (first instanceof HTMLElement ? first : pane).focus();
}

/** Fired on `document` after F6 lands in a Pane; `detail` is the Pane. The Pane frame names it. */
export const PANE_CYCLED_EVENT = "maibuk:pane-cycled";

/** F6 (forward) and Shift+F6: land in the next or previous visible Pane. */
export function cyclePanes(forward: boolean): HTMLElement | null {
  const panes = visiblePanes();
  if (panes.length === 0) return null;
  const current = paneOf(document.activeElement, panes);
  const index = current ? panes.indexOf(current) : -1;
  const next =
    index < 0
      ? forward
        ? panes[0]
        : panes[panes.length - 1]
      : panes[(index + (forward ? 1 : -1) + panes.length) % panes.length];
  landInPane(next);
  document.dispatchEvent(new CustomEvent<HTMLElement>(PANE_CYCLED_EVENT, { detail: next }));
  return next;
}
