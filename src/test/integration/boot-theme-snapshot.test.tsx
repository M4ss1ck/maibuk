import { act, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../i18n", () => ({
  default: { language: "en", changeLanguage: vi.fn() },
  detectSystemLocale: vi.fn().mockResolvedValue("en"),
}));

const { mockSetWindowBackground } = vi.hoisted(() => ({
  mockSetWindowBackground: vi.fn<(color: string) => Promise<void>>().mockResolvedValue(undefined),
}));

vi.mock("../../lib/platform", () => ({
  IS_DESKTOP: false,
  setWindowAlwaysOnTop: vi.fn().mockResolvedValue(undefined),
  isLaunchOnStartupEnabled: vi.fn().mockResolvedValue(false),
  setLaunchOnStartup: vi.fn().mockResolvedValue(undefined),
  setWindowBackground: mockSetWindowBackground,
}));

const { ThemeProvider } = await import("@/components/ThemeProvider");
const { AppSettingsProvider } = await import("@/features/settings/AppSettingsProvider");
const { useThemeStore } = await import("@/features/theme/store");
const { useSettingsStore } = await import("@/features/settings/store");
const { BOOT_THEME_KEY } = await import("@/features/theme/boot-theme");
const { resetWindowBackgroundForTests } = await import("@/features/theme/window-background");

function snapshot() {
  const raw = localStorage.getItem(BOOT_THEME_KEY);
  return raw === null ? null : JSON.parse(raw);
}

// The stylesheet is not loaded in jsdom, so --color-background resolves to ""
// unless a test says what it paints.
function stubComputedBackground(read: () => string) {
  return vi.spyOn(window, "getComputedStyle").mockReturnValue({
    getPropertyValue: (property: string) => (property === "--color-background" ? read() : ""),
  } as unknown as CSSStyleDeclaration);
}

describe("boot theme snapshot", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
    useThemeStore.setState({ theme: "system" });
    resetWindowBackgroundForTests();
    mockSetWindowBackground.mockClear();
  });

  it("records a committed theme change", () => {
    useThemeStore.setState({ theme: "dark" });
    render(
      <MemoryRouter initialEntries={["/"]}>
        <ThemeProvider>child</ThemeProvider>
      </MemoryRouter>
    );
    expect(snapshot()).toEqual({ v: 1, mode: "dark", vars: {} });
  });

  it("leaves the snapshot alone on the Embed route", () => {
    useThemeStore.setState({ theme: "light" });
    render(
      <MemoryRouter initialEntries={["/embed?theme=dark"]}>
        <ThemeProvider>child</ThemeProvider>
      </MemoryRouter>
    );
    expect(snapshot()).toBeNull();
  });

  it("records a committed primary color change", () => {
    useSettingsStore.setState({ primaryColor: "#123456" });
    render(<AppSettingsProvider>child</AppSettingsProvider>);
    expect(snapshot()).toEqual({
      v: 1,
      mode: "system",
      vars: {
        "--color-primary": "#123456",
        "--color-primary-hover": expect.any(String),
        "--color-primary-foreground": expect.any(String),
        "--color-primary-hover-foreground": expect.any(String),
      },
    });
  });

  it("reports the window background after applying a theme change", async () => {
    const computed = stubComputedBackground(() => "#1c1917");
    useThemeStore.setState({ theme: "dark" });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <ThemeProvider>child</ThemeProvider>
      </MemoryRouter>
    );

    await vi.waitFor(() => expect(mockSetWindowBackground).toHaveBeenCalledWith("#1c1917"));
    computed.mockRestore();
  });

  it("reports the new background when the system theme changes", async () => {
    let color = "#fafaf9";
    const computed = stubComputedBackground(() => color);
    let handler: (() => void) | null = null;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: (_event: string, listener: () => void) => {
        handler = listener;
      },
      removeEventListener: vi.fn(),
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    render(
      <MemoryRouter initialEntries={["/"]}>
        <ThemeProvider>child</ThemeProvider>
      </MemoryRouter>
    );
    await vi.waitFor(() => expect(mockSetWindowBackground).toHaveBeenCalledWith("#fafaf9"));

    color = "#1c1917";
    act(() => handler?.());

    await vi.waitFor(() => expect(mockSetWindowBackground).toHaveBeenLastCalledWith("#1c1917"));
    computed.mockRestore();
  });
});
