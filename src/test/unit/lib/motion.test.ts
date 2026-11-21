// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { applyMotion, prefersReducedMotion, REDUCED_MOTION_QUERY } from "@/lib/motion";

afterEach(() => {
  document.documentElement.removeAttribute("data-motion");
});

describe("motion", () => {
  it("names the OS reduced-motion query", () => {
    expect(REDUCED_MOTION_QUERY).toBe("(prefers-reduced-motion: reduce)");
  });

  it("reads reduced motion only from data-motion=reduce", () => {
    expect(prefersReducedMotion()).toBe(false);
    document.documentElement.setAttribute("data-motion", "reduce");
    expect(prefersReducedMotion()).toBe(true);
    document.documentElement.setAttribute("data-motion", "other");
    expect(prefersReducedMotion()).toBe(false);
  });

  it("sets and clears the attribute", () => {
    applyMotion(true);
    expect(document.documentElement.getAttribute("data-motion")).toBe("reduce");
    applyMotion(false);
    expect(document.documentElement.hasAttribute("data-motion")).toBe(false);
  });

  it("works on an explicit root", () => {
    const root = document.createElement("div");
    applyMotion(true, root);
    expect(prefersReducedMotion(root)).toBe(true);
    expect(document.documentElement.hasAttribute("data-motion")).toBe(false);
    applyMotion(false, root);
    expect(prefersReducedMotion(root)).toBe(false);
  });
});
