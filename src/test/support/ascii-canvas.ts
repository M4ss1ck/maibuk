import { vi } from "vitest";

/**
 * jsdom has no canvas, no `document.fonts`, no IntersectionObserver, and reports
 * zero element dimensions — all of which the ASCII easter-egg components rely
 * on. This harness stubs just enough of that environment to drive their effects
 * deterministically, and restores everything via the returned `cleanup`.
 */

interface Options {
  reduceMotion?: boolean;
  pointerFine?: boolean;
  width?: number;
  height?: number;
}

interface MockContext {
  setTransform: ReturnType<typeof vi.fn>;
  clearRect: ReturnType<typeof vi.fn>;
  fillText: ReturnType<typeof vi.fn>;
  measureText: ReturnType<typeof vi.fn>;
  font: string;
  textBaseline: string;
  fillStyle: string;
}

export interface AsciiCanvasEnv {
  ctx: MockContext;
  raf: ReturnType<typeof vi.fn>;
  /** Invoke the next queued animation frame with the given timestamp (ms). */
  flushFrame: (timestamp: number) => void;
  cleanup: () => void;
}

export function setupAsciiCanvas({
  reduceMotion = false,
  pointerFine = true,
  width = 800,
  height = 600,
}: Options = {}): AsciiCanvasEnv {
  const ctx: MockContext = {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 10 })),
    font: "",
    textBaseline: "",
    fillStyle: "",
  };

  const getContext = vi
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockReturnValue(ctx as unknown as CanvasRenderingContext2D);

  const getRect = vi
    .spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect")
    .mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
      width,
      height,
      toJSON: () => ({}),
    });

  const widthDesc = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientWidth",
  );
  const heightDesc = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientHeight",
  );
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => width,
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => height,
  });

  const fontsDesc = Object.getOwnPropertyDescriptor(document, "fonts");
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { ready: Promise.resolve() },
  });

  const prevIO = globalThis.IntersectionObserver;
  // Report the target as visible immediately so entrance logic can run.
  globalThis.IntersectionObserver = class {
    private cb: IntersectionObserverCallback;
    root = null;
    rootMargin = "";
    thresholds: number[] = [];
    constructor(cb: IntersectionObserverCallback) {
      this.cb = cb;
    }
    observe(target: Element) {
      this.cb(
        [{ isIntersecting: true, target } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      );
    }
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  } as unknown as typeof IntersectionObserver;

  const prevRaf = globalThis.requestAnimationFrame;
  const prevCaf = globalThis.cancelAnimationFrame;
  // Queue frame requests instead of running them, so a render doesn't recurse;
  // tests assert that animation was kicked off and can step frames by hand.
  const frameQueue: FrameRequestCallback[] = [];
  const raf = vi.fn((cb: FrameRequestCallback) => frameQueue.push(cb));
  globalThis.requestAnimationFrame =
    raf as unknown as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame =
    vi.fn() as unknown as typeof cancelAnimationFrame;

  const prevMatchMedia = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: /prefers-reduced-motion/.test(query)
      ? reduceMotion
      : /pointer:\s*fine/.test(query)
        ? pointerFine
        : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;

  return {
    ctx,
    raf,
    flushFrame(timestamp: number) {
      frameQueue.shift()?.(timestamp);
    },
    cleanup() {
      getContext.mockRestore();
      getRect.mockRestore();
      if (widthDesc) {
        Object.defineProperty(HTMLElement.prototype, "clientWidth", widthDesc);
      }
      if (heightDesc) {
        Object.defineProperty(HTMLElement.prototype, "clientHeight", heightDesc);
      }
      if (fontsDesc) Object.defineProperty(document, "fonts", fontsDesc);
      else {
        delete (document as unknown as { fonts?: unknown }).fonts;
      }
      globalThis.IntersectionObserver = prevIO;
      globalThis.requestAnimationFrame = prevRaf;
      globalThis.cancelAnimationFrame = prevCaf;
      window.matchMedia = prevMatchMedia;
    },
  };
}
