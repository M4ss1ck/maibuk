import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider } from "@/components/ThemeProvider";
import { useThemeStore } from "@/features/theme/store";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function mockMediaQuery(matches: (query: string) => boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: matches(query),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

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
    document.documentElement.removeAttribute("data-motion");
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

  it("marks the root as reduced motion while the OS query matches", () => {
    mockMediaQuery((query) => query === REDUCED_MOTION);
    renderProvider(<div>content</div>);
    expect(document.documentElement).toHaveAttribute("data-motion", "reduce");
  });

  it("leaves data-motion off when the OS query does not match", () => {
    mockMediaQuery(() => false);
    renderProvider(<div>content</div>);
    expect(document.documentElement).not.toHaveAttribute("data-motion");
  });

  it("follows the OS query as it flips, both directions", () => {
    const handlers = new Map<string, () => void>();
    let reduceMotion = false;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      get matches() {
        return query === REDUCED_MOTION && reduceMotion;
      },
      media: query,
      addEventListener: vi.fn((_type: string, handler: () => void) => {
        handlers.set(query, handler);
      }),
      removeEventListener: vi.fn(),
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    renderProvider(<div>content</div>);
    expect(document.documentElement).not.toHaveAttribute("data-motion");

    act(() => {
      reduceMotion = true;
      handlers.get(REDUCED_MOTION)?.();
    });
    expect(document.documentElement).toHaveAttribute("data-motion", "reduce");

    act(() => {
      reduceMotion = false;
      handlers.get(REDUCED_MOTION)?.();
    });
    expect(document.documentElement).not.toHaveAttribute("data-motion");
  });
});
