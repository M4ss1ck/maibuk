import { act, fireEvent } from "@testing-library/react";
import { vi } from "vitest";

// jsdom has no PointerEvent. React Aria picks its pointer code path only when
// the constructor exists, and useLongPress dispatches one to cancel the press.
class PointerEventPolyfill extends MouseEvent {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly width: number;
  readonly height: number;
  readonly pressure: number;
  readonly isPrimary: boolean;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? "mouse";
    this.width = init.width ?? 1;
    this.height = init.height ?? 1;
    this.pressure = init.pressure ?? 0.5;
    this.isPrimary = init.isPrimary ?? true;
  }
}

export function installPointerEvent() {
  if (typeof globalThis.PointerEvent === "undefined") {
    globalThis.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent;
  }
}

const LONG_PRESS_MS = 500;

/**
 * Presses `element` with a touch pointer, holds it past React Aria's long-press
 * threshold, then lifts and lets the browser's trailing click fire. Requires
 * fake timers.
 */
export function touchLongPress(element: Element, holdMs = LONG_PRESS_MS + 50) {
  const init = { pointerType: "touch", pointerId: 7, button: 0, buttons: 1, bubbles: true };
  act(() => {
    fireEvent.pointerDown(element, init);
  });
  act(() => {
    vi.advanceTimersByTime(holdMs);
  });
  act(() => {
    fireEvent.contextMenu(element);
    fireEvent.pointerUp(element, { ...init, buttons: 0 });
    fireEvent.click(element);
  });
}

/** A short touch tap: pointerdown, pointerup, click. */
export function touchTap(element: Element) {
  const init = { pointerType: "touch", pointerId: 8, button: 0, buttons: 1, bubbles: true };
  act(() => {
    fireEvent.pointerDown(element, init);
    fireEvent.pointerUp(element, { ...init, buttons: 0 });
    fireEvent.click(element);
  });
}
