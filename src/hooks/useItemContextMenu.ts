import { useMemo, useRef } from "react";
import type { DragEvent, MouseEvent, PointerEvent } from "react";
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
}

/**
 * Opens an item's action menu on touch long-press and on the context-menu
 * gesture (right click, the ContextMenu key, Shift+F10). Long-presses that
 * start on a drag handle are left to drag-and-drop, and the click that ends a
 * long-press is swallowed so the item is not also opened.
 */
export function useItemContextMenu({ onOpen, isDisabled = false }: UseItemContextMenuOptions) {
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const suppressClickRef = useRef(false);
  const lastPointerTypeRef = useRef<string | null>(null);
  // usePress reports the pressed element, not where the finger landed.
  const pressOriginRef = useRef<EventTarget | null>(null);

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
    const gatedPointerDown = gated.onPointerDown as AnyHandler | undefined;
    return {
      ...gated,
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        lastPointerTypeRef.current = event.pointerType;
        pressOriginRef.current = event.target;
        suppressClickRef.current = false;
        gatedPointerDown?.(event);
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

  return { itemProps };
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
