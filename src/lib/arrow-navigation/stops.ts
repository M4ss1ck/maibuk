// Arrow stops: which focused element owns the arrow keys, which widget it
// belongs to, whether an arrow is at that widget's edge, and where focus
// lands when an arrow leaves it. Edge rules follow React Aria 3.50.0
// (useGridListItem, useToolbar); the integration test runs real React Aria
// widgets, so an upgrade that changes their keys fails there.
import { getFocusableTreeWalker } from "react-aria/private/focus/FocusScope";
import { isOutsideLayer } from "@/lib/top-layer";
import { type Direction, pickInDirection } from "./geometry";

export type ArrowKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

export const DIRECTION: Record<ArrowKey, Direction> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

const COMPOSITE =
  '[role="grid"], [role="listbox"], [role="tree"], [role="treegrid"], [role="toolbar"], [role="tablist"], [role="radiogroup"], [role="menubar"]';

// A widget's own item holding the roving tabindex (never a button inside a row).
const ROVING_ITEM = ["row", "option", "tab", "treeitem", "gridcell", "radio"]
  .map((role) => `[role="${role}"][tabindex="0"]`)
  .join(", ");

const OWNER_ROLES = new Set(["slider", "spinbutton", "combobox", "separator"]);

const NON_TEXT_INPUTS = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "image",
  "radio",
  "reset",
  "submit",
]);

/** A control the author types in: its arrows move the caret. */
export function isTextEntry(el: Element): boolean {
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(el.type);
  return el.closest('[contenteditable="true"]') !== null;
}

/**
 * True when the element keeps every arrow key for itself (ADR 0025 rule 5):
 * text entry, sliders, comboboxes, Select triggers, resize handles, anything
 * inside an open menu or popover, and surfaces marked `data-owns-arrows`.
 */
export function ownsArrows(el: Element): boolean {
  if (isTextEntry(el)) return true;
  const role = el.getAttribute("role");
  if (role && OWNER_ROLES.has(role)) return true;
  if (el.getAttribute("aria-haspopup") === "listbox") return true;
  return el.closest('[data-owns-arrows], [role="menu"], [data-trigger]') !== null;
}

/** The composite widget the element belongs to, or the element itself. */
export function widgetOf(el: Element): Element {
  return el.closest(COMPOSITE) ?? el;
}

function orientation(widget: Element): "horizontal" | "vertical" {
  const explicit = widget.getAttribute("aria-orientation");
  if (explicit === "horizontal" || explicit === "vertical") return explicit;
  const role = widget.getAttribute("role");
  return role === "toolbar" || role === "tablist" || role === "menubar" ? "horizontal" : "vertical";
}

function isVerticalKey(key: ArrowKey): boolean {
  return key === "ArrowUp" || key === "ArrowDown";
}

function focusablesIn(root: Element, tabbable: boolean): HTMLElement[] {
  const walker = getFocusableTreeWalker(root, { tabbable });
  walker.currentNode = root;
  const found: HTMLElement[] = [];
  let node = walker.nextNode();
  while (node) {
    if (node instanceof HTMLElement) found.push(node);
    node = walker.nextNode();
  }
  return found;
}

/** A 2D card grid: React Aria `layout="grid"`, which moves Up/Down by position. */
function isTwoDimensional(widget: Element): boolean {
  return widget.getAttribute("data-layout") === "grid";
}

// The nearest item in the same visual row (Left/Right) or column (Up/Down).
function neighbor(item: Element, items: Element[], key: ArrowKey): HTMLElement | null {
  const from = item.getBoundingClientRect();
  const vertical = isVerticalKey(key);
  const others = items
    .filter((other): other is HTMLElement => other !== item && other instanceof HTMLElement)
    .map((other) => ({ rect: other.getBoundingClientRect(), id: other }))
    .filter(({ rect }) =>
      vertical
        ? Math.min(rect.right, from.right) > Math.max(rect.left, from.left)
        : Math.min(rect.bottom, from.bottom) > Math.max(rect.top, from.top)
    );
  return pickInDirection(from, others, DIRECTION[key]);
}

export type ArrowOutcome =
  | { kind: "inside" }
  | { kind: "edge" }
  | { kind: "move"; to: HTMLElement };

/**
 * What an arrow does from `el` (ADR 0025 rule 3). "inside": the widget moves
 * focus itself, so the key is left alone. "edge": the arrow leaves the
 * widget. "move": a wrapped toolbar's Up/Down, which moves by position
 * inside it. Only the 2D grid and toolbar cross-axis cases read layout.
 */
export function arrowOutcome(el: HTMLElement, key: ArrowKey): ArrowOutcome {
  const widget = widgetOf(el);
  if (widget === el && !el.matches(COMPOSITE)) return { kind: "edge" };
  const role = widget.getAttribute("role");
  const vertical = isVerticalKey(key);

  if (role === "radiogroup" || role === "menubar") return { kind: "inside" };

  if (role === "toolbar") {
    if (vertical === (orientation(widget) === "vertical")) return { kind: "inside" };
    const items = focusablesIn(widget, false);
    const to = pickInDirection(
      el.getBoundingClientRect(),
      items
        .filter((item) => item !== el)
        .map((item) => ({ rect: item.getBoundingClientRect(), id: item })),
      DIRECTION[key]
    );
    return to ? { kind: "move", to } : { kind: "edge" };
  }

  if (role === "tablist") {
    return vertical === (orientation(widget) === "vertical")
      ? { kind: "inside" }
      : { kind: "edge" };
  }

  if (role === "tree" || role === "treegrid") {
    if (vertical) return { kind: "inside" };
    const row = el.closest('[role="row"], [role="treeitem"]');
    if (!row) return { kind: "edge" };
    const expanded = row.getAttribute("aria-expanded");
    if (key === "ArrowRight") return expanded === "false" ? { kind: "inside" } : { kind: "edge" };
    const topLevel = (row.getAttribute("aria-level") ?? "1") === "1";
    return expanded !== "true" && topLevel && row === el ? { kind: "edge" } : { kind: "inside" };
  }

  // Grid lists and list boxes. Up/Down never leave a list or grid.
  if (vertical) return { kind: "inside" };
  if (isTwoDimensional(widget)) return gridOutcome(el, widget, key);
  if (orientation(widget) === "horizontal") return { kind: "inside" };
  const row = el.closest('[role="row"]');
  if (!row) return { kind: "edge" };
  // React Aria wraps Left/Right inside the row: Right past the last child
  // goes back to the row, Left from the row goes to the last child.
  if (key === "ArrowLeft") return row === el ? { kind: "edge" } : { kind: "inside" };
  const children = focusablesIn(row, false);
  return children.length === 0 || children[children.length - 1] === el
    ? { kind: "edge" }
    : { kind: "inside" };
}

// A 2D card grid moves Left/Right between cards by position and leaves at
// its side edges, where React Aria would wrap to the next visual row. React
// Aria Components forces "tab" navigation in `layout="grid"`, so a card's
// own buttons are Tab stops and their arrows stay React Aria's.
function gridOutcome(el: HTMLElement, widget: Element, key: ArrowKey): ArrowOutcome {
  const item = el.closest('[role="row"], [role="option"]');
  if (!item || !widget.contains(item)) return { kind: "edge" };
  if (el !== item) return { kind: "inside" };
  const items = [...widget.querySelectorAll('[role="row"], [role="option"]')];
  const to = neighbor(item, items, key);
  return to ? { kind: "move", to } : { kind: "edge" };
}

/**
 * The arrow stops inside `scope`: its tabbable elements, one per composite
 * widget (the widget element stands for all its items), minus arrow owners
 * and anything outside the current layer.
 */
export function stopsIn(scope: Element): Element[] {
  const stops: Element[] = [];
  const seen = new Set<Element>();
  for (const node of focusablesIn(scope, true)) {
    if (isOutsideLayer(node) || ownsArrows(node)) continue;
    const stop = widgetOf(node);
    if (seen.has(stop)) continue;
    seen.add(stop);
    stops.push(stop);
  }
  return stops;
}

/**
 * Focuses a stop. A list, grid, or tab list lands on its roving item (the
 * one React Aria keeps at tabindex 0), else on the widget, whose own focus
 * handler picks the focused, selected, or first item. A toolbar lands on its
 * first item; React Aria's focus handler restores the last one used.
 */
export function landOn(stop: Element): void {
  if (!(stop instanceof HTMLElement)) return;
  if (!stop.matches(COMPOSITE)) {
    stop.focus();
    return;
  }
  if (stop.getAttribute("role") === "toolbar") {
    (focusablesIn(stop, false)[0] ?? stop).focus();
    return;
  }
  const roving = stop.querySelector<HTMLElement>(ROVING_ITEM);
  (roving ?? stop).focus();
}
