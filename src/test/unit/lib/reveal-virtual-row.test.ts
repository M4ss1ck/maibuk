import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REVEAL_VIRTUAL_ROW_FRAMES, revealVirtualRow } from "@/lib/reveal-virtual-row";

/** A rAF queue the test flushes by hand, so each frame is one explicit step. */
function manualFrames() {
  let nextId = 1;
  const queue = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    const id = nextId++;
    queue.set(id, cb);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    queue.delete(id);
  });
  return {
    pending: () => queue.size,
    flush() {
      const callbacks = [...queue.values()];
      queue.clear();
      for (const cb of callbacks) cb(0);
    },
  };
}

function makeScroll() {
  const scroll = document.createElement("div");
  scroll.scrollTop = 0;
  return scroll;
}

function makeRow(scroll: HTMLElement) {
  const row = document.createElement("div");
  row.scrollIntoView = vi.fn();
  scroll.appendChild(row);
  return row;
}

describe("revealVirtualRow", () => {
  let frames: ReturnType<typeof manualFrames>;

  beforeEach(() => {
    frames = manualFrames();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("runs onRow at once, scrolled into view, when the row is already mounted", () => {
    const scroll = makeScroll();
    const row = makeRow(scroll);
    const onRow = vi.fn();

    revealVirtualRow({
      getScroll: () => scroll,
      findRow: () => row,
      estimatedTop: () => 500,
      id: "a",
      onRow,
    });

    expect(row.scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    expect(onRow).toHaveBeenCalledWith(row);
    expect(frames.pending()).toBe(0);
    expect(scroll.scrollTop).toBe(0);
  });

  it("moves the scroll view to the estimate, then runs onRow on the frame the row mounts", () => {
    const scroll = makeScroll();
    let row: HTMLElement | null = null;
    const onRow = vi.fn();

    revealVirtualRow({
      getScroll: () => scroll,
      findRow: () => row,
      estimatedTop: () => 320,
      id: "a",
      onRow,
    });
    expect(scroll.scrollTop).toBe(320);
    expect(onRow).not.toHaveBeenCalled();

    row = makeRow(scroll);
    frames.flush();

    expect(onRow).toHaveBeenCalledTimes(1);
    expect(onRow).toHaveBeenCalledWith(row);
  });

  it("retries at most `frames` times, then calls onMissing once and stops", () => {
    const scroll = makeScroll();
    const onRow = vi.fn();
    const onMissing = vi.fn();

    revealVirtualRow({
      getScroll: () => scroll,
      findRow: () => null,
      estimatedTop: () => 100,
      id: "gone",
      onRow,
      onMissing,
    });

    for (let frame = 1; frame <= REVEAL_VIRTUAL_ROW_FRAMES; frame++) {
      expect(onMissing).not.toHaveBeenCalled();
      frames.flush();
    }

    expect(onMissing).toHaveBeenCalledTimes(1);
    expect(onRow).not.toHaveBeenCalled();
    expect(frames.pending()).toBe(0);
  });

  it("calls onMissing straight away when the id is not in the list", () => {
    const onMissing = vi.fn();

    revealVirtualRow({
      getScroll: () => makeScroll(),
      findRow: () => null,
      estimatedTop: () => null,
      id: "nope",
      onRow: vi.fn(),
      onMissing,
    });

    expect(onMissing).toHaveBeenCalledTimes(1);
    expect(frames.pending()).toBe(0);
  });

  it("calls onMissing straight away when there is no scroll view", () => {
    const onMissing = vi.fn();

    revealVirtualRow({
      getScroll: () => null,
      findRow: () => null,
      estimatedTop: () => 10,
      id: "a",
      onRow: vi.fn(),
      onMissing,
    });

    expect(onMissing).toHaveBeenCalledTimes(1);
  });

  it("cancel stops a pending frame so onRow never runs on a later mount", () => {
    const scroll = makeScroll();
    let row: HTMLElement | null = null;
    const onRow = vi.fn();
    const onMissing = vi.fn();

    const cancel = revealVirtualRow({
      getScroll: () => scroll,
      findRow: () => row,
      estimatedTop: () => 200,
      id: "a",
      onRow,
      onMissing,
    });
    expect(frames.pending()).toBe(1);

    cancel();
    expect(frames.pending()).toBe(0);

    row = makeRow(scroll);
    frames.flush();
    expect(onRow).not.toHaveBeenCalled();
    expect(onMissing).not.toHaveBeenCalled();
  });
});
