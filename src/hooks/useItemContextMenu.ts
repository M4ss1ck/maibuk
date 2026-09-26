import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, MouseEvent, PointerEvent, RefObject } from "react";
import { useLongPress } from "react-aria";

export const DRAG_HANDLE_SELECTOR = "[data-drag-handle]";
const EDITABLE_SELECTOR = "input, textarea, select, [contenteditable='true']";

function closestFrom(target: EventTarget | null, selector: string): Element | null {
  return target instanceof Element ? target.closest(selector) : null;
}

type AnyHandler = (event: { nativeEvent?: Event; pointerType?: string }) => void;

// usePress (inside useLongPress) cancels the surrounding press when its timer
// fires, which would break slow mouse clicks and keyboard activation of the
// row. Only touch pointer events reach it, so long-press stays a touch gesture.
function touchOnly(props: object): Record<string, unknown> {
  const gated: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (typeof value !== "function") {
      gated[key] = value;
      continue;
    }
    if (!key.startsWith("onPointer")) continue;
    gated[key] = (event: Parameters<AnyHandler>[0]) => {
      if (event.pointerType === "touch") (value as AnyHandler)(event);
    };
  }
  return gated;
}

interface UseItemContextMenuOptions {
  onOpen: () => void;
  isDisabled?: boolean;
  /**
   * The item's visible element, kept for positioning the menu's popover. When
   * set, its focusable row (or the element itself when no row wraps it) also
   * opens the menu on the keyboard Context Menu gesture: the Context Menu key
   * and Shift+F10. React Aria puts focus on the row, so the handler must live
   * there; the inner element's onContextMenu never sees a keyboard contextmenu
   * event.
   */
  anchorRef?: RefObject<HTMLElement | null>;
}

/**
 * Opens an item's action menu on touch long-press and on the context-menu
 * gesture (right click, the Context Menu key, Shift+F10). Long-presses that
 * start on a drag handle are left to drag-and-drop, and the click that ends a
 * long-press is swallowed so the item is not also opened.
 *
 * The returned `setOwnerRef` is the item element's `ref`; React Aria mounts
 * collection rows after the first effect, so a state callback ref is what
 * reliably tells us when the focusable row exists.
 */
export function useItemContextMenu({
  onOpen,
  isDisabled = false,
  anchorRef,
}: UseItemContextMenuOptions) {
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const [owner, setOwner] = useState<HTMLElement | null>(null);
  const suppressClickRef = useRef(false);
  const lastPointerTypeRef = useRef<string | null>(null);
  // usePress reports the pressed element, not where the finger landed.
  const pressOriginRef = useRef<EventTarget | null>(null);

  const setOwnerRef = useCallback(
    (node: HTMLElement | null) => {
      if (anchorRef) anchorRef.current = node;
      setOwner(node);
    },
    [anchorRef]
  );

  useEffect(() => {
    const row = owner?.closest<HTMLElement>('[role="row"]') ?? owner ?? null;
    if (!row) return;

    const openFromKeyboard = (event: Event) => {
      if (isDisabled) return;
      if (event.target instanceof Element && closestFrom(event.target, EDITABLE_SELECTOR)) return;
      // A drag handle owns its own gesture: a native contextmenu bubbling out
      // of it (touch long-press or right click) must not open the item menu.
      if (event.target instanceof Element && closestFrom(event.target, DRAG_HANDLE_SELECTOR)) return;
      event.preventDefault();
      onOpenRef.current();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
        openFromKeyboard(event);
      }
    };

    row.addEventListener("contextmenu", openFromKeyboard);
    row.addEventListener("keydown", onKeyDown);
    return () => {
      row.removeEventListener("contextmenu", openFromKeyboard);
      row.removeEventListener("keydown", onKeyDown);
    };
  }, [owner, isDisabled]);

  const { longPressProps } = useLongPress({
    isDisabled,
    onLongPress: () => {
      const origin = pressOriginRef.current;
      if (closestFrom(origin, DRAG_HANDLE_SELECTOR)) return;
      if (closestFrom(origin, EDITABLE_SELECTOR)) return;
      suppressClickRef.current = true;
      onOpenRef.current();
    },
  });

  const itemProps = useMemo(() => {
    const gated = touchOnly(longPressProps);
    return {
      ...gated,
      // Capture phase: nested buttons (drag handles, the ⋯ button) stop
      // pointerdown propagation, but the gesture still has to know where it began.
      onPointerDownCapture: (event: PointerEvent<HTMLElement>) => {
        lastPointerTypeRef.current = event.pointerType;
        pressOriginRef.current = event.target;
        suppressClickRef.current = false;
      },
      onContextMenu: (event: MouseEvent<HTMLElement>) => {
        if (isDisabled) return;
        if (!event.currentTarget.contains(event.target as Node)) return;
        if (closestFrom(event.target, EDITABLE_SELECTOR)) return;
        // Android fires contextmenu at the end of a long-press; the long-press
        // handler owns touch, so only swallow the native menu here.
        if (lastPointerTypeRef.current === "touch") {
          event.preventDefault();
          return;
        }
        event.preventDefault();
        onOpenRef.current();
      },
      onClickCapture: (event: MouseEvent<HTMLElement>) => {
        if (!suppressClickRef.current) return;
        suppressClickRef.current = false;
        event.preventDefault();
        event.stopPropagation();
      },
    };
  }, [longPressProps, isDisabled]);

  return { itemProps, setOwnerRef };
}

/**
 * Container props that keep a touch long-press on an item's body from turning
 * into a native drag: on touch, dragging starts only from a `data-drag-handle`
 * element, leaving the long-press on the body for the item menu. Mouse drags
 * are untouched.
 */
export function useTouchDragFromHandle() {
  const touchOriginRef = useRef<"handle" | "body" | null>(null);

  return useMemo(
    () => ({
      onPointerDownCapture: (event: PointerEvent<HTMLElement>) => {
        touchOriginRef.current =
          event.pointerType === "touch"
            ? closestFrom(event.target, DRAG_HANDLE_SELECTOR)
              ? "handle"
              : "body"
            : null;
      },
      onDragStartCapture: (event: DragEvent<HTMLElement>) => {
        if (touchOriginRef.current !== "body") return;
        event.preventDefault();
        event.stopPropagation();
      },
    }),
    []
  );
}
