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
  onclick: (() => void) | null = null;
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
  vi.useRealTimers();
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

  it("shows a scheduled one at its deadline, through a host timer", async () => {
    vi.useFakeTimers();
    const at = Date.now() + 5000;

    await notifications.schedule({ tag: "alarm", title: "Timer", body: "Done", at });
    await vi.advanceTimersByTimeAsync(4999);
    expect(FakeNotification.built).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(FakeNotification.built).toHaveLength(1);
    expect(FakeNotification.built[0].title).toBe("Timer");
    expect(FakeNotification.built[0].options).toEqual({ body: "Done", tag: "alarm" });
  });

  it("never shows a scheduled one cancelled before its deadline", async () => {
    vi.useFakeTimers();

    await notifications.schedule({
      tag: "alarm",
      title: "Timer",
      body: "Done",
      at: Date.now() + 5000,
    });
    await notifications.cancel("alarm");

    await vi.advanceTimersByTimeAsync(10_000);
    expect(FakeNotification.built).toHaveLength(0);
  });

  it("cancels every scheduled one under a prefix", async () => {
    vi.useFakeTimers();
    const at = Date.now() + 5000;

    await notifications.schedule({ tag: "clock/one", title: "One", body: "1", at });
    await notifications.schedule({ tag: "clock/two", title: "Two", body: "2", at });
    await notifications.schedule({ tag: "timer/one", title: "Three", body: "3", at });
    await notifications.cancelAll("clock/");

    await vi.advanceTimersByTimeAsync(5000);
    expect(FakeNotification.built).toHaveLength(1);
    expect(FakeNotification.built[0].options).toEqual({ body: "3", tag: "timer/one" });
  });

  it("closes every showing one under a prefix", async () => {
    await notifications.show({ tag: "clock/one", title: "One", body: "1" });
    await notifications.show({ tag: "timer/one", title: "Two", body: "2" });

    await notifications.cancelAll("clock/");

    expect(FakeNotification.built[0].close).toHaveBeenCalledTimes(1);
    expect(FakeNotification.built[1].close).not.toHaveBeenCalled();
  });

  it("focuses the window and calls the handler with the tag on click", async () => {
    const focus = vi.fn();
    vi.stubGlobal("window", { focus });
    const handler = vi.fn();
    notifications.onClick(handler);

    try {
      await notifications.show({ tag: "alarm", title: "Timer", body: "Done" });
      FakeNotification.built[0].onclick?.();
    } finally {
      vi.unstubAllGlobals();
    }

    expect(focus).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith("alarm");
  });

  it("stops calling a handler once its unsubscribe runs", async () => {
    const focus = vi.fn();
    vi.stubGlobal("window", { focus });
    const handler = vi.fn();
    const unsubscribe = notifications.onClick(handler);
    unsubscribe();

    try {
      await notifications.show({ tag: "alarm", title: "Timer", body: "Done" });
      FakeNotification.built[0].onclick?.();
    } finally {
      vi.unstubAllGlobals();
    }

    expect(handler).not.toHaveBeenCalled();
  });

  it("fires a scheduled one on time, since the page holds the timer", async () => {
    await expect(notifications.exactTiming()).resolves.toBe(true);
  });
});
