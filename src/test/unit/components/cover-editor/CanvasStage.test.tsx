import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  canvas: {
    on: vi.fn(),
    remove: vi.fn(),
    getObjects: vi.fn(() => []),
    add: vi.fn(),
    setActiveObject: vi.fn(),
    discardActiveObject: vi.fn(),
    getActiveObject: vi.fn(() => null),
    requestRenderAll: vi.fn(),
    setZoom: vi.fn(),
    setDimensions: vi.fn(),
    getZoom: vi.fn(() => 1),
    dispose: vi.fn(),
  },
  storeState: {
    scene: {
      doc: { width: 400, height: 600 },
      layers: [],
    },
    selectedId: null,
    overlays: false,
    snapping: false,
    select: vi.fn(),
    updateLayer: vi.fn(),
  },
}));

vi.mock("fabric", () => ({
  Canvas: class {
    constructor() {
      Object.assign(this, mocks.canvas);
    }
  },
  IText: class {},
}));

vi.mock("../../../../components/cover-editor/render/toFabric", () => ({
  applyBackground: vi.fn().mockResolvedValue(undefined),
  buildObject: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../../../components/cover-editor/render/overlays", () => ({
  buildGuideLine: vi.fn(),
  buildOverlays: vi.fn(() => []),
}));

vi.mock("../../../../features/covers/scene/snap", () => ({
  snapAxis: vi.fn(() => null),
}));

vi.mock("../../../../features/covers/scene/fonts", () => ({
  collectFonts: vi.fn(() => []),
  ensureFontsLoaded: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../../features/covers/store", () => {
  const useCoverStore = (selector: (state: typeof mocks.storeState) => unknown) =>
    selector(mocks.storeState);
  useCoverStore.getState = () => mocks.storeState;
  return { useCoverStore };
});

const { CanvasStage, computeStageScale } = await import(
  "@/components/cover-editor/CanvasStage"
);

type MockResizeObserver = {
  callback: ResizeObserverCallback;
  observe: () => void;
  disconnect: () => void;
};

function installResizeObserverCapture() {
  const instances: MockResizeObserver[] = [];
  class CapturingResizeObserver {
    callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
      instances.push(this);
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  const original = globalThis.ResizeObserver;
  globalThis.ResizeObserver = CapturingResizeObserver as unknown as typeof ResizeObserver;
  return { instances, restore: () => (globalThis.ResizeObserver = original) };
}

function setContainerSize(element: HTMLElement, width: number, height: number) {
  Object.defineProperty(element, "clientWidth", { value: width, configurable: true });
  Object.defineProperty(element, "clientHeight", { value: height, configurable: true });
}

describe("computeStageScale()", () => {
  it("never upscales a doc smaller than the container", () => {
    expect(computeStageScale(400, 600, 1000, 1000)).toBe(1);
  });

  it("scales to fit the narrower dimension", () => {
    expect(computeStageScale(400, 600, 300, 600)).toBeCloseTo(0.63);
    expect(computeStageScale(400, 600, 400, 450)).toBeCloseTo(0.67);
  });

  it("returns 0 when the container has no usable space", () => {
    expect(computeStageScale(400, 600, 0, 600)).toBe(0);
    expect(computeStageScale(400, 600, 48, 48)).toBe(0);
  });
});

describe("CanvasStage", () => {
  let observer: ReturnType<typeof installResizeObserverCapture>;

  beforeEach(() => {
    vi.clearAllMocks();
    observer = installResizeObserverCapture();
    mocks.storeState.scene = { doc: { width: 400, height: 600 }, layers: [] };
    mocks.storeState.selectedId = null;
    mocks.storeState.overlays = false;
  });

  afterEach(() => {
    observer.restore();
  });

  it("refits the Fabric canvas when the container resizes", () => {
    const { container } = render(<CanvasStage className="test-stage" />);
    const stage = container.querySelector<HTMLElement>(".test-stage");
    expect(stage).not.toBeNull();
    expect(observer.instances).toHaveLength(1);
    expect(mocks.canvas.setZoom).not.toHaveBeenCalled();

    setContainerSize(stage as HTMLElement, 800, 600);
    act(() => {
      observer.instances[0].callback([], observer.instances[0] as unknown as ResizeObserver);
    });

    expect(mocks.canvas.setZoom).toHaveBeenCalledWith(0.92);
    expect(mocks.canvas.setDimensions).toHaveBeenCalledWith({ width: 368, height: 552 });
    expect(mocks.canvas.requestRenderAll).toHaveBeenCalled();
  });

  it("refits when the document size changes", () => {
    const { container, rerender } = render(<CanvasStage className="test-stage" />);
    const stage = container.querySelector<HTMLElement>(".test-stage");
    setContainerSize(stage as HTMLElement, 800, 600);
    act(() => {
      observer.instances[0].callback([], observer.instances[0] as unknown as ResizeObserver);
    });
    expect(mocks.canvas.setZoom).toHaveBeenLastCalledWith(0.92);

    mocks.storeState.scene = { doc: { width: 300, height: 500 }, layers: [] };
    rerender(<CanvasStage className="test-stage" />);

    expect(mocks.canvas.setZoom).toHaveBeenLastCalledWith(1);
    expect(mocks.canvas.setDimensions).toHaveBeenLastCalledWith({ width: 300, height: 500 });
  });

  it("skips refitting while the container has no laid-out size", () => {
    render(<CanvasStage className="test-stage" />);
    act(() => {
      observer.instances[0].callback([], observer.instances[0] as unknown as ResizeObserver);
    });
    expect(mocks.canvas.setZoom).not.toHaveBeenCalled();
    expect(mocks.canvas.setDimensions).not.toHaveBeenCalled();
  });
});
