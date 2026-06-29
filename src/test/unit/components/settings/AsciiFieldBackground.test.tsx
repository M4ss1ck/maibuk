import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AsciiFieldBackground } from "../../../../components/settings/AsciiFieldBackground";
import { type AsciiCanvasEnv, setupAsciiCanvas } from "../../../support/ascii-canvas";

let env: AsciiCanvasEnv;
afterEach(() => env?.cleanup());

function moveMouse(clientX: number, clientY: number) {
  window.dispatchEvent(new MouseEvent("mousemove", { clientX, clientY }));
}

describe("AsciiFieldBackground", () => {
  it("is decorative and never intercepts pointer input", () => {
    env = setupAsciiCanvas();
    const { container } = render(<AsciiFieldBackground />);

    const wrapper = container.querySelector("[aria-hidden='true']");
    expect(wrapper).not.toBeNull();
    // The field sits behind the Settings UI; it must not swallow clicks/scroll.
    expect(wrapper).toHaveClass("pointer-events-none");
  });

  it("paints the glyph field once fonts are ready", async () => {
    env = setupAsciiCanvas();
    render(<AsciiFieldBackground />);

    await waitFor(() => expect(env.ctx.fillText).toHaveBeenCalled());
  });

  it("starts the shimmer when the cursor moves over the field", async () => {
    env = setupAsciiCanvas();
    render(<AsciiFieldBackground />);

    await waitFor(() => expect(env.ctx.fillText).toHaveBeenCalled());
    env.raf.mockClear();

    moveMouse(100, 100);
    expect(env.raf).toHaveBeenCalled();
  });

  it("does not react to the cursor under reduced motion", async () => {
    env = setupAsciiCanvas({ reduceMotion: true });
    render(<AsciiFieldBackground />);

    await waitFor(() => expect(env.ctx.fillText).toHaveBeenCalled());
    env.raf.mockClear();

    moveMouse(100, 100);
    expect(env.raf).not.toHaveBeenCalled();
  });

  it("eases back to a static field and stops once the cursor settles", async () => {
    env = setupAsciiCanvas();
    render(<AsciiFieldBackground />);

    await waitFor(() => expect(env.ctx.fillText).toHaveBeenCalled());

    const t0 = performance.now();
    moveMouse(100, 100);

    // A frame right after the move is still "active" and keeps animating.
    env.raf.mockClear();
    env.flushFrame(t0);
    expect(env.raf).toHaveBeenCalled();

    // A frame well past the hold + fade window settles to zero influence and
    // does not schedule another — the loop stops instead of snapping off.
    env.raf.mockClear();
    env.flushFrame(t0 + 5000);
    expect(env.raf).not.toHaveBeenCalled();
  });
});
