import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRef } from "react";
import { useFlipReorder } from "@/hooks/useFlipReorder";

const ROW_HEIGHT = 40;

interface HarnessProps {
  order: string[];
  options?: { selector?: string; skipKey?: string | null; scope?: string };
}

function Harness({ order, options }: HarnessProps) {
  const ref = useRef<HTMLDivElement>(null);
  useFlipReorder(ref, order, options);
  return (
    <div ref={ref} data-testid="list">
      {order.map((key) => (
        <div key={key} data-key={key}>
          {key}
        </div>
      ))}
    </div>
  );
}

const rowsOf = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>("[data-key]"));

function setMatchMedia(reduced: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: reduced && query === "(prefers-reduced-motion: reduce)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
}

describe("useFlipReorder", () => {
  let rectSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setMatchMedia(false);
    // Each row sits at index * ROW_HEIGHT inside the content, so its viewport
    // top is that minus the container's scrollTop. The container is at viewport 0.
    rectSpy = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
      this: Element
    ) {
      const container =
        this.parentElement?.getAttribute("data-testid") === "list" ? this.parentElement : null;
      if (this.getAttribute("data-testid") === "list") {
        return {
          top: 0,
          bottom: 400,
          left: 0,
          right: 300,
          height: 400,
          width: 300,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        } as DOMRect;
      }
      const index = Array.from(this.parentElement?.children ?? []).indexOf(this);
      const scrollTop = container?.scrollTop ?? 0;
      const top = index * ROW_HEIGHT - scrollTop;
      return {
        top,
        bottom: top + ROW_HEIGHT,
        left: 0,
        right: 300,
        height: ROW_HEIGHT,
        width: 300,
        x: 0,
        y: top,
        toJSON: () => ({}),
      } as DOMRect;
    });
  });

  afterEach(() => {
    rectSpy.mockRestore();
    vi.restoreAllMocks();
  });

  function attachAnimate(container: HTMLElement) {
    const animate = vi.fn(
      (_keyframes: Keyframe[], _options: KeyframeAnimationOptions) =>
        ({ cancel: vi.fn() }) as unknown as Animation
    );
    for (const row of rowsOf(container)) {
      row.animate = animate;
    }
    return animate;
  }

  it("animates each moved row from its old offset to zero and leaves unmoved rows alone", () => {
    const { getByTestId, rerender } = render(<Harness order={["a", "b", "c"]} />);
    const container = getByTestId("list");
    const animate = attachAnimate(container);

    rerender(<Harness order={["a", "c", "b"]} />);

    // c moved from 80 to 40 (delta +40); b moved from 40 to 80 (delta -40); a stayed at 0.
    expect(animate).toHaveBeenCalledTimes(2);
    const rows = Object.fromEntries(rowsOf(container).map((row) => [row.dataset.key, row]));
    expect(rows.c.animate).toBe(animate);
    expect(animate).toHaveBeenCalledWith(
      [{ transform: "translateY(40px)" }, { transform: "translateY(0)" }],
      { duration: 220, easing: "cubic-bezier(0.2, 0, 0, 1)" }
    );
    expect(animate).toHaveBeenCalledWith(
      [{ transform: "translateY(-40px)" }, { transform: "translateY(0)" }],
      { duration: 220, easing: "cubic-bezier(0.2, 0, 0, 1)" }
    );
  });

  it("moves rows without gliding when the scope changes with the order", () => {
    const { getByTestId, rerender } = render(
      <Harness order={["a", "b", "c"]} options={{ scope: "list" }} />
    );
    const animate = attachAnimate(getByTestId("list"));

    rerender(<Harness order={["c", "b", "a"]} options={{ scope: "tree" }} />);
    expect(animate).not.toHaveBeenCalled();

    rerender(<Harness order={["a", "b", "c"]} options={{ scope: "tree" }} />);
    expect(animate).toHaveBeenCalledTimes(2);
  });

  it("glides a row re-sorted mid-glide from where it shows, not from where it was laid out", () => {
    // A row's box includes its in-flight transform; layout does not.
    const translateOf = (element: Element) =>
      Number(
        /matrix\(1, 0, 0, 1, 0, (-?[\d.]+)\)/.exec((element as HTMLElement).style.transform)?.[1] ??
          0
      );
    rectSpy.mockImplementation(function (this: Element) {
      const isContainer = this.getAttribute("data-testid") === "list";
      const index = Array.from(this.parentElement?.children ?? []).indexOf(this);
      const top = isContainer ? 0 : index * ROW_HEIGHT + translateOf(this);
      return {
        top,
        bottom: top + ROW_HEIGHT,
        left: 0,
        right: 300,
        height: ROW_HEIGHT,
        width: 300,
        x: 0,
        y: top,
        toJSON: () => ({}),
      } as DOMRect;
    });
    const { getByTestId, rerender } = render(<Harness order={["a", "b", "c"]} />);
    const container = getByTestId("list");
    const animate = attachAnimate(container);
    rerender(<Harness order={["c", "b", "a"]} />);
    animate.mockClear();

    // c glided up from 80 to 0 and is still 30px short of its place.
    const c = rowsOf(container).find((row) => row.dataset.key === "c");
    if (!c) throw new Error("no row c");
    c.style.transform = "matrix(1, 0, 0, 1, 0, 30)";
    rerender(<Harness order={["b", "c", "a"]} />);

    // It shows at 30 and now belongs at 40: a 10px glide down, not a jump.
    expect(c.animate).toHaveBeenCalledWith(
      [{ transform: "translateY(-10px)" }, { transform: "translateY(0)" }],
      { duration: 220, easing: "cubic-bezier(0.2, 0, 0, 1)" }
    );
  });

  it("does not animate the row named by skipKey", () => {
    const { getByTestId, rerender } = render(
      <Harness order={["a", "b", "c"]} options={{ skipKey: "b" }} />
    );
    const container = getByTestId("list");
    const animate = attachAnimate(container);

    rerender(<Harness order={["a", "c", "b"]} options={{ skipKey: "b" }} />);

    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate).toHaveBeenCalledWith(
      [{ transform: "translateY(40px)" }, { transform: "translateY(0)" }],
      { duration: 220, easing: "cubic-bezier(0.2, 0, 0, 1)" }
    );
  });

  it("does not animate any row when prefers-reduced-motion is set", () => {
    setMatchMedia(true);
    const { getByTestId, rerender } = render(<Harness order={["a", "b", "c"]} />);
    const container = getByTestId("list");
    const animate = attachAnimate(container);

    rerender(<Harness order={["c", "b", "a"]} />);

    expect(animate).not.toHaveBeenCalled();
  });

  it("does not animate when the order is unchanged even if positions shifted", () => {
    const { getByTestId, rerender } = render(<Harness order={["a", "b", "c"]} />);
    const container = getByTestId("list");
    const animate = attachAnimate(container);

    // Same keys in the same order, but row "b" now measures taller, so its
    // top relative to the container moves. The order signature did not change.
    rectSpy.mockImplementation(function (this: Element) {
      const isContainer = this.getAttribute("data-testid") === "list";
      const index = Array.from(this.parentElement?.children ?? []).indexOf(this);
      const top = isContainer
        ? 0
        : index * ROW_HEIGHT + (this.getAttribute("data-key") === "c" ? 25 : 0);
      return {
        top,
        bottom: top + ROW_HEIGHT,
        left: 0,
        right: 300,
        height: ROW_HEIGHT,
        width: 300,
        x: 0,
        y: top,
        toJSON: () => ({}),
      } as DOMRect;
    });
    rerender(<Harness order={["a", "b", "c"]} />);

    expect(animate).not.toHaveBeenCalled();
  });

  it("leaves container.scrollTop unchanged across a reorder", () => {
    const { getByTestId, rerender } = render(<Harness order={["a", "b", "c"]} />);
    const container = getByTestId("list");
    container.scrollTop = 120;
    const animate = attachAnimate(container);

    rerender(<Harness order={["a", "c", "b"]} />);

    expect(container.scrollTop).toBe(120);
    expect(animate).toHaveBeenCalledTimes(2);
  });

  it("ignores a key that mounts between two measurements and animates the rows that stayed", () => {
    // A Virtualizer mounts rows near the viewport as it scrolls, so a key can
    // appear in the DOM only after the previous measurement. It has no earlier
    // top to glide from, so it must not animate. The rows that stayed do.
    const animated: string[] = [];
    const saved = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "animate");
    Object.defineProperty(HTMLElement.prototype, "animate", {
      configurable: true,
      value(this: HTMLElement) {
        animated.push(this.dataset.key ?? "");
        return { cancel: vi.fn() } as unknown as Animation;
      },
    });
    try {
      const { rerender } = render(<Harness order={["a", "b", "c"]} />);
      rerender(<Harness order={["x", "a", "c", "b"]} />);

      // a moves 0 to 40 and b moves 40 to 120; c stays at 80 and does not glide.
      expect(animated).not.toContain("x");
      expect(animated.sort()).toEqual(["a", "b"]);
    } finally {
      if (saved) Object.defineProperty(HTMLElement.prototype, "animate", saved);
      else Reflect.deleteProperty(HTMLElement.prototype, "animate");
    }
  });
});
