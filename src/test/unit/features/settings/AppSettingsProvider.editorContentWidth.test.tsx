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

describe("AppSettingsProvider editorContentWidth", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.style.removeProperty("--editor-content-width");
  });

  it("sets --editor-content-width to the width in px", () => {
    useSettingsStore.setState({ editorContentWidth: 960 });
    render(<AppSettingsProvider>child</AppSettingsProvider>);
    expect(
      document.documentElement.style.getPropertyValue("--editor-content-width"),
    ).toBe("960px");
  });
});
