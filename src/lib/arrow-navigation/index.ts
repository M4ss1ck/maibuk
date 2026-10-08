// Arrow keys that leave a widget at its edge move focus by position to the
// nearest arrow stop, then across Panes (ADR 0025). The only hand-written
// focus movement in the app: widgets keep React Aria's own arrow handling.
import { topmostLayer } from "@/lib/top-layer";
import { pickInDirection, pickPane } from "./geometry";
import { installPaneMemory, landInPane, paneOf, visiblePanes } from "./panes";
import {
  type ArrowKey,
  arrowOutcome,
  DIRECTION,
  isTextEntry,
  landOn,
  ownsArrows,
  stopsIn,
  widgetOf,
} from "./stops";

export { cyclePanes, landInPane, visiblePanes } from "./panes";

function isArrowKey(key: string): key is ArrowKey {
  return key === "ArrowUp" || key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowRight";
}

function hasArea(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

// Nothing focused, or a Pane container itself (ADR 0025 rule 7): Down and
// Right land on the scope's entry (or its first stop), Up and Left on its last.
function enterScope(scope: Element, key: ArrowKey): boolean {
  const forward = key === "ArrowDown" || key === "ArrowRight";
  const entry = forward ? scope.querySelector("[data-focus-pane-entry]") : null;
  if (entry) {
    landOn(entry);
    return true;
  }
  const stops = stopsIn(scope).filter(hasArea);
  const stop = forward ? stops[0] : stops[stops.length - 1];
  if (!stop) return false;
  landOn(stop);
  return true;
}

function leave(active: HTMLElement, key: ArrowKey, layer: HTMLElement): boolean {
  const dir = DIRECTION[key];
  const inDialog = layer !== document.body;
  const panes = inDialog ? [] : visiblePanes();
  const pane = inDialog ? layer : (paneOf(active, panes) ?? layer);
  const widget = widgetOf(active);
  const from = active.getBoundingClientRect();
  const candidates = stopsIn(pane)
    .filter((stop) => stop !== widget && !stop.contains(active))
    .map((stop) => ({ rect: stop.getBoundingClientRect(), id: stop }));
  const target = pickInDirection(from, candidates, dir);
  if (target) {
    landOn(target);
    return true;
  }
  if (inDialog || pane === layer) return false;
  const others = panes
    .filter((other) => !other.contains(pane) && !pane.contains(other))
    .map((other) => ({ rect: other.getBoundingClientRect(), id: other }));
  const next = pickPane(from, pane.getBoundingClientRect(), others, dir);
  if (!next) return false;
  landInPane(next);
  return true;
}

/**
 * The window keydown handler. Runs in the capture phase, before React
 * Aria's own handlers, because those always swallow arrows (a toolbar even at
 * its last item, a grid-list row by wrapping), so "unhandled" never arrives.
 * Keys it does not act on cost no layout reads.
 */
export function handleArrowKey(event: KeyboardEvent): void {
  if (!isArrowKey(event.key)) return;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (event.isComposing || event.defaultPrevented) return;
  const key = event.key;
  const layer = topmostLayer();
  const active = document.activeElement;

  if (!(active instanceof HTMLElement) || active === document.body || active === layer) {
    if (
      enterScope(layer === document.body ? (document.querySelector("main") ?? layer) : layer, key)
    ) {
      event.preventDefault();
      event.stopPropagation();
    }
    return;
  }
  if (!layer.contains(active)) return;
  if (active.matches("[data-focus-pane]")) {
    if (enterScope(active, key)) {
      event.preventDefault();
      event.stopPropagation();
    }
    return;
  }
  if (ownsArrows(active)) {
    // React Aria's row capture handler takes Left/Right from a text field
    // inside a row to move between the row's controls; the caret keeps them.
    if (
      (key === "ArrowLeft" || key === "ArrowRight") &&
      isTextEntry(active) &&
      active.closest('[role="row"]')
    ) {
      event.stopPropagation();
    }
    return;
  }

  const outcome = arrowOutcome(active, key);
  if (outcome.kind === "inside") return;
  if (outcome.kind === "move") outcome.to.focus();
  else if (!leave(active, key, layer)) {
    // Nowhere to go: a grid-list row keeps focus rather than letting React
    // Aria wrap Left/Right around the row's controls.
    if ((key === "ArrowLeft" || key === "ArrowRight") && active.closest('[role="row"]')) {
      event.stopPropagation();
    }
    return;
  }
  event.preventDefault();
  event.stopPropagation();
}

/** Installs the arrow listener and the per-Pane focus memory. Returns the uninstaller. */
export function installArrowNavigation(): () => void {
  window.addEventListener("keydown", handleArrowKey, true);
  const uninstallMemory = installPaneMemory();
  return () => {
    window.removeEventListener("keydown", handleArrowKey, true);
    uninstallMemory();
  };
}
