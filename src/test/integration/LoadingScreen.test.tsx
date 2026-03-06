import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LoadingScreen } from "../../components/LoadingScreen";

describe("LoadingScreen", () => {
  it("renders the app logo", () => {
    render(<LoadingScreen />);
    const logo = screen.getByAltText("Maibuk");
    expect(logo).toBeInTheDocument();
    expect(logo.tagName).toBe("IMG");
  });

  it("applies pulse animation to the logo", () => {
    render(<LoadingScreen />);
    const logo = screen.getByAltText("Maibuk");
    expect(logo.className).toContain("animate-pulse");
  });

  it("uses full dynamic viewport height", () => {
    const { container } = render(<LoadingScreen />);
    const wrapper = container.firstElementChild;
    expect(wrapper?.className).toContain("h-dvh");
    expect(wrapper?.className).toContain("bg-background");
  });
});
