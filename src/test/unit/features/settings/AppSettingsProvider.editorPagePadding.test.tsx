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

describe("AppSettingsProvider editorPagePadding", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.style.removeProperty("--editor-page-padding");
  });

  it("sets --editor-page-padding to the shorthand pixel value", () => {
    useSettingsStore.setState({
      editorPagePadding: { top: 16, right: 24, bottom: 32, left: 40 },
    });
    render(<AppSettingsProvider>child</AppSettingsProvider>);
    expect(
      document.documentElement.style.getPropertyValue("--editor-page-padding"),
    ).toBe("16px 24px 32px 40px");
  });
});
