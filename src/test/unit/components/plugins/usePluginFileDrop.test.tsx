/**
 * #828: a file dropped on a Plugin's page reaches that Plugin, and only while
 * its broker accepts `files.dropped`. A page that does not accept leaves the
 * drop as if nothing were listening, so it never swallows another surface's
 * file.
 */
import { fireEvent, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ IS_TAURI: false }));

import { usePluginFileDrop } from "@/components/plugins/usePluginFileDrop";
import {
  createMemoryPluginFileGrantStore,
  registerPluginFileGrantStore,
} from "@/features/plugins/file-grants";
import type { PluginLifecycle } from "@/features/plugins/types";

const PLUGIN = "sample";
const PAGE = "report";

function droppedFile(name: string): File {
  return new File([`content of ${name}`], name, { type: "text/plain" });
}

function transfer(files: File[]) {
  return {
    types: ["Files"],
    items: files.map((file) => ({ kind: "file", getAsFile: () => file })),
    dropEffect: "none",
  };
}

interface FakeBroker {
  accepts: ReturnType<typeof vi.fn>;
  emit: ReturnType<typeof vi.fn>;
}

function fakeBroker(accepts: boolean): FakeBroker {
  return { accepts: vi.fn(() => accepts), emit: vi.fn(() => true) };
}

function lifecycleWith(broker: FakeBroker): PluginLifecycle {
  return {
    runtime: (pluginId: string) => (pluginId === PLUGIN ? { broker } : null),
  } as unknown as PluginLifecycle;
}

function mount(broker: FakeBroker) {
  registerPluginFileGrantStore(createMemoryPluginFileGrantStore());
  const element = document.createElement("div");
  document.body.append(element);
  const lifecycle = lifecycleWith(broker);
  const hook = renderHook(() => usePluginFileDrop(lifecycle, PLUGIN, PAGE, element));
  return { ...hook, element };
}

afterEach(() => {
  registerPluginFileGrantStore(null);
  document.body.replaceChildren();
});

describe("usePluginFileDrop()", () => {
  it("delivers a drop on the page as one File Grant per file, default prevented", async () => {
    const broker = fakeBroker(true);
    const { element } = mount(broker);

    const handled = fireEvent.drop(element, {
      dataTransfer: transfer([droppedFile("a.txt"), droppedFile("b.txt")]),
    });

    expect(handled).toBe(false);
    await waitFor(() => expect(broker.emit).toHaveBeenCalledOnce());
    expect(broker.emit).toHaveBeenCalledWith("files.dropped", {
      page: PAGE,
      grants: [
        { grant: expect.any(String), name: "a.txt", size: "content of a.txt".length },
        { grant: expect.any(String), name: "b.txt", size: "content of b.txt".length },
      ],
    });
  });

  it("delivers nothing and leaves the drop alone when the broker refuses it", async () => {
    const broker = fakeBroker(false);
    const { element } = mount(broker);

    const handled = fireEvent.drop(element, {
      dataTransfer: transfer([droppedFile("a.txt")]),
    });

    expect(handled).toBe(true);
    await Promise.resolve();
    expect(broker.emit).not.toHaveBeenCalled();
  });

  it("delivers nothing for a drop outside the page", async () => {
    const broker = fakeBroker(true);
    const { element } = mount(broker);
    const sibling = document.createElement("div");
    element.after(sibling);

    const handled = fireEvent.drop(sibling, {
      dataTransfer: transfer([droppedFile("a.txt")]),
    });

    expect(handled).toBe(true);
    await Promise.resolve();
    expect(broker.emit).not.toHaveBeenCalled();
  });

  it("claims dragover over an accepting page with a copy effect", () => {
    const broker = fakeBroker(true);
    const { element } = mount(broker);
    const dataTransfer = transfer([]);

    const handled = fireEvent.dragOver(element, { dataTransfer });

    expect(handled).toBe(false);
    expect(dataTransfer.dropEffect).toBe("copy");
  });

  it("leaves dragover over a refusing page untouched", () => {
    const broker = fakeBroker(false);
    const { element } = mount(broker);
    const dataTransfer = transfer([]);

    const handled = fireEvent.dragOver(element, { dataTransfer });

    expect(handled).toBe(true);
    expect(dataTransfer.dropEffect).toBe("none");
  });

  it("reports a file drag over the window, then clears it on drop", () => {
    const broker = fakeBroker(true);
    const { result } = mount(broker);

    expect(result.current).toBe(false);
    fireEvent.dragEnter(document, { dataTransfer: transfer([]) });
    expect(result.current).toBe(true);
    fireEvent.drop(document, { dataTransfer: transfer([]) });
    expect(result.current).toBe(false);
  });

  it("clears the file drag when the page itself takes the drop", async () => {
    const broker = fakeBroker(true);
    const { result, element } = mount(broker);

    fireEvent.dragEnter(document, { dataTransfer: transfer([]) });
    expect(result.current).toBe(true);
    fireEvent.drop(element, { dataTransfer: transfer([]) });

    expect(result.current).toBe(false);
    await waitFor(() => expect(broker.emit).toHaveBeenCalled());
  });

  it("does not report a file drag while the broker refuses drops", () => {
    const broker = fakeBroker(false);
    const { result } = mount(broker);

    fireEvent.dragEnter(document, { dataTransfer: transfer([]) });

    expect(result.current).toBe(false);
  });
});
