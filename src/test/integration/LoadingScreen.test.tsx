import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { LoadingScreen } from "@/components/LoadingScreen";

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
});
