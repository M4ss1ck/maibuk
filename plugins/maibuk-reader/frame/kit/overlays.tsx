/** @jsxImportSource preact */
/**
 * The Reader Frame's overlays (#943 unit 3): Sheet, Dialog, Popover and Menu.
 * A Frame runs no host React Aria (ADR 0021), so these are Preact portals to
 * the document body with their own focus management: a module-local layer
 * stack makes Escape close only the top open layer, a capture-phase handler
 * stops the host from also acting on a handled Escape, modal layers trap Tab
 * and return focus to the trigger, and a Menu owns its roving tab stop. A
 * Popover or Menu opened over an open modal is marked nested so it paints
 * above the modal and its scrim.
 *
 * Every user-visible string is a prop, so the Worker's catalogs own the copy.
 * The kit draws with the tokens in `kit.css`; no color is stated here.
 */

import {
  type ComponentChildren,
  Fragment,
  createPortal,
  type RefObject,
  type TargetedKeyboardEvent,
} from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { useLayoutMode } from "../use-layout-mode";
import { Button } from "./controls";
import { Icon, type IconName } from "./icons";

/** One overlay's claim on the Escape key and the modal focus trap. */
interface Layer {
  onEscape: () => void;
  modal: boolean;
  element: () => HTMLElement | null;
}

/** The open layers, oldest first; the last one is on top. */
const layers: Layer[] = [];

let listening = false;

function topLayer(): Layer | undefined {
  return layers[layers.length - 1];
}

function topModalLayer(): Layer | undefined {
  for (let index = layers.length - 1; index >= 0; index -= 1) {
    const layer = layers[index];
    if (layer.modal) return layer;
  }
  return undefined;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function isVisible(element: HTMLElement): boolean {
  if (element.hasAttribute("hidden") || element.getAttribute("aria-hidden") === "true") {
    return false;
  }
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

/** The enabled, visible controls inside a layer, in document order. */
function focusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isVisible);
}

function focusFirst(root: HTMLElement): void {
  // Firefox ignores an element's focus() while the Frame's document is not
  // focused, which happens when a host palette Command opens the layer: the
  // host still holds the keyboard. Take the Frame's focus first, so the
  // control below really becomes the focused one.
  if (!document.hasFocus()) window.focus();
  const first = focusable(root)[0];
  if (first) first.focus();
  else root.focus();
}

/** Cycles Tab and Shift+Tab inside the modal layer; true when the key was handled. */
function trapTab(event: KeyboardEvent, root: HTMLElement): boolean {
  const items = focusable(root);
  if (items.length === 0) {
    root.focus();
    return true;
  }
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const index = active === null ? -1 : items.indexOf(active);
  if (event.shiftKey) {
    if (index <= 0) {
      items[items.length - 1].focus();
      return true;
    }
    return false;
  }
  if (index === -1 || index === items.length - 1) {
    items[0].focus();
    return true;
  }
  return false;
}

function handleKeyDown(event: KeyboardEvent): void {
  const top = topLayer();
  if (!top) return;

  if (event.key === "Escape") {
    event.preventDefault();
    event.stopImmediatePropagation();
    top.onEscape();
    return;
  }

  if (event.key === "Tab") {
    const modal = topModalLayer();
    const element = modal?.element();
    if (modal && element && trapTab(event, element)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }
}

function pushLayer(layer: Layer): void {
  layers.push(layer);
  if (listening) return;
  document.addEventListener("keydown", handleKeyDown, true);
  listening = true;
}

function removeLayer(layer: Layer): void {
  const index = layers.indexOf(layer);
  if (index !== -1) layers.splice(index, 1);
  if (layers.length === 0 && listening) {
    document.removeEventListener("keydown", handleKeyDown, true);
    listening = false;
  }
}

interface UseLayerOptions {
  active: boolean;
  onEscape: () => void;
  modal: boolean;
  focusFirstControl?: boolean;
}

/** A layer's element ref, plus whether it opened over an existing modal. */
interface LayerHandle {
  ref: RefObject<HTMLDivElement | null>;
  nested: boolean;
}

/**
 * Registers a layer while it is open, focuses its first control, and on close
 * returns focus to whatever held it when the layer opened. A nested layer
 * therefore restores into its parent's control, not the outer trigger.
 *
 * A non-modal layer that opens while a modal is already on the stack is nested:
 * it must paint above that modal and its scrim, so only this instance is marked
 * nested. A plain non-modal layer stays below the sheet-and-dialog layer.
 */
function useLayer({
  active,
  onEscape,
  modal,
  focusFirstControl = true,
}: UseLayerOptions): LayerHandle {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const previous = useRef<HTMLElement | null>(null);
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;
  const [nested, setNested] = useState(false);

  useLayoutEffect(() => {
    if (!active) return;
    setNested(!modal && layers.some((layer) => layer.modal));
    const element = elementRef.current;
    previous.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const layer: Layer = {
      onEscape: () => escapeRef.current(),
      modal,
      element: () => elementRef.current,
    };
    pushLayer(layer);
    if (focusFirstControl && element) focusFirst(element);
    return () => {
      removeLayer(layer);
      const target = previous.current;
      if (target?.isConnected) target.focus();
    };
  }, [active, modal, focusFirstControl]);

  return { ref: elementRef, nested };
}

/** A stable id for a layer's accessible name. */
let overlayId = 0;

function useOverlayId(): string {
  const id = useRef<string | null>(null);
  if (id.current === null) {
    overlayId += 1;
    id.current = `kit-overlay-${overlayId}`;
  }
  return id.current;
}

/** Positions a fixed layer 8 px under its anchor, clamped inside the viewport. */
function usePosition(
  layerRef: RefObject<HTMLElement | null>,
  anchorRef: RefObject<HTMLElement | null>,
  active: boolean
): void {
  useLayoutEffect(() => {
    if (!active) return;
    const update = () => {
      const layer = layerRef.current;
      const anchor = anchorRef.current;
      if (!layer || !anchor) return;
      const anchorRect = anchor.getBoundingClientRect();
      const size = layer.getBoundingClientRect();
      const margin = 8;
      const maxLeft = Math.max(margin, window.innerWidth - size.width - margin);
      const maxTop = Math.max(margin, window.innerHeight - size.height - margin);
      const left = Math.min(Math.max(anchorRect.left, margin), maxLeft);
      const top = Math.min(Math.max(anchorRect.bottom + margin, margin), maxTop);
      layer.style.left = `${left}px`;
      layer.style.top = `${top}px`;
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [active, layerRef, anchorRef]);
}

/**
 * The props a Sheet takes: open state, close, the title, and an optional Done
 * label. Omitting the label leaves the header with its title alone, so a
 * confirmation can draw only its own actions.
 */
export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  doneLabel?: string;
  /**
   * Keep the title as the Sheet's accessible name but do not draw it, for a
   * Sheet whose body opens with its own heading, such as a Document summary.
   */
  titleHidden?: boolean;
  /** The layer's ARIA role; confirmation sheets announce an alertdialog. */
  role?: "dialog" | "alertdialog";
  /**
   * Header actions drawn before Done, such as Reset. With actions, Done is the
   * header's primary button, as the "View and filters" Sheet draws it.
   */
  actions?: ComponentChildren;
  children?: ComponentChildren;
  class?: string;
}

/**
 * Narrow only: a bottom sheet with a 16 px top radius, a grab handle, and a
 * title row holding the Done button when one is named. Focus is trapped and
 * returned; Escape and a scrim tap close it.
 */
export function Sheet({
  open,
  onClose,
  title,
  doneLabel,
  titleHidden = false,
  role = "dialog",
  actions,
  children,
  class: extra,
}: SheetProps) {
  const { mode } = useLayoutMode();
  const active = open && mode === "narrow";
  const titleId = useOverlayId();
  const { ref: layerRef } = useLayer({ active, onEscape: onClose, modal: true });

  if (!active) return null;

  return createPortal(
    <div class={`kit-layer kit-layer--sheet ${extra ?? ""}`.trim()}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: a scrim tap is the pointer shortcut for Escape, which the layer stack handles. */}
      <div class="kit-scrim" onClick={onClose} />
      {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: aria-modal is valid on both dialog and alertdialog. */}
      <div
        ref={layerRef}
        class="kit-sheet"
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div class="kit-sheet__grab" aria-hidden="true" />
        <div
          class={
            titleHidden && doneLabel === undefined
              ? "kit-sheet__header kit-sheet__header--bare"
              : "kit-sheet__header"
          }
        >
          <h2
            id={titleId}
            class={titleHidden ? "kit-sheet__title kit-visually-hidden" : "kit-sheet__title"}
          >
            {title}
          </h2>
          {actions}
          {doneLabel === undefined ? null : (
            <Button variant={actions === undefined ? "ghost" : "primary"} onClick={onClose}>
              {doneLabel}
            </Button>
          )}
        </div>
        <div class="kit-sheet__body">{children}</div>
      </div>
    </div>,
    document.body
  );
}

/** The props a Dialog takes: open state, close, title, body, and actions. */
export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** The layer's ARIA role; a confirmation announces an alertdialog. */
  role?: "dialog" | "alertdialog";
  children?: ComponentChildren;
  actions?: ComponentChildren;
  class?: string;
}

/**
 * Wide only: a centered dialog capped at 640 px, with a title, body, and
 * right-aligned actions. Focus is trapped and returned; Escape and a scrim tap
 * close it.
 */
export function Dialog({
  open,
  onClose,
  title,
  role = "dialog",
  children,
  actions,
  class: extra,
}: DialogProps) {
  const { mode } = useLayoutMode();
  const active = open && mode === "wide";
  const titleId = useOverlayId();
  const { ref: layerRef } = useLayer({ active, onEscape: onClose, modal: true });

  if (!active) return null;

  return createPortal(
    <div class={`kit-layer kit-layer--dialog ${extra ?? ""}`.trim()}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: a scrim tap is the pointer shortcut for Escape, which the layer stack handles. */}
      <div class="kit-scrim" onClick={onClose} />
      {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: aria-modal is valid on both dialog and alertdialog. */}
      <div
        ref={layerRef}
        class="kit-dialog"
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <h2 id={titleId} class="kit-dialog__title">
          {title}
        </h2>
        <div class="kit-dialog__body">{children}</div>
        {actions ? <div class="kit-dialog__actions">{actions}</div> : null}
      </div>
    </div>,
    document.body
  );
}

/** The props a Popover takes: open state, close, its trigger, and its label. */
export interface PopoverProps {
  open: boolean;
  onClose: () => void;
  triggerRef: RefObject<HTMLElement | null>;
  label: string;
  children?: ComponentChildren;
  class?: string;
}

/**
 * Wide only: a non-modal layer 8 px below its trigger and aligned to the
 * trigger's left edge, clamped inside the Frame's viewport and repositioned on
 * resize and scroll. Escape closes it and returns focus to the trigger; Tab is
 * not trapped.
 */
export function Popover({
  open,
  onClose,
  triggerRef,
  label,
  children,
  class: extra,
}: PopoverProps) {
  const { mode } = useLayoutMode();
  const active = open && mode === "wide";
  const labelId = useOverlayId();
  const { ref: layerRef, nested } = useLayer({ active, onEscape: onClose, modal: false });
  usePosition(layerRef, triggerRef, active);

  if (!active) return null;

  return createPortal(
    <div
      ref={layerRef}
      class={`kit-popover ${nested ? "kit-popover--nested" : ""} ${extra ?? ""}`.trim()}
      role="dialog"
      aria-labelledby={labelId}
      tabIndex={-1}
    >
      <span id={labelId} class="kit-visually-hidden">
        {label}
      </span>
      {children}
    </div>,
    document.body
  );
}

/** One row in a Menu. */
export interface MenuItem {
  id: string;
  label: string;
  icon?: IconName;
  shortcut?: string;
  disabled?: boolean;
  /** Draws the row in the danger color, for an action that deletes. */
  destructive?: boolean;
  /** Starts a new group: a divider separates the row from the rows above it. */
  groupStart?: boolean;
  /**
   * Makes the row a `menuitemcheckbox` in this state, drawn with a check box.
   * Selecting it toggles and keeps the Menu open, so several can change.
   */
  checked?: boolean;
  /** A short muted text at the row's end, such as a count. */
  detail?: string;
  /**
   * Names the group the row sits in: consecutive rows with the same section
   * share one `role=group` with this label drawn above them.
   */
  section?: string;
}

/** The props a Menu takes: open state, close, its label, optional header, rows, and selection. */
export interface MenuProps {
  open: boolean;
  onClose: () => void;
  label: string;
  items: ReadonlyArray<MenuItem>;
  onSelect: (id: string) => void;
  /** Content drawn above the rows, such as the row summary a Document menu shows. */
  header?: ComponentChildren;
  /**
   * Draw the rows in place, as the body of the Sheet or Popover that holds
   * them. That container is the layer: it owns position, Escape, and focus
   * return, so an inline Menu neither portals nor registers a layer of its own.
   */
  inline?: boolean;
  /**
   * Content drawn just before the row with the given id, outside the roving
   * focus, such as a field the author types into. Tab reaches it; the arrow
   * keys skip it, and keys pressed inside it stay its own.
   */
  slots?: Readonly<Record<string, ComponentChildren>>;
  class?: string;
}

/** Consecutive rows that share a section, in order; rows without one stand alone. */
function groupRows(
  items: ReadonlyArray<MenuItem>
): Array<{ section: string | undefined; indices: number[] }> {
  const groups: Array<{ section: string | undefined; indices: number[] }> = [];
  items.forEach((item, index) => {
    const last = groups[groups.length - 1];
    if (last !== undefined && item.section !== undefined && last.section === item.section) {
      last.indices.push(index);
    } else {
      groups.push({ section: item.section, indices: [index] });
    }
  });
  return groups;
}

function firstEnabled(items: ReadonlyArray<MenuItem>): number {
  const index = items.findIndex((item) => !item.disabled);
  return index === -1 ? 0 : index;
}

function nextEnabled(items: ReadonlyArray<MenuItem>, from: number, delta: number): number {
  const count = items.length;
  if (count === 0) return 0;
  for (let step = 1; step <= count; step += 1) {
    const index = (((from + delta * step) % count) + count) % count;
    if (!items[index].disabled) return index;
  }
  return from;
}

/**
 * A `role=menu` with one tab stop and roving focus: Up/Down move and wrap,
 * Home/End jump, typing searches labels (skipping disabled rows), Enter and
 * Space select, and Escape closes through the layer stack. Rows are 40 px on a
 * fine pointer and 44 px when the layout asks for the larger touch target.
 */
export function Menu({
  open,
  onClose,
  label,
  items,
  onSelect,
  header,
  inline = false,
  slots,
  class: extra,
}: MenuProps) {
  const { target } = useLayoutMode();
  const { ref: layerRef, nested } = useLayer({
    active: open && !inline,
    onEscape: onClose,
    modal: false,
    focusFirstControl: false,
  });
  const anchorRef = useRef<HTMLElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const search = useRef({ text: "", at: 0 });
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const [active, setActive] = useState(() => firstEnabled(items));
  // Keys dispatched before the Menu draws again (Preact batches renders) must
  // move from the row the last key reached, not the one the last render drew.
  const activeRef = useRef(active);
  activeRef.current = active;

  useLayoutEffect(() => {
    if (!open) {
      anchorRef.current = null;
      return;
    }
    if (anchorRef.current === null) {
      anchorRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
  }, [open]);

  usePosition(layerRef, anchorRef, open && !inline);

  useEffect(() => {
    if (!open) return;
    const index = firstEnabled(itemsRef.current);
    activeRef.current = index;
    setActive(index);
    itemRefs.current[index]?.focus();
  }, [open]);

  const moveTo = (index: number) => {
    activeRef.current = index;
    setActive(index);
    itemRefs.current[index]?.focus();
  };

  const select = (index: number) => {
    const item = items[index];
    if (!item || item.disabled) return;
    onSelect(item.id);
    // A check box row toggles in place; every other row runs and closes.
    if (item.checked === undefined) onClose();
  };

  const typeAhead = (character: string) => {
    const now = Date.now();
    const previous = now - search.current.at > 500 ? "" : search.current.text;
    const text = `${previous}${character}`.toLowerCase();
    search.current = { text, at: now };
    const count = items.length;
    for (let step = 1; step <= count; step += 1) {
      const index = (activeRef.current + step) % count;
      const item = items[index];
      if (!item.disabled && item.label.toLowerCase().startsWith(text)) {
        moveTo(index);
        return;
      }
    }
  };

  const onKeyDown = (event: TargetedKeyboardEvent<HTMLDivElement>) => {
    // A key pressed inside a slot (a text field) belongs to that slot.
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.classList.contains("kit-menu__item")) return;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        moveTo(nextEnabled(items, activeRef.current, 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        moveTo(nextEnabled(items, activeRef.current, -1));
        break;
      case "Home":
        event.preventDefault();
        moveTo(firstEnabled(items));
        break;
      case "End": {
        event.preventDefault();
        let index = items.length - 1;
        while (index > 0 && items[index].disabled) index -= 1;
        moveTo(index);
        break;
      }
      case "Enter":
      case " ":
        event.preventDefault();
        select(activeRef.current);
        break;
      default:
        if (event.key.length === 1 && event.key !== " ") {
          event.preventDefault();
          typeAhead(event.key);
        }
        break;
    }
  };

  if (!open) return null;

  const row = (item: MenuItem, index: number) => {
    const checkbox = item.checked !== undefined;
    return (
      <Fragment key={item.id}>
        {slots?.[item.id] ?? null}
        {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: the role is menuitemcheckbox whenever aria-checked is set. */}
        <button
          ref={(node) => {
            itemRefs.current[index] = node;
          }}
          type="button"
          role={checkbox ? "menuitemcheckbox" : "menuitem"}
          aria-checked={checkbox ? item.checked : undefined}
          class={`kit-menu__item${item.destructive ? " kit-menu__item--destructive" : ""}${
            item.groupStart ? " kit-menu__item--group-start" : ""
          }`}
          tabIndex={index === active && !item.disabled ? 0 : -1}
          disabled={item.disabled}
          style={{ height: `${target}px` }}
          onClick={() => select(index)}
        >
          {checkbox ? (
            <span
              class={item.checked ? "kit-menu__check kit-menu__check--on" : "kit-menu__check"}
              aria-hidden="true"
            >
              {item.checked ? <Icon name="check" /> : null}
            </span>
          ) : item.icon ? (
            <Icon name={item.icon} />
          ) : null}
          <span class="kit-menu__label">{item.label}</span>
          {item.detail ? <span class="kit-menu__detail">{item.detail}</span> : null}
          {item.shortcut ? <span class="kit-menu__shortcut">{item.shortcut}</span> : null}
        </button>
      </Fragment>
    );
  };

  const modifier = inline ? "kit-menu--inline" : nested ? "kit-menu--nested" : "";
  const menu = (
    <div
      ref={layerRef}
      class={`kit-menu ${modifier} ${extra ?? ""}`.trim()}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      {header ?? null}
      {groupRows(items).map((group) => {
        const rows = group.indices.map((index) => row(items[index], index));
        if (group.section === undefined) return rows;
        return (
          // biome-ignore lint/a11y/useSemanticElements: a menu's group must be role=group; a fieldset is a form part.
          <div key={`section-${group.indices[0]}`} role="group" aria-label={group.section}>
            <p class="kit-menu__section" aria-hidden="true">
              {group.section}
            </p>
            {rows}
          </div>
        );
      })}
    </div>
  );

  return inline ? menu : createPortal(menu, document.body);
}
