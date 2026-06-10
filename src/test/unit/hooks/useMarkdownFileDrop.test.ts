import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DragEvent } from "react";

vi.mock("../../../lib/platform", () => ({
  IS_TAURI: false,
  getFileSystem: vi.fn(),
}));

import { useMarkdownFileDrop } from "../../../hooks/useMarkdownFileDrop";

function dropEvent(files: File[]): DragEvent {
  return {
    preventDefault: vi.fn(),
    currentTarget: { contains: () => false },
    dataTransfer: {
      files,
      items: files.map((f) => ({ kind: "file", type: f.type })),
      dropEffect: "",
    },
  } as unknown as DragEvent;
}

function containerRef() {
  return { current: document.createElement("div") };
}

describe("useMarkdownFileDrop()", () => {
  it("reads a dropped .md file and calls onImport with text + stem", async () => {
    const onImport = vi.fn();
    const { result } = renderHook(() => useMarkdownFileDrop(containerRef(), onImport));

    const file = new File(["# Hello\n\nbody"], "my-note.md", {
      type: "text/markdown",
    });

    act(() => {
      result.current.dropHandlers.onDrop(dropEvent([file]));
    });

    await waitFor(() =>
      expect(onImport).toHaveBeenCalledWith("# Hello\n\nbody", "my-note"),
    );
  });

  it("ignores drops without a .md file", () => {
    const onImport = vi.fn();
    const { result } = renderHook(() => useMarkdownFileDrop(containerRef(), onImport));

    const file = new File(["data"], "image.png", { type: "image/png" });

    act(() => {
      result.current.dropHandlers.onDrop(dropEvent([file]));
    });

    expect(onImport).not.toHaveBeenCalled();
  });

  it("sets isDraggingFile while a file is dragged over", () => {
    const { result } = renderHook(() => useMarkdownFileDrop(containerRef(), vi.fn()));

    act(() => {
      result.current.dropHandlers.onDragOver(
        dropEvent([new File(["x"], "a.md")]),
      );
    });
    expect(result.current.isDraggingFile).toBe(true);
  });
});
