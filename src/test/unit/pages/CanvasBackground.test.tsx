import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CANVAS_BACKGROUND_TILE_ID,
  CANVAS_PAGE_SIZE,
  CanvasBackground,
  canvasBackgroundOffset,
  canvasTileGeometry,
  canvasTileGrid,
} from "@/pages/Canvas";

type Transform = [number, number, number];

// A minimal stand-in for React Flow's store: `useStore` re-renders the
// component through `useSyncExternalStore`, and `useStoreApi().subscribe`
// drives the imperative pan path, exactly like the real flow store.
const fakeStore = vi.hoisted(() => {
  type State = { transform: Transform; width: number; height: number };
  const listeners = new Set<(state: State, previous: State) => void>();
  let current: State = { transform: [0, 0, 1], width: 1000, height: 800 };
  return {
    getState: () => current,
    setTransform(transform: Transform) {
      const previous = current;
      current = { ...current, transform };
      for (const listener of [...listeners]) listener(current, previous);
    },
    setSize(width: number, height: number) {
      const previous = current;
      current = { ...current, width, height };
      for (const listener of [...listeners]) listener(current, previous);
    },
    subscribe(listener: (state: State, previous: State) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reset() {
      current = { transform: [0, 0, 1], width: 1000, height: 800 };
      listeners.clear();
    },
  };
});

vi.mock("@xyflow/react", async (importOriginal) => {
  const { useSyncExternalStore } = await import("react");
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  return {
    ...actual,
    useStore: (selector: (state: ReturnType<typeof fakeStore.getState>) => unknown) =>
      useSyncExternalStore(
        (onChange) => fakeStore.subscribe(() => onChange()),
        () => selector(fakeStore.getState())
      ),
    useStoreApi: () => ({
      getState: fakeStore.getState,
      subscribe: fakeStore.subscribe,
    }),
  };
});

const backgroundLayer = () =>
  document.querySelector<HTMLElement>("div.react-flow__background") as HTMLElement;
const tileGeometry = () => document.getElementById(CANVAS_BACKGROUND_TILE_ID);
const tileMarkup = () => backgroundLayer().querySelector("svg")?.innerHTML ?? "";

describe("canvasBackgroundOffset()", () => {
  const tile = 1200;

  it("keeps a positive translation in [-tile, 0)", () => {
    expect(canvasBackgroundOffset(0, tile)).toBe(-tile);
    expect(canvasBackgroundOffset(137, tile)).toBe(137 - tile);
    expect(canvasBackgroundOffset(tile - 1, tile)).toBe(-1);
  });

  it("wraps every tile-length multiple to the same offset", () => {
    expect(canvasBackgroundOffset(tile, tile)).toBe(-tile);
    expect(canvasBackgroundOffset(2 * tile, tile)).toBe(-tile);
  });

  it("wraps negative translations without leaving the range", () => {
    expect(canvasBackgroundOffset(-1, tile)).toBe(-1);
    expect(canvasBackgroundOffset(-tile, tile)).toBe(-tile);
    expect(canvasBackgroundOffset(-tile - 1, tile)).toBe(-1);
    expect(canvasBackgroundOffset(-2 * tile - 5, tile)).toBe(-5);
  });

  it("reads the tile from the zoom-scaled geometry", () => {
    expect(canvasBackgroundOffset(0, canvasTileGeometry(1).tileWidth)).toBe(-CANVAS_PAGE_SIZE);
    expect(canvasBackgroundOffset(0, canvasTileGeometry(2).tileWidth)).toBe(-2 * CANVAS_PAGE_SIZE);
  });
});

describe("canvasTileGrid()", () => {
  it("covers the pane plus one whole tile on each axis", () => {
    const geometry = canvasTileGeometry(1);
    const tiles = canvasTileGrid(1000, 800, geometry.tileWidth, geometry.tileHeight);
    const columns = Math.ceil(1000 / geometry.tileWidth) + 1;
    const rows = Math.ceil(800 / geometry.tileHeight) + 1;
    expect(tiles).toHaveLength(columns * rows);
    for (const tile of tiles) {
      expect(tile.x % geometry.tileWidth).toBe(0);
      expect(tile.y % geometry.tileHeight).toBe(0);
      expect(tile.x + geometry.tileWidth).toBeGreaterThan(0);
      expect(tile.y + geometry.tileHeight).toBeGreaterThan(0);
    }
    expect(tiles.at(-1)?.x).toBe((columns - 1) * geometry.tileWidth);
    expect(tiles.at(-1)?.y).toBe((rows - 1) * geometry.tileHeight);
  });

  it("adds tiles when the tile shrinks with the zoom", () => {
    const wide = canvasTileGeometry(1);
    const narrow = canvasTileGeometry(0.5);
    expect(canvasTileGrid(1000, 800, narrow.tileWidth, narrow.tileHeight).length).toBeGreaterThan(
      canvasTileGrid(1000, 800, wide.tileWidth, wide.tileHeight).length
    );
  });
});

describe("<CanvasBackground />", () => {
  beforeEach(() => {
    fakeStore.reset();
  });

  it("moves the layer on the compositor when the viewport pans", () => {
    render(<CanvasBackground />);
    const layer = backgroundLayer();
    const tile = canvasTileGeometry(1);

    act(() => fakeStore.setTransform([137, -42, 1]));

    expect(layer.style.transform).toBe(
      `translate3d(${canvasBackgroundOffset(137, tile.tileWidth)}px, ${canvasBackgroundOffset(
        -42,
        tile.tileHeight
      )}px, 0)`
    );
    expect(layer.style.willChange).toBe("transform");
  });

  it("never touches the tile markup during a pan", () => {
    render(<CanvasBackground />);
    const markup = tileMarkup();

    act(() => fakeStore.setTransform([-310, 88, 1]));
    act(() => fakeStore.setTransform([900, -540, 1]));

    expect(tileMarkup()).toBe(markup);
  });

  it("rasterizes a new tile when the zoom changes", () => {
    render(<CanvasBackground />);

    expect(tileGeometry()?.getAttribute("style")).toContain(
      `font-size: ${canvasTileGeometry(1).fontSize}px`
    );

    act(() => fakeStore.setTransform([0, 0, 2]));

    expect(tileGeometry()?.getAttribute("style")).toContain(
      `font-size: ${canvasTileGeometry(2).fontSize}px`
    );
  });

  it("renders enough tiles for the pane", () => {
    render(<CanvasBackground />);
    const geometry = canvasTileGeometry(1);
    const expected = canvasTileGrid(1000, 800, geometry.tileWidth, geometry.tileHeight).length;

    expect(backgroundLayer().querySelectorAll("use")).toHaveLength(expected);

    act(() => fakeStore.setSize(2000, 400));

    expect(backgroundLayer().querySelectorAll("use")).toHaveLength(
      canvasTileGrid(2000, 400, geometry.tileWidth, geometry.tileHeight).length
    );
  });
});
