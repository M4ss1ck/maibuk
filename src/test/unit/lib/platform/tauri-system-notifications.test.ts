import { beforeEach, describe, expect, it, vi } from "vitest";

const plugin = vi.hoisted(() => ({
  isPermissionGranted: vi.fn(),
  requestPermission: vi.fn(),
  sendNotification: vi.fn(),
  cancel: vi.fn(),
  removeActive: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-notification", () => plugin);

const { tauriSystemNotifications, notificationId } = await import(
  "@/lib/platform/tauri/system-notifications"
);

beforeEach(() => {
  vi.clearAllMocks();
  plugin.cancel.mockResolvedValue(undefined);
  plugin.removeActive.mockResolvedValue(undefined);
});

describe("tauriSystemNotifications (notification plugin)", () => {
  it("reports granted only when the OS already granted it", async () => {
    plugin.isPermissionGranted.mockResolvedValue(true);
    await expect(tauriSystemNotifications.permission()).resolves.toBe("granted");

    plugin.isPermissionGranted.mockResolvedValue(false);
    await expect(tauriSystemNotifications.permission()).resolves.toBe("default");
  });

  it("passes the OS's request answer through", async () => {
    plugin.requestPermission.mockResolvedValue("granted");

    await expect(tauriSystemNotifications.requestPermission()).resolves.toBe("granted");
    expect(plugin.requestPermission).toHaveBeenCalledTimes(1);
  });

  it("sends a notification under the tag's hashed id", async () => {
    await tauriSystemNotifications.show({ tag: "clock.alarm", title: "Alarm", body: "Wake up" });

    const id = notificationId("clock.alarm");
    expect(id).toBeGreaterThan(0);
    expect(id).toBeLessThanOrEqual(0x7fffffff);
    expect(plugin.sendNotification).toHaveBeenCalledWith({ id, title: "Alarm", body: "Wake up" });
  });

  it("hashes a tag to the same id every time, so a second show replaces the first", async () => {
    await tauriSystemNotifications.show({ tag: "clock", title: "One", body: "First" });
    await tauriSystemNotifications.show({ tag: "clock", title: "Two", body: "Second" });

    const [first, second] = plugin.sendNotification.mock.calls;
    expect(first[0].id).toBe(second[0].id);
    expect(first[0].id).toBe(notificationId("clock"));
  });

  it("withdraws both the pending and the shown notification for the tag", async () => {
    await tauriSystemNotifications.cancel("clock.alarm");

    const id = notificationId("clock.alarm");
    expect(plugin.cancel).toHaveBeenCalledWith([id]);
    expect(plugin.removeActive).toHaveBeenCalledWith([{ id }]);
  });

  it("swallows a platform that cannot cancel or remove", async () => {
    plugin.cancel.mockRejectedValue(new Error("unsupported"));
    plugin.removeActive.mockRejectedValue(new Error("unsupported"));

    await expect(tauriSystemNotifications.cancel("clock")).resolves.toBeUndefined();
  });

  it("never claims to schedule while closed", () => {
    expect(tauriSystemNotifications.canScheduleWhileClosed()).toBe(false);
  });
});
