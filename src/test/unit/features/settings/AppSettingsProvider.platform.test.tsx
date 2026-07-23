import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockSetWindowAlwaysOnTop, mockIsLaunchOnStartupEnabled } = vi.hoisted(() => ({
  mockSetWindowAlwaysOnTop: vi.fn().mockResolvedValue(undefined),
  mockIsLaunchOnStartupEnabled: vi.fn().mockResolvedValue(false),
}));

vi.mock("../../../../i18n", () => ({
  default: { language: "en", changeLanguage: vi.fn() },
  detectSystemLocale: vi.fn().mockResolvedValue("en"),
}));

vi.mock("../../../../lib/platform", () => ({
  IS_DESKTOP: false,
  setWindowAlwaysOnTop: mockSetWindowAlwaysOnTop,
  isLaunchOnStartupEnabled: mockIsLaunchOnStartupEnabled,
  setLaunchOnStartup: vi.fn().mockResolvedValue(undefined),
}));

const { AppSettingsProvider } = await import("@/features/settings/AppSettingsProvider");
const { useSettingsStore } = await import("@/features/settings/store");

describe("AppSettingsProvider platform gating", () => {
  beforeEach(() => {
    localStorage.clear();
    mockSetWindowAlwaysOnTop.mockClear();
    mockIsLaunchOnStartupEnabled.mockClear();
  });

  it("does not synchronize desktop settings on Android", async () => {
    useSettingsStore.setState({ alwaysOnTop: true });
    render(
      <AppSettingsProvider>
        <div>child</div>
      </AppSettingsProvider>
    );

    await waitFor(() => expect(screen.getByText("child")).toBeInTheDocument());
    expect(mockSetWindowAlwaysOnTop).not.toHaveBeenCalled();
    expect(mockIsLaunchOnStartupEnabled).not.toHaveBeenCalled();
  });
});
