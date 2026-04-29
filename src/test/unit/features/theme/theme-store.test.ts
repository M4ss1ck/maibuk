import { describe, it, expect, beforeEach } from "vitest";
import { useThemeStore, applyTheme } from "../../../../features/theme/store";

describe("useThemeStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useThemeStore.setState({ theme: "system" });
    // Clean up any leftover dark class
    document.documentElement.classList.remove("dark");
  });

  describe("initial state", () => {
    it("defaults to system theme", () => {
      expect(useThemeStore.getState().theme).toBe("system");
    });
  });

  describe("setTheme()", () => {
    it("sets theme to dark", () => {
      useThemeStore.getState().setTheme("dark");
      expect(useThemeStore.getState().theme).toBe("dark");
    });

    it("sets theme to light", () => {
      useThemeStore.getState().setTheme("light");
      expect(useThemeStore.getState().theme).toBe("light");
    });

    it("sets theme back to system", () => {
      useThemeStore.getState().setTheme("dark");
      useThemeStore.getState().setTheme("system");
      expect(useThemeStore.getState().theme).toBe("system");
    });
  });
});

describe("applyTheme()", () => {
  beforeEach(() => {
    document.documentElement.classList.remove("dark");
  });

  it("adds dark class for dark theme", () => {
    applyTheme("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("removes dark class for light theme", () => {
    document.documentElement.classList.add("dark");
    applyTheme("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("respects prefers-color-scheme for system theme (dark)", () => {
    // jsdom matchMedia always returns false by default,
    // so we need to mock it for the dark preference case
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = (query: string) =>
      ({
        matches: query === "(prefers-color-scheme: dark)",
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList;

    applyTheme("system");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    window.matchMedia = originalMatchMedia;
  });

  it("removes dark class for system theme when user prefers light", () => {
    document.documentElement.classList.add("dark");

    const originalMatchMedia = window.matchMedia;
    window.matchMedia = (query: string) =>
      ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList;

    applyTheme("system");
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    window.matchMedia = originalMatchMedia;
  });
});
