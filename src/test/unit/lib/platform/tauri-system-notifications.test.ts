// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SystemNotificationAdapter } from "@/lib/platform/types";

const plugin = vi.hoisted(() => ({
  isPermissionGranted: vi.fn(),
  requestPermission: vi.fn(),
  sendNotification: vi.fn(),
  cancel: vi.fn(),
  removeActive: vi.fn(),
  onAction: vi.fn(),
  Schedule: {
    at: vi.fn((date: Date, repeating = false, allowWhileIdle = false) => ({
      at: { date, repeating, allowWhileIdle },
    })),
  },
}));

const core = vi.hoisted(() => ({ invoke: vi.fn() }));

const windowApi = vi.hoisted(() => {
  const main = { unminimize: vi.fn(), show: vi.fn(), setFocus: vi.fn() };
  return { main, getCurrentWindow: vi.fn(() => main) };
});

vi.mock("@tauri-apps/plugin-notification", () => plugin);
vi.mock("@tauri-apps/api/core", () => core);
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: windowApi.getCurrentWindow }));

const SCHEDULED_KEY = "maibuk.systemNotifications.scheduled";

interface LoadedAdapter {
  adapter: SystemNotificationAdapter;
  notificationId: (tag: string) => number;
}

async function load(android: boolean): Promise<LoadedAdapter> {
  vi.resetModules();
  vi.doMock("@/lib/platform", () => ({ IS_ANDROID: android }));
  const module = await import("@/lib/platform/tauri/system-notifications");
  return { adapter: module.tauriSystemNotifications, notificationId: module.notificationId };
}

function recorded(): Record<string, number> {
  return JSON.parse(window.localStorage.getItem(SCHEDULED_KEY) ?? "{}") as Record<string, number>;
}

let desktop: LoadedAdapter;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.useRealTimers();
  window.localStorage.clear();
  plugin.cancel.mockResolvedValue(undefined);
  plugin.removeActive.mockResolvedValue(undefined);
  plugin.onAction.mockResolvedValue({ unregister: vi.fn() });
  desktop = await load(false);
});

describe("tauriSystemNotifications (notification plugin)", () => {
  it("reports granted only when the OS already granted it", async () => {
    plugin.isPermissionGranted.mockResolvedValue(true);
    await expect(desktop.adapter.permission()).resolves.toBe("granted");

    plugin.isPermissionGranted.mockResolvedValue(false);
    await expect(desktop.adapter.permission()).resolves.toBe("default");
  });

  it("reports denied once the OS refused, through the plugin's Notification shim", async () => {
    vi.stubGlobal("window", { Notification: { permission: "denied" } });
    try {
      await expect(desktop.adapter.permission()).resolves.toBe("denied");
      expect(plugin.isPermissionGranted).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("gives two tags whose hashes collide different ids, so one never replaces the other", async () => {
    // FNV-1a maps both of these to 991592123; a Plugin could pick such an id on purpose.
    await desktop.adapter.show({ tag: "a/229698", title: "One", body: "First" });
    await desktop.adapter.show({ tag: "a/801416", title: "Two", body: "Second" });
    await desktop.adapter.cancel("a/801416");

    const [first, second] = plugin.sendNotification.mock.calls;
    expect(first[0].id).not.toBe(second[0].id);
    expect(plugin.cancel).toHaveBeenCalledWith([second[0].id]);
  });

  it("passes the OS's request answer through", async () => {
    plugin.requestPermission.mockResolvedValue("granted");

    await expect(desktop.adapter.requestPermission()).resolves.toBe("granted");
    expect(plugin.requestPermission).toHaveBeenCalledTimes(1);
  });

  it("asks for exact alarms on Android once permission is granted", async () => {
    const { adapter } = await load(true);
    plugin.requestPermission.mockResolvedValue("granted");
    core.invoke.mockResolvedValueOnce(false);
    core.invoke.mockResolvedValueOnce(undefined);

    await expect(adapter.requestPermission()).resolves.toBe("granted");

    expect(core.invoke).toHaveBeenNthCalledWith(1, "exact_alarms_allowed");
    expect(core.invoke).toHaveBeenNthCalledWith(2, "request_exact_alarms");
  });

  it("never asks for exact alarms when permission was refused", async () => {
    const { adapter } = await load(true);
    plugin.requestPermission.mockResolvedValue("denied");

    await expect(adapter.requestPermission()).resolves.toBe("denied");
    expect(core.invoke).not.toHaveBeenCalled();
  });

  it("sends a notification under the tag's hashed id", async () => {
    await desktop.adapter.show({ tag: "clock.alarm", title: "Alarm", body: "Wake up" });

    const id = desktop.notificationId("clock.alarm");
    expect(id).toBeGreaterThan(0);
    expect(id).toBeLessThanOrEqual(0x7fffffff);
    expect(plugin.sendNotification).toHaveBeenCalledWith({
      id,
      title: "Alarm",
      body: "Wake up",
      extra: { tag: "clock.alarm" },
    });
  });

  it("hashes a tag to the same id every time, so a second show replaces the first", async () => {
    await desktop.adapter.show({ tag: "clock", title: "One", body: "First" });
    await desktop.adapter.show({ tag: "clock", title: "Two", body: "Second" });

    const [first, second] = plugin.sendNotification.mock.calls;
    expect(first[0].id).toBe(second[0].id);
    expect(first[0].id).toBe(desktop.notificationId("clock"));
  });

  it("withdraws both the pending and the shown notification for the tag", async () => {
    await desktop.adapter.cancel("clock.alarm");

    const id = desktop.notificationId("clock.alarm");
    expect(plugin.cancel).toHaveBeenCalledWith([id]);
    expect(plugin.removeActive).toHaveBeenCalledWith([{ id }]);
  });

  it("swallows a platform that cannot cancel or remove", async () => {
    plugin.cancel.mockRejectedValue(new Error("unsupported"));
    plugin.removeActive.mockRejectedValue(new Error("unsupported"));

    await expect(desktop.adapter.cancel("clock")).resolves.toBeUndefined();
  });

  it("shows a desktop scheduled one at its deadline, since no OS holds it", async () => {
    vi.useFakeTimers();
    const at = Date.now() + 5000;

    await desktop.adapter.schedule({ tag: "clock/alarm", title: "Alarm", body: "Wake", at });
    await vi.advanceTimersByTimeAsync(4999);
    expect(plugin.sendNotification).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(plugin.sendNotification).toHaveBeenCalledWith({
      id: desktop.notificationId("clock/alarm"),
      title: "Alarm",
      body: "Wake",
      extra: { tag: "clock/alarm" },
    });
    expect(recorded()).toEqual({});
  });

  it("hands an Android deadline to the OS and records it", async () => {
    const android = await load(true);
    const at = Date.now() + 60_000;

    await android.adapter.schedule({ tag: "clock/alarm", title: "Alarm", body: "Wake", at });

    expect(plugin.Schedule.at).toHaveBeenCalledWith(new Date(at), false, true);
    expect(plugin.sendNotification).toHaveBeenCalledWith({
      id: android.notificationId("clock/alarm"),
      title: "Alarm",
      body: "Wake",
      extra: { tag: "clock/alarm" },
      schedule: { at: { date: new Date(at), repeating: false, allowWhileIdle: true } },
    });
    expect(recorded()).toEqual({ "clock/alarm": at });
  });

  it("drops an Android record whose deadline already passed", async () => {
    const android = await load(true);
    window.localStorage.setItem(
      SCHEDULED_KEY,
      JSON.stringify({ "clock/stale": Date.now() - 1000 })
    );

    await android.adapter.cancelAll("clock/");

    expect(plugin.cancel).not.toHaveBeenCalled();
  });

  it("cancels a recorded Android id after a restart, when no tag is held in memory", async () => {
    const first = await load(true);
    const at = Date.now() + 60_000;
    await first.adapter.schedule({ tag: "clock/alarm", title: "Alarm", body: "Wake", at });

    // A fresh module has an empty tag table, as a relaunch does.
    const restarted = await load(true);
    plugin.cancel.mockClear();
    await restarted.adapter.cancelAll("clock/");

    expect(plugin.cancel).toHaveBeenCalledWith([restarted.notificationId("clock/alarm")]);
    expect(recorded()).toEqual({});
  });

  it("reports exact timing only where Android can be asked", async () => {
    const android = await load(true);
    core.invoke.mockResolvedValue(true);
    await expect(android.adapter.exactTiming()).resolves.toBe(true);
    expect(core.invoke).toHaveBeenCalledWith("exact_alarms_allowed");

    core.invoke.mockReset();
    core.invoke.mockRejectedValue(new Error("unsupported"));
    await expect(android.adapter.exactTiming()).resolves.toBe(false);

    core.invoke.mockReset();
    await expect(desktop.adapter.exactTiming()).resolves.toBe(true);
    expect(core.invoke).not.toHaveBeenCalled();
  });

  it("calls a click handler with the tag the OS reports in the event's data", async () => {
    const handler = vi.fn();
    desktop.adapter.onClick(handler);
    expect(plugin.onAction).toHaveBeenCalledTimes(1);
    const listener = plugin.onAction.mock.calls[0][0] as (event: unknown) => void;

    listener({
      actionId: "tap",
      inputValue: null,
      notification: { id: 1, data: { tag: "clock/alarm" } },
    });

    await vi.waitFor(() => expect(handler).toHaveBeenCalledWith("clock/alarm"));
  });

  it("resolves a click's tag through the id it was shown under", async () => {
    const handler = vi.fn();
    await desktop.adapter.show({ tag: "clock/alarm", title: "Alarm", body: "Wake" });
    desktop.adapter.onClick(handler);
    const listener = plugin.onAction.mock.calls[0][0] as (event: unknown) => void;

    listener({
      actionId: "tap",
      inputValue: null,
      notification: { id: desktop.notificationId("clock/alarm"), data: {} },
    });

    await vi.waitFor(() => expect(handler).toHaveBeenCalledWith("clock/alarm"));
  });

  it("brings the window forward before calling a desktop handler", async () => {
    const handler = vi.fn();
    await desktop.adapter.show({ tag: "clock/alarm", title: "Alarm", body: "Wake" });
    desktop.adapter.onClick(handler);
    const listener = plugin.onAction.mock.calls[0][0] as (event: unknown) => void;

    listener({
      actionId: "tap",
      inputValue: null,
      notification: { id: desktop.notificationId("clock/alarm"), data: {} },
    });

    await vi.waitFor(() => expect(handler).toHaveBeenCalledWith("clock/alarm"));
    expect(windowApi.getCurrentWindow).toHaveBeenCalled();
    expect(windowApi.main.unminimize).toHaveBeenCalledTimes(1);
    expect(windowApi.main.show).toHaveBeenCalledTimes(1);
    expect(windowApi.main.setFocus).toHaveBeenCalledTimes(1);
  });

  it("reads a desktop click's tag from the extra it was sent with", async () => {
    const handler = vi.fn();
    desktop.adapter.onClick(handler);
    const listener = plugin.onAction.mock.calls[0][0] as (event: unknown) => void;

    listener({
      actionId: "tap",
      inputValue: null,
      notification: { id: 9, extra: { tag: "clock/x" } },
    });

    await vi.waitFor(() => expect(handler).toHaveBeenCalledWith("clock/x"));
  });

  describe("Android taps, which the plugin reports without the notification", () => {
    /** MainActivity's bridge: hands over the tapped id once. */
    function installBridge(ids: number[]): void {
      Object.defineProperty(window, "MaibukNotificationTaps", {
        value: { take: () => ids.shift() ?? -1 },
        configurable: true,
      });
    }

    it("takes a cold-start tap and resolves it through the id a previous run stored", async () => {
      const previousRun = await load(true);
      await previousRun.adapter.schedule({
        tag: "clock/alarm",
        title: "A",
        body: "",
        at: Date.now() + 60_000,
      });
      const id = previousRun.notificationId("clock/alarm");

      const android = await load(true);
      installBridge([id]);
      const handler = vi.fn();
      const unsubscribe = android.adapter.onClick(handler);

      await vi.waitFor(() => expect(handler).toHaveBeenCalledWith("clock/alarm"));
      expect(plugin.onAction).not.toHaveBeenCalled();
      unsubscribe();
    });

    it("takes a warm tap when MainActivity signals one", async () => {
      const android = await load(true);
      await android.adapter.show({ tag: "clock/timer", title: "T", body: "" });
      const ids: number[] = [];
      installBridge(ids);
      const handler = vi.fn();
      android.adapter.onClick(handler);
      await Promise.resolve();
      expect(handler).not.toHaveBeenCalled();

      ids.push(android.notificationId("clock/timer"));
      window.dispatchEvent(new Event("maibuk:notification-tap"));

      await vi.waitFor(() => expect(handler).toHaveBeenCalledWith("clock/timer"));
      expect(windowApi.main.setFocus).not.toHaveBeenCalled();
    });
  });

  it("survives a click listener the platform refuses, and tries again on the next subscribe", async () => {
    let rejected = 0;
    plugin.onAction.mockImplementationOnce(() => {
      rejected += 1;
      return Promise.reject(new TypeError("no Tauri runtime"));
    });

    desktop.adapter.onClick(vi.fn());
    await vi.waitFor(() => expect(rejected).toBe(1));
    desktop.adapter.onClick(vi.fn());

    await vi.waitFor(() => expect(plugin.onAction).toHaveBeenCalledTimes(2));
  });

  it("registers the click listener once for every handler", async () => {
    desktop.adapter.onClick(vi.fn())();
    desktop.adapter.onClick(vi.fn());

    expect(plugin.onAction).toHaveBeenCalledTimes(1);
  });

  it("ignores an event that is not a tap, or names no tag", async () => {
    const handler = vi.fn();
    desktop.adapter.onClick(handler);
    const listener = plugin.onAction.mock.calls[0][0] as (event: unknown) => void;

    listener({ actionId: "reply", inputValue: "hi", notification: { id: 7, data: {} } });
    listener({ actionId: "tap", inputValue: null, notification: null });

    await Promise.resolve();
    expect(handler).not.toHaveBeenCalled();
  });

  it("claims to schedule while closed only on Android", async () => {
    expect(desktop.adapter.canScheduleWhileClosed()).toBe(false);

    const android = await load(true);
    expect(android.adapter.canScheduleWhileClosed()).toBe(true);
  });
});
