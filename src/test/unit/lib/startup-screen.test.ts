import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  captureStartupScreen,
  consumeStartupEntrance,
  endBooting,
  resetStartupScreenForTests,
  startupEntranceDelay,
} from "@/lib/startup-screen";

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

describe("startupEntranceDelay()", () => {
  /** The inline screen index.html paints, with a stubbed entrance animation. */
  function mountStartupScreen(currentTime?: number | null): void {
    const screen = document.createElement("div");
    screen.id = "startup-screen";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    if (currentTime !== undefined) {
      // jsdom has no Element.getAnimations; the browser returns the running entrance.
      Object.defineProperty(svg, "getAnimations", {
        value: () => [{ currentTime }],
        configurable: true,
      });
    }
    screen.append(svg);
    document.body.append(screen);
  }

  beforeEach(() => {
    resetStartupScreenForTests();
  });

  afterEach(() => {
    for (const screen of document.querySelectorAll("#startup-screen")) screen.remove();
    resetStartupScreenForTests();
  });

  it("is null when there is no startup screen to continue", () => {
    captureStartupScreen(document, () => 0);

    expect(startupEntranceDelay(() => 0)).toBeNull();
  });

  it("resumes the entrance from the time the inline screen already ran", () => {
    mountStartupScreen(200);
    captureStartupScreen(document, () => 1000);

    expect(startupEntranceDelay(() => 1050)).toBe("-250ms");
  });

  it("treats a screen without getAnimations as already finished", () => {
    mountStartupScreen();
    captureStartupScreen(document, () => 0);

    expect(startupEntranceDelay(() => 0)).toBe("-60000ms");
  });

  it("treats a running animation with no current time as already finished", () => {
    mountStartupScreen(null);
    captureStartupScreen(document, () => 0);

    expect(startupEntranceDelay(() => 0)).toBe("-60000ms");
  });

  it("still shows the end state just after the capture, within two seconds", () => {
    mountStartupScreen();
    captureStartupScreen(document, () => 0);

    expect(startupEntranceDelay(() => 1999)).toBe("-61999ms");
  });

  it("expires a capture that is two seconds old, so a later screen animates from the start", () => {
    mountStartupScreen();
    captureStartupScreen(document, () => 0);

    expect(startupEntranceDelay(() => 2000)).toBeNull();
  });

  it("holds the end state when the entrance finished while waiting for the first render", () => {
    mountStartupScreen(200);
    captureStartupScreen(document, () => 0);

    // A null here would restart the entrance under React: the flicker #624 removes.
    expect(startupEntranceDelay(() => 400)).toBe("-600ms");
  });

  it("has no delay once the capture is stale", () => {
    mountStartupScreen(200);
    captureStartupScreen(document, () => 0);

    expect(startupEntranceDelay(() => 2000)).toBeNull();
  });

  it("has no delay once the capture is consumed", () => {
    mountStartupScreen(200);
    captureStartupScreen(document, () => 0);
    consumeStartupEntrance();

    expect(startupEntranceDelay(() => 50)).toBeNull();
  });
});
