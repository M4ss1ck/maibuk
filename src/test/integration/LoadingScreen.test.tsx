import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LoadingScreen } from "@/components/LoadingScreen";
import { captureStartupScreen, resetStartupScreenForTests } from "@/lib/startup-screen";
import "@/i18n";

/** The inline screen index.html paints, with a stubbed entrance animation. */
function mountStartupScreen(currentTime: number): void {
  const startupScreen = document.createElement("div");
  startupScreen.id = "startup-screen";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  // jsdom has no Element.getAnimations; the browser returns the running entrance.
  Object.defineProperty(svg, "getAnimations", {
    value: () => [{ currentTime }],
    configurable: true,
  });
  startupScreen.append(svg);
  document.body.append(startupScreen);
}

/** The inline animation delay in ms, or null when the logo carries none. */
function animationDelay(container: HTMLElement): number | null {
  const logo = container.querySelector("svg.loading-entrance");
  if (!logo) throw new Error("LoadingScreen rendered no logo");
  const { animationDelay: value } = (logo as SVGElement).style;
  return value === "" ? null : Number.parseFloat(value);
}

beforeEach(() => {
  resetStartupScreenForTests();
});

afterEach(() => {
  for (const startupScreen of document.querySelectorAll("#startup-screen")) startupScreen.remove();
  resetStartupScreenForTests();
});

describe("LoadingScreen", () => {
  it("renders the app logo", () => {
    const { container } = render(<LoadingScreen />);
    const logo = container.querySelector("svg.loading-entrance");
    expect(logo).toBeInTheDocument();
    expect(logo?.tagName).toBe("svg");
  });

  it("applies entrance animation to the logo", () => {
    const { container } = render(<LoadingScreen />);
    const logo = container.querySelector("svg.loading-entrance");
    expect(logo?.classList.contains("loading-entrance")).toBe(true);
  });

  it("uses full dynamic viewport height", () => {
    const { container } = render(<LoadingScreen />);
    const wrapper = container.firstElementChild;
    expect(wrapper?.className).toContain("h-dvh");
    expect(wrapper?.className).toContain("bg-background");
  });

  it("announces the loading status in the current locale", () => {
    render(<LoadingScreen />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading Maibuk");
  });

  it("continues the inline logo entrance instead of restarting it", () => {
    mountStartupScreen(200);
    captureStartupScreen();

    const { container } = render(<LoadingScreen />);

    const delay = animationDelay(container) as number;
    expect(delay).toBeLessThanOrEqual(-200);
    // Only a boot slower than the 0.5s entrance reads as the finished fallback.
    expect(delay).toBeGreaterThan(-60_000);
  });

  it("starts the entrance from the beginning without an inline screen", () => {
    const { container } = render(<LoadingScreen />);

    expect(animationDelay(container)).toBeNull();
  });

  it("animates normally when a later LoadingScreen mounts", () => {
    mountStartupScreen(200);
    captureStartupScreen();
    const first = render(<LoadingScreen />);
    expect(animationDelay(first.container)).not.toBeNull();
    first.unmount();

    const { container } = render(<LoadingScreen />);

    expect(animationDelay(container)).toBeNull();
  });
});
