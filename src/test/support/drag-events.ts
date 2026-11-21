import { fireEvent, waitFor } from "@testing-library/react";
import { isVirtualDragging } from "react-aria/private/dnd/DragManager";
import { expect, vi } from "vitest";

// jsdom has no DataTransfer or layout. These drive React Aria's native
// drag-and-drop the way a browser would: a DataTransfer that keeps what
// React Aria writes, drag events carrying coordinates, and row rectangles its
// drop-target delegate can measure.

export function createDataTransfer(): DataTransfer {
  const values = new Map<string, string>();
  const items: Array<{ kind: "string"; type: string }> & {
    add: (value: string, type: string) => void;
    clear: () => void;
    remove: (index: number) => void;
  } = Object.assign([], {
    add(value: string, type: string) {
      values.set(type, value);
      if (!items.some((item) => item.type === type)) items.push({ kind: "string", type });
    },
    clear() {
      items.splice(0);
      values.clear();
    },
    remove(index: number) {
      const [item] = items.splice(index, 1);
      if (item) values.delete(item.type);
    },
  });

  return {
    dropEffect: "none",
    effectAllowed: "all",
    files: [] as unknown as FileList,
    items: items as unknown as DataTransferItemList,
    get types() {
      return items.map((item) => item.type);
    },
    clearData(type?: string) {
      if (type) {
        const index = items.findIndex((item) => item.type === type);
        if (index >= 0) items.remove(index);
      } else {
        items.clear();
      }
    },
    getData(type: string) {
      return values.get(type) ?? "";
    },
    setData(type: string, value: string) {
      items.add(value, type);
    },
    setDragImage() {},
  } as DataTransfer;
}

export function createFileDataTransfer(file: File): DataTransfer {
  const item = {
    kind: "file",
    type: file.type,
    getAsFile: () => file,
  } as DataTransferItem;

  return {
    dropEffect: "none",
    effectAllowed: "all",
    files: [file] as unknown as FileList,
    items: [item] as unknown as DataTransferItemList,
    types: ["Files"],
    clearData() {},
    getData: () => "",
    setData() {},
    setDragImage() {},
  } as DataTransfer;
}

export function mockRect(element: HTMLElement, top: number, bottom: number) {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    top,
    bottom,
    left: 0,
    right: 400,
    width: 400,
    height: bottom - top,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect);
}

export function dispatchDragEvent(
  element: Element,
  type: string,
  dt: DataTransfer,
  clientY: number
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    dataTransfer: { value: dt },
    clientX: { value: 10 },
    clientY: { value: clientY },
    altKey: { value: false },
    ctrlKey: { value: false },
    metaKey: { value: false },
    shiftKey: { value: false },
  });
  fireEvent(element, event);
}

// React Aria starts a keyboard drag a frame after Enter lifts the row
// (DragManager's requestAnimationFrame). Only in that frame does it listen for
// Escape, hide everything but the drop targets, and focus the first one. jsdom
// runs frames on a fixed clock, so a key pressed before it misses the drag: an
// arrow moves the row focus, and an Escape leaves the drag running past the
// test, where its late frame hides the next test's screen.
export async function waitForKeyboardDrag() {
  await waitFor(() =>
    expect(document.activeElement?.getAttribute("aria-label")).toMatch(/^Insert /)
  );
}

// A keyboard drag hides everything but its drop targets until it ends.
// Presses `key` (drop or cancel) and waits for that: `outside`, an element no
// drop target holds, is hidden first and exposed again after. The first check
// keeps the wait from passing on an element the drag never hid.
export async function endKeyboardDrag(
  user: { keyboard: (text: string) => Promise<void> },
  key: "{Enter}" | "{Escape}",
  outside: HTMLElement
) {
  const hidden = '[aria-hidden="true"], [inert]';
  expect(outside.closest(hidden), "the drag should hide `outside`").not.toBeNull();
  await user.keyboard(key);
  await waitFor(() => expect(outside.closest(hidden)).toBeNull());
}

// Taken at import, before any test fakes the timers.
const realSetTimeout = globalThis.setTimeout;

/**
 * Ends a React Aria keyboard drag a test left running, and says whether there
 * was one. The drag listens for Escape from its first frame on, so this waits
 * for a frame first; a test that faked frames never runs one, so the wait is
 * capped at a real 100 ms (a ceiling, not a guess at how long anything takes).
 * Returns "ended", "stuck" (frames were faked, so the drag never set up and
 * cannot hear Escape), or null when no drag was running.
 */
export async function endLeakedKeyboardDrag(): Promise<"ended" | "stuck" | null> {
  if (!isVirtualDragging()) return null;
  await new Promise((resolve) => {
    requestAnimationFrame(resolve);
    realSetTimeout(resolve, 100);
  });
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  return isVirtualDragging() ? "stuck" : "ended";
}
