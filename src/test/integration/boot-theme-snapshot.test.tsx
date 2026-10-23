import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../i18n", () => ({
  default: { language: "en", changeLanguage: vi.fn() },
  detectSystemLocale: vi.fn().mockResolvedValue("en"),
}));

vi.mock("../../lib/platform", () => ({
  IS_DESKTOP: false,
  setWindowAlwaysOnTop: vi.fn().mockResolvedValue(undefined),
  isLaunchOnStartupEnabled: vi.fn().mockResolvedValue(false),
  setLaunchOnStartup: vi.fn().mockResolvedValue(undefined),
}));

const { ThemeProvider } = await import("@/components/ThemeProvider");
const { AppSettingsProvider } = await import("@/features/settings/AppSettingsProvider");
const { useThemeStore } = await import("@/features/theme/store");
const { useSettingsStore } = await import("@/features/settings/store");
const { BOOT_THEME_KEY } = await import("@/features/theme/boot-theme");

function snapshot() {
  const raw = localStorage.getItem(BOOT_THEME_KEY);
  return raw === null ? null : JSON.parse(raw);
}

describe("boot theme snapshot", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
    useThemeStore.setState({ theme: "system" });
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
});
