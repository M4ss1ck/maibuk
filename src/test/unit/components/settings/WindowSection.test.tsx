/**
 * Settings → Window on desktop: Resource Usage in the tray (#668) is off by
 * default and turned on and off with the keyboard alone.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/i18n";

vi.mock("@/lib/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/platform")>()),
  IS_DESKTOP: true,
  isMac: () => false,
}));

const { WindowSection } = await import("@/components/settings/WindowSection");
const { useSettingsStore } = await import("@/features/settings/store");

beforeEach(() => {
  useSettingsStore.setState({ trayResourceUsage: false, closeToTray: false });
});

describe("WindowSection", () => {
  it("turns Resource Usage in the tray on and off from the keyboard", async () => {
    const user = userEvent.setup();
    render(<WindowSection />);
    const toggle = screen.getByRole("switch", { name: "Show resource usage in tray" });

    for (let i = 0; i < 10 && document.activeElement !== toggle; i++) await user.tab();
    expect(document.activeElement).toBe(toggle);

    await user.keyboard(" ");
    expect(useSettingsStore.getState().trayResourceUsage).toBe(true);
    expect(toggle).toBeChecked();

    await user.keyboard(" ");
    expect(useSettingsStore.getState().trayResourceUsage).toBe(false);
    expect(useSettingsStore.getState().closeToTray).toBe(false);
  });

  it("reaches the toggle right after Close to tray", async () => {
    const user = userEvent.setup();
    render(<WindowSection />);
    const closeToTray = screen.getByRole("switch", { name: "Close to tray" });

    for (let i = 0; i < 10 && document.activeElement !== closeToTray; i++) await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole("switch", { name: "Show resource usage in tray" })
    );
  });
});
