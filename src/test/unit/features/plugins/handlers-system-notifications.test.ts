import { describe, expect, it, vi } from "vitest";
import { createMemorySystemNotificationAdapter } from "@/features/plugins/system-notifications";

const device = createMemorySystemNotificationAdapter();
const openPluginPage = vi.fn(async () => ({ status: "opened" as const }));

vi.mock("@/lib/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/platform")>()),
  getSystemNotifications: async () => device,
}));
vi.mock("@/features/plugins/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/plugins/navigation")>()),
  openPluginPage,
}));
vi.mock("@/features/plugins/contributions-registry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/plugins/contributions-registry")>()),
  getPluginPages: () => [
    { pluginId: "clock", localId: "timer" },
    { pluginId: "clock", localId: "alarms" },
  ],
}));

const { cancelPluginSystemNotifications, createPluginHandlers } = await import(
  "@/features/plugins/handlers"
);

describe("System Notifications in the app's Plugin handlers (#870)", () => {
  it("opens the sending Plugin's first page when the author clicks one", async () => {
    createPluginHandlers({ id: "clock", name: "Clock", contributes: {} });
    await vi.waitFor(() => {
      device.click("clock/pomodoro");
      expect(openPluginPage).toHaveBeenCalledWith("clock", "timer");
    });

    openPluginPage.mockClear();
    device.click("no-pages/x");
    expect(openPluginPage).not.toHaveBeenCalled();
  });

  it("withdraws every pending and shown one of the Plugin, and only that Plugin's", async () => {
    const handlers = createPluginHandlers({ id: "clock", name: "Clock", contributes: {} });
    const system = handlers["notifications.system"];
    if (!system) throw new Error("notifications.system is not handled");
    const context = { pluginId: "clock" } as Parameters<typeof system>[1];
    await system({ id: "a", title: "A", body: "", at: Date.now() + 60_000 }, context);
    await device.schedule({ tag: "other/b", title: "B", body: "", at: Date.now() + 60_000 });

    await cancelPluginSystemNotifications("clock");

    expect([...device.scheduled.keys()]).toEqual(["other/b"]);
  });
});
