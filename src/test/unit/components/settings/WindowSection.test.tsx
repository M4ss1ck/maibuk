/**
 * Settings → Window on desktop: Resource Usage in the tray (#668) is off by
 * default and turned on and off with the keyboard alone.
 */
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/i18n";

type Summary = { cpu: string; ram: string; storage: string };

const { usage } = vi.hoisted(() => ({
  usage: {
    current: null as Summary | null,
    listener: null as ((summary: Summary) => void) | null,
    unlisten: vi.fn(),
  },
}));

vi.mock("@/lib/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/platform")>()),
  IS_DESKTOP: true,
  isMac: () => false,
  getResourceUsageSummary: async () => usage.current,
  onResourceUsageSummary: async (listener: (summary: Summary) => void) => {
    usage.listener = listener;
    return usage.unlisten;
  },
}));

const { WindowSection } = await import("@/components/settings/WindowSection");
const { useSettingsStore } = await import("@/features/settings/store");

beforeEach(() => {
  useSettingsStore.setState({ trayResourceUsage: false, closeToTray: false });
  usage.current = null;
  usage.listener = null;
  usage.unlisten.mockClear();
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

  it("shows CPU, RAM, and the storage total under the switch while it is on", async () => {
    usage.current = { cpu: "CPU 3%", ram: "RAM 412 MB (2.6%)", storage: "Storage 1.4 GB" };
    useSettingsStore.setState({ trayResourceUsage: true });
    render(<WindowSection />);

    expect(await screen.findByText("CPU 3% · RAM 412 MB (2.6%) · Storage 1.4 GB")).toBeVisible();

    await vi.waitFor(() => expect(usage.listener).not.toBeNull());
    act(() => usage.listener?.({ cpu: "CPU 5%", ram: "RAM 420 MB (2.7%)", storage: "Storage —" }));
    expect(screen.getByText("CPU 5% · RAM 420 MB (2.7%) · Storage —")).toBeVisible();
  });

  it("has no usage line while the switch is off, and stops listening when turned off", async () => {
    const user = userEvent.setup();
    usage.current = { cpu: "CPU 3%", ram: "RAM 412 MB (2.6%)", storage: "Storage 1.4 GB" };
    useSettingsStore.setState({ trayResourceUsage: true });
    render(<WindowSection />);
    await screen.findByText(/^CPU 3%/);
    await vi.waitFor(() => expect(usage.listener).not.toBeNull());

    const toggle = screen.getByRole("switch", { name: "Show resource usage in tray" });
    for (let i = 0; i < 10 && document.activeElement !== toggle; i++) await user.tab();
    await user.keyboard(" ");

    expect(screen.queryByText(/^CPU /)).not.toBeInTheDocument();
    expect(usage.unlisten).toHaveBeenCalled();
  });
});
