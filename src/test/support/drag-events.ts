import { fireEvent } from "@testing-library/react";
import { vi } from "vitest";

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
