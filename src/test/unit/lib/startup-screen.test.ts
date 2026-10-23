import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { endBooting } from "@/lib/startup-screen";

describe("endBooting()", () => {
  let frames: FrameRequestCallback[];

  beforeEach(() => {
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    document.documentElement.setAttribute("data-booting", "");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.removeAttribute("data-booting");
  });

  it("keeps the attribute through the first frame and clears it after the second", () => {
    endBooting();

    expect(frames).toHaveLength(1);
    expect(document.documentElement.hasAttribute("data-booting")).toBe(true);

    frames.shift()?.(0);
    expect(frames).toHaveLength(1);
    expect(document.documentElement.hasAttribute("data-booting")).toBe(true);

    frames.shift()?.(16);
    expect(document.documentElement.hasAttribute("data-booting")).toBe(false);
  });
});
