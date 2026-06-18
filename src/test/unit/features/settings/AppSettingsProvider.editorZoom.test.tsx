import { render } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../../i18n", () => ({
  default: { language: "en", changeLanguage: vi.fn() },
  detectSystemLocale: vi.fn().mockResolvedValue("en"),
}));

vi.mock("../../../../lib/platform", () => ({
  setWindowAlwaysOnTop: vi.fn().mockResolvedValue(undefined),
  isLaunchOnStartupEnabled: vi.fn().mockResolvedValue(false),
  setLaunchOnStartup: vi.fn().mockResolvedValue(undefined),
}));

const { AppSettingsProvider } = await import(
  "../../../../features/settings/AppSettingsProvider"
);
const { useSettingsStore } = await import("../../../../features/settings/store");

describe("AppSettingsProvider editorZoom", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.style.removeProperty("--editor-zoom");
  });

  it("sets --editor-zoom to the zoom factor", () => {
    useSettingsStore.setState({ editorZoom: 150 });
    render(<AppSettingsProvider>child</AppSettingsProvider>);
    expect(
      document.documentElement.style.getPropertyValue("--editor-zoom")
    ).toBe("1.5");
  });
});
