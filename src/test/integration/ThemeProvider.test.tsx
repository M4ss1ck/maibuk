import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "@/components/ThemeProvider";
import { useThemeStore } from "@/features/theme/store";

describe("ThemeProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    useThemeStore.setState({ theme: "system" });
    document.documentElement.classList.remove("dark");
  });

  it("renders children", () => {
    render(
      <ThemeProvider>
        <div>child content</div>
      </ThemeProvider>
    );
    expect(screen.getByText("child content")).toBeInTheDocument();
  });

  it("adds dark class when theme is dark", () => {
    useThemeStore.setState({ theme: "dark" });
    render(
      <ThemeProvider>
        <div>content</div>
      </ThemeProvider>
    );
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("removes dark class when theme is light", () => {
    document.documentElement.classList.add("dark");
    useThemeStore.setState({ theme: "light" });
    render(
      <ThemeProvider>
        <div>content</div>
      </ThemeProvider>
    );
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("applies system theme based on prefers-color-scheme dark", () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === "(prefers-color-scheme: dark)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    useThemeStore.setState({ theme: "system" });
    render(
      <ThemeProvider>
        <div>content</div>
      </ThemeProvider>
    );
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("subscribes to system theme changes and cleans up on unmount", () => {
    const addEventListenerMock = vi.fn();
    const removeEventListenerMock = vi.fn();
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: addEventListenerMock,
      removeEventListener: removeEventListenerMock,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    useThemeStore.setState({ theme: "system" });
    const { unmount } = render(
      <ThemeProvider>
        <div>content</div>
      </ThemeProvider>
    );
    expect(addEventListenerMock).toHaveBeenCalledWith("change", expect.any(Function));
    unmount();
    expect(removeEventListenerMock).toHaveBeenCalledWith("change", expect.any(Function));
  });
});
