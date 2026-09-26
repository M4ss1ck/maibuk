import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider } from "@/components/ThemeProvider";
import { useThemeStore } from "@/features/theme/store";

function renderProvider(children: React.ReactNode, path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ThemeProvider>{children}</ThemeProvider>
    </MemoryRouter>
  );
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    useThemeStore.setState({ theme: "system" });
    document.documentElement.classList.remove("dark");
  });

  it("renders children", () => {
    renderProvider(<div>child content</div>);
    expect(screen.getByText("child content")).toBeInTheDocument();
  });

  it("adds dark class when theme is dark", () => {
    useThemeStore.setState({ theme: "dark" });
    renderProvider(<div>content</div>);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("removes dark class when theme is light", () => {
    document.documentElement.classList.add("dark");
    useThemeStore.setState({ theme: "light" });
    renderProvider(<div>content</div>);
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
    renderProvider(<div>content</div>);
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
    const { unmount } = renderProvider(<div>content</div>);
    expect(addEventListenerMock).toHaveBeenCalledWith("change", expect.any(Function));
    unmount();
    expect(removeEventListenerMock).toHaveBeenCalledWith("change", expect.any(Function));
  });

  it("leaves the document theme to the Embed route", () => {
    // /embed?theme=dark has already set the class; the app theme (light here)
    // must not win.
    document.documentElement.classList.add("dark");
    useThemeStore.setState({ theme: "light" });
    renderProvider(<div>content</div>, "/embed?theme=dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});
