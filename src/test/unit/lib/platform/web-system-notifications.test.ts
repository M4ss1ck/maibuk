import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SystemNotificationAdapter } from "@/lib/platform/types";

/** The fake the tests install as `Notification`, mirroring the browser's shape. */
class FakeNotification {
  static permission: NotificationPermission = "default";
  static requestPermission = vi.fn(async (): Promise<NotificationPermission> => {
    return FakeNotification.permission;
  });
  static built: FakeNotification[] = [];

  close = vi.fn();
  readonly title: string;
  readonly options: NotificationOptions;

  constructor(title: string, options?: NotificationOptions) {
    this.title = title;
    this.options = options ?? {};
    FakeNotification.built.push(this);
  }
}

let notifications: SystemNotificationAdapter;

async function loadAdapter(): Promise<SystemNotificationAdapter> {
  vi.resetModules();
  const { webSystemNotifications } = await import("@/lib/platform/web/system-notifications");
  return webSystemNotifications;
}

function stubNotification(implementation: unknown = FakeNotification): void {
  Object.defineProperty(globalThis, "Notification", {
    value: implementation,
    configurable: true,
    writable: true,
  });
}

beforeEach(async () => {
  FakeNotification.permission = "default";
  FakeNotification.requestPermission.mockClear();
  FakeNotification.built = [];
  stubNotification();
  notifications = await loadAdapter();
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "Notification");
});

describe("webSystemNotifications (Web Notifications API)", () => {
  it("reports the OS's permission answer", async () => {
    await expect(notifications.permission()).resolves.toBe("default");
    FakeNotification.permission = "granted";
    await expect(notifications.permission()).resolves.toBe("granted");
    FakeNotification.permission = "denied";
    await expect(notifications.permission()).resolves.toBe("denied");
  });

  it("asks the OS for permission", async () => {
    FakeNotification.permission = "granted";

    await expect(notifications.requestPermission()).resolves.toBe("granted");
    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1);
  });

  it("reports denied and cannot show one where the browser has no Notification", async () => {
    Reflect.deleteProperty(globalThis, "Notification");
    notifications = await loadAdapter();

    await expect(notifications.permission()).resolves.toBe("denied");
    await expect(notifications.requestPermission()).resolves.toBe("denied");
    await expect(notifications.show({ tag: "a", title: "T", body: "B" })).rejects.toThrow(
      "no System Notifications"
    );
  });

  it("shows a notification with its tag", async () => {
    await notifications.show({ tag: "alarm", title: "Timer", body: "Done" });

    expect(FakeNotification.built).toHaveLength(1);
    expect(FakeNotification.built[0].title).toBe("Timer");
    expect(FakeNotification.built[0].options).toEqual({ body: "Done", tag: "alarm" });
  });

  it("closes the earlier one when the same tag is shown again", async () => {
    await notifications.show({ tag: "alarm", title: "First", body: "One" });
    const first = FakeNotification.built[0];
    await notifications.show({ tag: "alarm", title: "Second", body: "Two" });

    expect(first.close).toHaveBeenCalledTimes(1);
    expect(FakeNotification.built[1].close).not.toHaveBeenCalled();
  });

  it("lets a refused construction reject, as a mobile browser does", async () => {
    stubNotification(
      class {
        constructor() {
          throw new TypeError("Illegal constructor");
        }
      }
    );

    await expect(notifications.show({ tag: "a", title: "T", body: "B" })).rejects.toThrow(
      "Illegal constructor"
    );
  });

  it("closes the notification a cancel names", async () => {
    await notifications.show({ tag: "alarm", title: "Timer", body: "Done" });

    await expect(notifications.cancel("alarm")).resolves.toBeUndefined();
    expect(FakeNotification.built[0].close).toHaveBeenCalledTimes(1);
  });

  it("resolves a cancel for a tag it never showed", async () => {
    await expect(notifications.cancel("unknown")).resolves.toBeUndefined();
  });

  it("never claims to schedule while closed", () => {
    expect(notifications.canScheduleWhileClosed()).toBe(false);
  });
});
