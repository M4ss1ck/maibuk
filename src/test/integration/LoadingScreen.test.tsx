import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LoadingScreen } from "@/components/LoadingScreen";

describe("LoadingScreen", () => {
  it("renders the app logo", () => {
    render(<LoadingScreen />);
    const logo = screen.getByLabelText("Maibuk");
    expect(logo).toBeInTheDocument();
    expect(logo.tagName).toBe("svg");
  });

  it("applies entrance animation to the logo", () => {
    render(<LoadingScreen />);
    const logo = screen.getByLabelText("Maibuk");
    expect(logo.classList.contains("loading-entrance")).toBe(true);
  });

  it("uses full dynamic viewport height", () => {
    const { container } = render(<LoadingScreen />);
    const wrapper = container.firstElementChild;
    expect(wrapper?.className).toContain("h-dvh");
    expect(wrapper?.className).toContain("bg-background");
  });
});
