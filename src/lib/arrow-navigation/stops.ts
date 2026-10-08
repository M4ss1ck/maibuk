// Arrow stops: which focused element owns the arrow keys, which widget it
// belongs to, whether an arrow is at that widget's edge, and where focus
// lands when an arrow leaves it. Edge rules follow React Aria 3.50.0
// (useGridListItem, useToolbar); the integration test runs real React Aria
// widgets, so an upgrade that changes their keys fails there.
import { getFocusableTreeWalker } from "react-aria/private/focus/FocusScope";
import { isTabbable } from "react-aria/private/utils/isFocusable";
import { isOutsideLayer } from "@/lib/top-layer";
import { type Direction, pickInDirection } from "@/lib/arrow-navigation/geometry";

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

export function focusablesIn(root: Element, tabbable: boolean): HTMLElement[] {
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

export type ArrowOutcome =
  | { kind: "inside" }
  | { kind: "edge" }
  | { kind: "move"; to: HTMLElement };

/**
 * What an arrow does from `el` (ADR 0025 rule 3). "inside": the widget moves
 * focus itself, so the key is left alone. "edge": the arrow leaves the
 * widget. "move": the module moves focus inside the widget itself, by
 * position for a wrapped toolbar's Up/Down and in DOM order for a vertical
 * toolbar nested in a row. Only the 2D grid and toolbar cross-axis cases
 * read layout.
 */
export function arrowOutcome(el: HTMLElement, key: ArrowKey): ArrowOutcome {
  const widget = widgetOf(el);
  if (widget === el && !el.matches(COMPOSITE)) return { kind: "edge" };
  const role = widget.getAttribute("role");
  const vertical = isVerticalKey(key);

  if (role === "radiogroup" || role === "menubar") return { kind: "inside" };

  if (role === "toolbar") {
    if (vertical === (orientation(widget) === "vertical")) {
      const row = vertical ? widget.parentElement?.closest('[role="row"]') : null;
      return row instanceof HTMLElement ? nestedOutcome(el, widget, row, key) : { kind: "inside" };
    }
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
    // A row its tree keeps open (the Settings section on screen) cannot
    // collapse, so Left leaves from it as from a collapsed one.
    const collapsible = expanded === "true" && !row.hasAttribute("data-keeps-open");
    return !collapsible && topLevel && row === el ? { kind: "edge" } : { kind: "inside" };
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

// A vertical toolbar inside a grid-list row (the Chapter outline). React
// Aria's row capture handler sends Up/Down from anything in the row to the
// next row, so the module moves between the toolbar's items itself. Up from
// the first item returns to its own row; Down from the last is left to the
// row, which moves on to the next one. DOM order only: no layout reads.
function nestedOutcome(
  el: HTMLElement,
  widget: Element,
  row: HTMLElement,
  key: ArrowKey
): ArrowOutcome {
  const items = focusablesIn(widget, false);
  const forward = key === "ArrowDown";
  const to = items[items.indexOf(el) + (forward ? 1 : -1)];
  if (to) return { kind: "move", to };
  return forward ? { kind: "inside" } : { kind: "move", to: row };
}

// A 2D card grid moves Left/Right between cards by position and leaves at
// its side edges, where React Aria would wrap to the next visual row. React
// Aria Components forces "tab" navigation in `layout="grid"`, so a card's
// own buttons are Tab stops and their arrows stay React Aria's. Cards flow in
// DOM order, so the card beside one is its DOM neighbor when the two share a
// visual row: two rect reads, whatever the gallery's size.
function gridOutcome(el: HTMLElement, widget: Element, key: ArrowKey): ArrowOutcome {
  const item = el.closest('[role="row"], [role="option"]');
  if (!item || !widget.contains(item)) return { kind: "edge" };
  if (el !== item) return { kind: "inside" };
  const items = [...widget.querySelectorAll('[role="row"], [role="option"]')];
  const beside = items[items.indexOf(item) + (key === "ArrowRight" ? 1 : -1)];
  if (!(beside instanceof HTMLElement)) return { kind: "edge" };
  const from = item.getBoundingClientRect();
  const to = beside.getBoundingClientRect();
  const sameRow = Math.min(to.bottom, from.bottom) > Math.max(to.top, from.top);
  return sameRow ? { kind: "move", to: beside } : { kind: "edge" };
}

// Every element React Aria's tabbable selector can match, before its
// visibility and inert checks: a superset.
const TABBABLE_CANDIDATE =
  "input, select, textarea, button, a[href], area[href], summary, iframe, object, embed, audio[controls], video[controls], [contenteditable], permission, [tabindex]";

function isStopNode(node: Element): boolean {
  return isTabbable(node) && !isOutsideLayer(node) && !ownsArrows(node);
}

/**
 * The first element in `widget` that makes it an arrow stop, skipping
 * nested composite widgets. A list's first row button usually qualifies, so
 * the walk ends within a row or two.
 */
function firstStopNode(widget: Element): Element | null {
  const walker = document.createTreeWalker(widget, NodeFilter.SHOW_ELEMENT, {
    acceptNode: (node) =>
      (node as Element).matches(COMPOSITE)
        ? NodeFilter.FILTER_REJECT
        : (node as Element).matches(TABBABLE_CANDIDATE)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_SKIP,
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (isStopNode(node as Element)) return node as Element;
  }
  return null;
}

/**
 * The arrow stops inside `scope`: its tabbable elements, one per composite
 * widget (the widget element stands for all its items), minus arrow owners
 * and anything outside the current layer.
 *
 * A widget's subtree is never walked past its first tabbable item: a list
 * of 500 Notes holds 21,000 elements and 3,000 row buttons, and checking
 * each (React Aria's check reads computed styles) cost 70 ms per arrow. Only
 * a toolbar nests inside another widget (the Chapter outline in its row), so
 * only toolbars are looked up inside one. Arrow owners' subtrees (the editor
 * text) are skipped whole.
 */
export function stopsIn(scope: Element): Element[] {
  const found: { stop: Element; at: Element }[] = [];
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      const el = node as Element;
      if (el.matches(COMPOSITE)) {
        // An empty list is itself the Tab stop.
        const own = isStopNode(el) ? el : firstStopNode(el);
        if (own) found.push({ stop: el, at: own });
        for (const toolbar of el.querySelectorAll('[role="toolbar"]')) {
          const at = firstStopNode(toolbar);
          if (at) found.push({ stop: toolbar, at });
        }
        return NodeFilter.FILTER_REJECT;
      }
      if (el.matches(TABBABLE_CANDIDATE)) {
        if (isTextEntry(el)) return NodeFilter.FILTER_REJECT;
        if (isStopNode(el)) found.push({ stop: el, at: el });
      }
      return NodeFilter.FILTER_SKIP;
    },
  });
  walker.nextNode();
  // Document order of each stop's first tabbable item, as a Tab walk meets them.
  found.sort((a, b) =>
    a.at.compareDocumentPosition(b.at) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
  );
  return found.map(({ stop }) => stop);
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
