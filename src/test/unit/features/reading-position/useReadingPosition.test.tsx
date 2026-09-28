import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { useReadingPositionStore } from "@/features/reading-position/store";
import { useReadingPosition } from "@/features/reading-position/useReadingPosition";

vi.mock("@tiptap/pm/state", () => ({
  TextSelection: { create: vi.fn(() => ({ __selection: true })) },
}));

interface FakeEditor {
  state: {
    doc: { content: { size: number } };
    selection: { from: number };
    tr: { setSelection: ReturnType<typeof vi.fn> };
  };
  view: {
    dom: { getBoundingClientRect: ReturnType<typeof vi.fn> };
    posAtCoords: ReturnType<typeof vi.fn>;
    coordsAtPos: ReturnType<typeof vi.fn>;
    dispatch: ReturnType<typeof vi.fn>;
  };
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
}

function makeEditor(docSize = 100, caretFrom = 0): FakeEditor {
  const tr = { setSelection: vi.fn().mockReturnThis() };
  return {
    state: {
      doc: { content: { size: docSize } },
      selection: { from: caretFrom },
      tr,
    },
    view: {
      dom: {
        getBoundingClientRect: vi.fn(() => ({
          top: 100,
          left: 200,
          bottom: 700,
          right: 920,
          width: 720,
          height: 600,
        })),
      },
      posAtCoords: vi.fn(() => ({ pos: 42 })),
      coordsAtPos: vi.fn(() => ({
        top: 500,
        left: 0,
        bottom: 510,
        right: 0,
      })),
      dispatch: vi.fn(),
    },
    on: vi.fn(),
    off: vi.fn(),
  };
}

function makeScrollEl(): HTMLElement {
  const listeners: Record<string, EventListener[]> = {};
  const el = {
    scrollTop: 0,
    isConnected: true,
    getBoundingClientRect: () => ({
      top: 100,
      left: 0,
      bottom: 700,
      right: 0,
      width: 0,
      height: 600,
    }),
    addEventListener: (type: string, fn: EventListener) => {
      if (!listeners[type]) {
        listeners[type] = [];
      }
      listeners[type].push(fn);
    },
    removeEventListener: (type: string, fn: EventListener) => {
      listeners[type] = (listeners[type] ?? []).filter((listener) => listener !== fn);
    },
    __emit: (type: string) => {
      for (const fn of listeners[type] ?? []) {
        fn(new Event(type));
      }
    },
  };
  return el as unknown as HTMLElement & { __emit: (type: string) => void };
}

describe("useReadingPosition", () => {
  beforeEach(() => {
    useReadingPositionStore.setState({ positions: {} });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("restores the caret (no scroll) and viewport from a saved position", () => {
    useReadingPositionStore.getState().savePosition("chapter:a", { caret: 30, top: 20 });
    const editor = makeEditor(100);
    const scrollEl = makeScrollEl();

    renderHook(() =>
      useReadingPosition({
        editor: editor as never,
        scrollEl,
        storageKey: "chapter:a",
      })
    );

    expect(editor.state.tr.setSelection).toHaveBeenCalledWith({
      __selection: true,
    });
    expect(editor.view.dispatch).toHaveBeenCalledTimes(1);
    expect(editor.view.coordsAtPos).toHaveBeenCalledWith(20);
    expect(scrollEl.scrollTop).toBe(400);
  });

  it("clamps a stale caret/top beyond the document size", () => {
    useReadingPositionStore.getState().savePosition("chapter:a", { caret: 999, top: 999 });
    const editor = makeEditor(50);
    const scrollEl = makeScrollEl();

    renderHook(() =>
      useReadingPosition({
        editor: editor as never,
        scrollEl,
        storageKey: "chapter:a",
      })
    );

    expect(editor.view.coordsAtPos).toHaveBeenCalledWith(49);
  });

  it("does not restore when suppressRestore is true", () => {
    useReadingPositionStore.getState().savePosition("chapter:a", { caret: 30, top: 20 });
    const editor = makeEditor(100);
    const scrollEl = makeScrollEl();

    renderHook(() =>
      useReadingPosition({
        editor: editor as never,
        scrollEl,
        storageKey: "chapter:a",
        suppressRestore: true,
      })
    );

    expect(editor.view.dispatch).not.toHaveBeenCalled();
    expect(scrollEl.scrollTop).toBe(0);
  });

  it("captures position on scroll after the debounce window", () => {
    const editor = makeEditor(100, 17);
    const scrollEl = makeScrollEl() as HTMLElement & {
      __emit: (type: string) => void;
    };

    renderHook(() =>
      useReadingPosition({
        editor: editor as never,
        scrollEl,
        storageKey: "chapter:a",
      })
    );

    scrollEl.__emit("scroll");
    vi.advanceTimersByTime(400);

    expect(useReadingPositionStore.getState().getPosition("chapter:a")).toMatchObject({
      caret: 17,
      top: 42,
    });
  });

  it("probes inside the editor content when the scroll container is wider", () => {
    const editor = makeEditor(100, 17);
    const scrollEl = makeScrollEl() as HTMLElement & {
      __emit: (type: string) => void;
    };

    renderHook(() =>
      useReadingPosition({
        editor: editor as never,
        scrollEl,
        storageKey: "chapter:a",
      })
    );

    scrollEl.__emit("scroll");

    expect(editor.view.posAtCoords).toHaveBeenCalledWith({
      left: 208,
      top: 101,
    });
  });

  it("flushes the last stashed position on unmount", () => {
    const editor = makeEditor(100, 5);
    const scrollEl = makeScrollEl() as HTMLElement & {
      __emit: (type: string) => void;
    };

    const { unmount } = renderHook(() =>
      useReadingPosition({
        editor: editor as never,
        scrollEl,
        storageKey: "chapter:a",
      })
    );

    scrollEl.__emit("scroll");
    unmount();

    expect(useReadingPositionStore.getState().getPosition("chapter:a")).toMatchObject({
      caret: 5,
      top: 42,
    });
  });

  describe("while late layout settles", () => {
    let resize: (() => void) | undefined;
    let disconnect: Mock<() => void>;

    beforeEach(() => {
      resize = undefined;
      disconnect = vi.fn();
      vi.stubGlobal(
        "ResizeObserver",
        class {
          constructor(callback: () => void) {
            resize = callback;
          }
          observe() {}
          disconnect() {
            disconnect();
            resize = undefined;
          }
        }
      );
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    function restoreWithGrowth() {
      useReadingPositionStore.getState().savePosition("chapter:a", { caret: 30, top: 20 });
      const editor = makeEditor(100);
      const scrollEl = makeScrollEl();
      const hook = renderHook(() =>
        useReadingPosition({ editor: editor as never, scrollEl, storageKey: "chapter:a" })
      );
      expect(scrollEl.scrollTop).toBe(400);
      // An image above the restored block finishes loading: the block moves down 400px.
      editor.view.coordsAtPos.mockReturnValue({ top: 500, left: 0, bottom: 510, right: 0 });
      return { editor, scrollEl, hook };
    }

    it("keeps the restored block at the top when the document above it grows", () => {
      const { scrollEl } = restoreWithGrowth();

      resize?.();

      expect(scrollEl.scrollTop).toBe(800);
    });

    it("lets the author's own scroll win once they act", () => {
      const { scrollEl } = restoreWithGrowth();

      document.dispatchEvent(new Event("wheel"));
      resize?.();

      expect(scrollEl.scrollTop).toBe(400);
      expect(disconnect).toHaveBeenCalled();
    });

    it("stops holding once the settle window ends", () => {
      restoreWithGrowth();

      vi.advanceTimersByTime(10_000);

      expect(disconnect).toHaveBeenCalled();
    });

    it("stops holding when the editor unmounts", () => {
      const { hook } = restoreWithGrowth();

      hook.unmount();

      expect(disconnect).toHaveBeenCalled();
    });

    it("holds nothing when there is no saved scroll to keep", () => {
      const editor = makeEditor(100);
      renderHook(() =>
        useReadingPosition({
          editor: editor as never,
          scrollEl: makeScrollEl(),
          storageKey: "chapter:none",
        })
      );

      expect(resize).toBeUndefined();
    });
  });
});
