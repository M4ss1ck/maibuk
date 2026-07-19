import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DragEvent } from "react";

vi.mock("../../../lib/platform", () => ({
  IS_TAURI: false,
  getFileSystem: vi.fn(),
}));

const toastError = vi.fn();
vi.mock("@/components/ui/Toast", () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: vi.fn(),
  },
}));

import { useTextFileDrop } from "@/hooks/useTextFileDrop";

function dragEvent(files: File[], x = 5, y = 7): DragEvent {
  return {
    preventDefault: vi.fn(),
    clientX: x,
    clientY: y,
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

describe("useTextFileDrop()", () => {
  beforeEach(() => {
    toastError.mockClear();
  });

  it("stays importing until async persistence finishes", async () => {
    let finishImport: (() => void) | undefined;
    const persistence = new Promise<void>((resolve) => {
      finishImport = resolve;
    });
    const onImport = vi.fn(() => persistence);
    const { result } = renderHook(() =>
      useTextFileDrop(containerRef(), { onImport }),
    );

    act(() => {
      result.current.dropHandlers.onDrop(
        dragEvent([new File(["# Slow"], "slow.md")]),
      );
    });

    expect(result.current.isImportingFiles).toBe(true);
    await waitFor(() => expect(onImport).toHaveBeenCalledOnce());
    expect(result.current.isImportingFiles).toBe(true);

    await act(async () => {
      finishImport?.();
      await persistence;
    });

    expect(result.current.isImportingFiles).toBe(false);
  });

  it("stays importing until overlapping drops both finish", async () => {
    let finishFirst: (() => void) | undefined;
    let finishSecond: (() => void) | undefined;
    const first = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    const second = new Promise<void>((resolve) => {
      finishSecond = resolve;
    });
    const onImport = vi
      .fn<() => Promise<void>>()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    const { result } = renderHook(() =>
      useTextFileDrop(containerRef(), { onImport }),
    );

    act(() => {
      result.current.dropHandlers.onDrop(
        dragEvent([new File(["first"], "first.md")]),
      );
      result.current.dropHandlers.onDrop(
        dragEvent([new File(["second"], "second.md")]),
      );
    });

    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(2));
    expect(result.current.isImportingFiles).toBe(true);

    await act(async () => {
      finishSecond?.();
      await second;
    });
    expect(result.current.isImportingFiles).toBe(true);

    await act(async () => {
      finishFirst?.();
      await first;
    });
    expect(result.current.isImportingFiles).toBe(false);
  });

  it("toasts a general error and resets when persistence rejects", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const onImport = vi.fn().mockRejectedValue(new Error("database failed"));
    const { result } = renderHook(() =>
      useTextFileDrop(containerRef(), { onImport }),
    );

    act(() => {
      result.current.dropHandlers.onDrop(
        dragEvent([new File(["content"], "chapter.md")]),
      );
    });

    expect(result.current.isImportingFiles).toBe(true);
    await waitFor(() => expect(result.current.isImportingFiles).toBe(false));
    expect(toastError).toHaveBeenCalledWith("Could not import dropped files");
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("preserves the per-file toast and resets when reading a file fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const file = new File(["content"], "broken.md");
    vi.spyOn(file, "text").mockRejectedValue(new Error("read failed"));
    const onImport = vi.fn();
    const { result } = renderHook(() =>
      useTextFileDrop(containerRef(), { onImport }),
    );

    act(() => {
      result.current.dropHandlers.onDrop(dragEvent([file]));
    });

    expect(result.current.isImportingFiles).toBe(true);
    await waitFor(() => expect(result.current.isImportingFiles).toBe(false));
    expect(toastError).toHaveBeenCalledWith('Could not read "broken.md"');
    expect(toastError).not.toHaveBeenCalledWith("Could not import dropped files");
    expect(onImport).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("reads all supported dropped files in order, batched, with the drop point", async () => {
    const onImport = vi.fn();
    const { result } = renderHook(() =>
      useTextFileDrop(containerRef(), { onImport }),
    );

    const files = [
      new File(["# One"], "one.md", { type: "text/markdown" }),
      new File(["plain"], "two.txt", { type: "text/plain" }),
      new File(["skip"], "photo.png", { type: "image/png" }),
      new File(["## Three"], "three.markdown", { type: "" }),
    ];

    act(() => {
      result.current.dropHandlers.onDrop(dragEvent(files, 11, 22));
    });

    await waitFor(() =>
      expect(onImport).toHaveBeenCalledWith(
        [
          { text: "# One", stem: "one", extension: ".md" },
          { text: "plain", stem: "two", extension: ".txt" },
          { text: "## Three", stem: "three", extension: ".markdown" },
        ],
        { x: 11, y: 22 },
      ),
    );
  });

  it("toasts (and does not import) when files are dropped but none are supported", async () => {
    const onImport = vi.fn();
    const { result } = renderHook(() =>
      useTextFileDrop(containerRef(), { onImport }),
    );

    act(() => {
      result.current.dropHandlers.onDrop(dragEvent([new File(["x"], "a.png")]));
    });

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(result.current.isImportingFiles).toBe(false);
    expect(onImport).not.toHaveBeenCalled();
  });

  it("reports drag position via onDragMove and clears it on leave", () => {
    const onDragMove = vi.fn();
    const { result } = renderHook(() =>
      useTextFileDrop(containerRef(), { onImport: vi.fn(), onDragMove }),
    );

    act(() => {
      result.current.dropHandlers.onDragOver(
        dragEvent([new File(["x"], "a.md")], 3, 4),
      );
    });
    expect(result.current.isDraggingFile).toBe(true);
    expect(onDragMove).toHaveBeenCalledWith({ x: 3, y: 4 });

    act(() => {
      result.current.dropHandlers.onDragLeave(dragEvent([]));
    });
    expect(result.current.isDraggingFile).toBe(false);
    expect(onDragMove).toHaveBeenLastCalledWith(null);
  });

  it("does nothing on web events when disableWeb is set", () => {
    const onImport = vi.fn();
    const { result } = renderHook(() =>
      useTextFileDrop(containerRef(), { onImport, disableWeb: true }),
    );

    act(() => {
      result.current.dropHandlers.onDragOver(
        dragEvent([new File(["x"], "a.md")]),
      );
      result.current.dropHandlers.onDrop(dragEvent([new File(["x"], "a.md")]));
    });

    expect(result.current.isDraggingFile).toBe(false);
    expect(onImport).not.toHaveBeenCalled();
  });
});
