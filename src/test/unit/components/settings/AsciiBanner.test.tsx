import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AsciiBanner } from "../../../../components/settings/AsciiBanner";
import {
  type AsciiCanvasEnv,
  setupAsciiCanvas,
} from "../../../support/ascii-canvas";

let env: AsciiCanvasEnv;
afterEach(() => env?.cleanup());

describe("AsciiBanner", () => {
  it("exposes the banner to assistive tech with an accessible name", () => {
    env = setupAsciiCanvas();
    render(<AsciiBanner label="maibuk" />);

    expect(screen.getByRole("img", { name: "maibuk" })).toBeInTheDocument();
  });

  it("paints the static art under reduced motion without animating", async () => {
    env = setupAsciiCanvas({ reduceMotion: true });
    render(<AsciiBanner />);

    await waitFor(() => expect(env.ctx.fillText).toHaveBeenCalled());
    expect(env.raf).not.toHaveBeenCalled();
  });

  it("animates its entrance once scrolled into view", async () => {
    env = setupAsciiCanvas({ reduceMotion: false });
    render(<AsciiBanner />);

    // The IntersectionObserver stub reports the banner visible immediately, so
    // the entrance loop should request frames.
    await waitFor(() => expect(env.raf).toHaveBeenCalled());
  });

  it("draws glyphs while the entrance animation runs", async () => {
    env = setupAsciiCanvas({ reduceMotion: false });
    render(<AsciiBanner />);

    await waitFor(() => expect(env.raf).toHaveBeenCalled());
    env.ctx.fillText.mockClear();
    env.flushFrame(performance.now());

    expect(env.ctx.fillText).toHaveBeenCalled();
  });

  it("reacts to the cursor once the entrance has settled", async () => {
    env = setupAsciiCanvas({ reduceMotion: false });
    render(<AsciiBanner />);

    await waitFor(() => expect(env.raf).toHaveBeenCalled());

    const banner = screen.getByRole("img");
    banner.dispatchEvent(new MouseEvent("mouseenter"));
    banner.dispatchEvent(new MouseEvent("mousemove", { clientX: 40, clientY: 15 }));

    env.ctx.fillText.mockClear();
    // A timestamp far past the entrance marks it complete, enabling the hover
    // brightening/distortion branch.
    env.flushFrame(performance.now() + 1_000_000);

    expect(env.ctx.fillText).toHaveBeenCalled();
  });
});
