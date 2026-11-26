/**
 * The Reader Frame's environment signals (#943 unit 1): the Frame's own width
 * decides the layout mode and touch target, never the host viewport, and the
 * host's `--maibuk-motion` token decides whether motion runs. Both are drawn
 * into the Frame's root as data attributes, so CSS can act on them without a
 * media query.
 *
 * The hooks are driven through a real Preact tree in jsdom: a probe component
 * renders what each hook returns, so the tests press the same events the Frame
 * sees (a resize, a pointer-media change, the host rewriting its token) rather
 * than calling an internal helper.
 */

/** @jsxImportSource preact */
import { type ComponentChild, createPortal, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FrameRoot } from "./app";
import { useLayoutMode } from "./use-layout-mode";
import { useReducedMotion } from "./use-reduced-motion";

const COARSE_POINTER = "(pointer: coarse)";

type MediaListener = (event: MediaQueryListEvent) => void;

const nativeMatchMedia = window.matchMedia;
const nativeInnerWidth = window.innerWidth;
const containers: HTMLElement[] = [];
let coarse = false;
const coarseListeners = new Set<MediaListener>();

function fakeMatchMedia(query: string): MediaQueryList {
  const isCoarseQuery = query === COARSE_POINTER;
  return {
    get matches() {
      return isCoarseQuery ? coarse : false;
    },
    media: query,
    onchange: null,
    addEventListener(_type: string, listener: EventListenerOrEventListenerObject) {
      if (isCoarseQuery && typeof listener === "function") {
        coarseListeners.add(listener as MediaListener);
      }
    },
    removeEventListener(_type: string, listener: EventListenerOrEventListenerObject) {
      if (isCoarseQuery && typeof listener === "function") {
        coarseListeners.delete(listener as MediaListener);
      }
    },
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  } as MediaQueryList;
}

/** Flips the pointer media and tells every listener, as the browser does. */
function setCoarse(next: boolean) {
  coarse = next;
  const event = { matches: next, media: COARSE_POINTER } as MediaQueryListEvent;
  for (const listener of coarseListeners) listener(event);
}

function setInnerWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

async function mount(node: ComponentChild): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  await act(() => {
    render(node, container);
  });
  return container;
}

function LayoutProbe() {
  const layout = useLayoutMode();
  return <output data-mode={layout.mode} data-target={String(layout.target)} />;
}

function MotionProbe() {
  const reduce = useReducedMotion();
  return <output data-reduce={String(reduce)} />;
}

function probe(container: HTMLElement): HTMLOutputElement {
  const element = container.querySelector("output");
  if (!(element instanceof HTMLOutputElement)) throw new Error("the probe did not render");
  return element;
}

function setMotionToken(value: "reduce" | "no-preference") {
  document.documentElement.style.setProperty("--maibuk-motion", value);
}

beforeEach(() => {
  coarse = false;
  coarseListeners.clear();
  window.matchMedia = fakeMatchMedia as typeof window.matchMedia;
  setInnerWidth(1024);
});

afterEach(async () => {
  await act(() => {
    for (const container of containers.splice(0)) {
      render(null, container);
      container.remove();
    }
  });
  document.documentElement.style.removeProperty("--maibuk-motion");
  document.documentElement.removeAttribute("data-color-scheme");
  document.documentElement.removeAttribute("data-eink");
  document.documentElement.removeAttribute("data-motion");
  window.matchMedia = nativeMatchMedia;
  setInnerWidth(nativeInnerWidth);
});

describe("useLayoutMode()", () => {
  it("draws Narrow and 44 px targets at 599 px", async () => {
    setInnerWidth(599);

    const container = await mount(<LayoutProbe />);

    expect(probe(container).dataset.mode).toBe("narrow");
    expect(probe(container).dataset.target).toBe("44");
  });

  it("draws Wide and 40 px targets at 600 px", async () => {
    setInnerWidth(600);

    const container = await mount(<LayoutProbe />);

    expect(probe(container).dataset.mode).toBe("wide");
    expect(probe(container).dataset.target).toBe("40");
  });

  it("keeps 44 px targets in Wide under a coarse pointer", async () => {
    coarse = true;
    setInnerWidth(600);

    const container = await mount(<LayoutProbe />);

    expect(probe(container).dataset.mode).toBe("wide");
    expect(probe(container).dataset.target).toBe("44");
  });

  it("updates when the Frame resizes", async () => {
    setInnerWidth(599);
    const container = await mount(<LayoutProbe />);
    expect(probe(container).dataset.mode).toBe("narrow");

    setInnerWidth(600);
    await act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(probe(container).dataset.mode).toBe("wide");
    expect(probe(container).dataset.target).toBe("40");
  });

  it("updates when the pointer media changes", async () => {
    setInnerWidth(800);
    const container = await mount(<LayoutProbe />);
    expect(probe(container).dataset.target).toBe("40");

    await act(() => {
      setCoarse(true);
    });

    expect(probe(container).dataset.target).toBe("44");
  });
});

describe("useReducedMotion()", () => {
  it("reads the host's motion token on mount", async () => {
    setMotionToken("reduce");

    const container = await mount(<MotionProbe />);

    expect(probe(container).dataset.reduce).toBe("true");
  });

  it("follows the host when it rewrites the token", async () => {
    setMotionToken("no-preference");
    const container = await mount(<MotionProbe />);
    expect(probe(container).dataset.reduce).toBe("false");

    await act(async () => {
      setMotionToken("reduce");
      await Promise.resolve();
    });

    await vi.waitFor(() => expect(probe(container).dataset.reduce).toBe("true"));

    await act(async () => {
      setMotionToken("no-preference");
      await Promise.resolve();
    });

    await vi.waitFor(() => expect(probe(container).dataset.reduce).toBe("false"));
  });
});

/** A node the test portals outside FrameRoot, the way the chrome's own roots sit. */
function OutsideProbe({ target }: { target: HTMLElement }) {
  return createPortal(<span id="outside-probe">outside</span>, target);
}

describe("FrameRoot", () => {
  it("publishes data-motion beside the existing appearance attributes", async () => {
    setMotionToken("reduce");

    const container = await mount(
      <FrameRoot>
        <span>chrome</span>
      </FrameRoot>
    );
    const wrapper = container.firstElementChild;
    if (!(wrapper instanceof HTMLElement)) throw new Error("FrameRoot did not render");

    expect(wrapper.dataset.motion).toBe("reduce");
    expect(wrapper.dataset.colorScheme).toBe("light");
    expect(wrapper.dataset.eink).toBe("false");
    expect(document.documentElement.dataset.motion).toBe("reduce");
    expect(document.documentElement.dataset.colorScheme).toBe("light");
    expect(document.documentElement.dataset.eink).toBe("false");
  });

  it("switches data-motion when the host changes the token", async () => {
    setMotionToken("no-preference");
    const container = await mount(<FrameRoot />);
    const wrapper = container.firstElementChild;
    if (!(wrapper instanceof HTMLElement)) throw new Error("FrameRoot did not render");
    expect(wrapper.dataset.motion).toBe("no-preference");
    expect(document.documentElement.dataset.motion).toBe("no-preference");

    await act(async () => {
      setMotionToken("reduce");
      await Promise.resolve();
    });

    await vi.waitFor(() => expect(wrapper.dataset.motion).toBe("reduce"));
    await vi.waitFor(() => expect(document.documentElement.dataset.motion).toBe("reduce"));
  });

  it("publishes the attributes where portalled chrome outside the wrapper can inherit them", async () => {
    setMotionToken("reduce");
    const outsideRoot = document.createElement("div");
    document.body.append(outsideRoot);

    await mount(
      <>
        <FrameRoot />
        <OutsideProbe target={outsideRoot} />
      </>
    );

    const outside = outsideRoot.querySelector("#outside-probe");
    expect(outside).not.toBeNull();
    expect(outside?.closest('[data-motion="reduce"]')).toBe(document.documentElement);
    expect(outside?.closest('[data-color-scheme="light"]')).toBe(document.documentElement);
    expect(outside?.closest('[data-eink="false"]')).toBe(document.documentElement);

    outsideRoot.remove();
  });

  it("restores whatever the document root carried when the Frame unmounts", async () => {
    const root = document.documentElement;
    root.setAttribute("data-color-scheme", "host-light");
    root.setAttribute("data-eink", "host-eink");
    root.setAttribute("data-motion", "host-motion");

    const container = await mount(<FrameRoot />);
    expect(root.dataset.colorScheme).toBe("light");
    expect(root.dataset.eink).toBe("false");
    expect(root.dataset.motion).toBe("no-preference");

    await act(() => {
      render(null, container);
    });
    container.remove();
    const index = containers.indexOf(container);
    if (index !== -1) containers.splice(index, 1);

    expect(root.dataset.colorScheme).toBe("host-light");
    expect(root.dataset.eink).toBe("host-eink");
    expect(root.dataset.motion).toBe("host-motion");
  });
});
