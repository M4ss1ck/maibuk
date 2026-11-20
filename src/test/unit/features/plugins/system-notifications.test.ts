import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMemorySystemNotificationAdapter,
  createPluginSystemNotifications,
  systemNotificationTag,
} from "@/features/plugins/system-notifications";
import type { SystemNotificationAdapter } from "@/lib/platform/types";

const clockPlugin = { id: "clock", name: "Clock" };

/** A clock the service reads and waits out, so a one-second gap costs no real time. */
function createClock() {
  const waits: number[] = [];
  let time = 0;
  return {
    waits,
    now: (): number => time,
    wait: async (ms: number): Promise<void> => {
      waits.push(ms);
      time += ms;
    },
    at: (): number => time,
  };
}

function build(adapter: SystemNotificationAdapter, clock = createClock()) {
  const fallback = vi.fn<(text: string) => void>();
  const service = createPluginSystemNotifications({
    adapter,
    fallback,
    now: clock.now,
    wait: clock.wait,
  });
  return { service, fallback, clock };
}

describe("systemNotificationTag()", () => {
  it("scopes the id to the Plugin that sent it", () => {
    expect(systemNotificationTag("clock", "pomodoro")).toBe("clock/pomodoro");
  });
});

describe("send()", () => {
  it("shows a granted notification under a name-prefixed title", async () => {
    const adapter = createMemorySystemNotificationAdapter();
    const { service, fallback } = build(adapter);

    await expect(
      service.send(clockPlugin, { id: "pomodoro", title: "Timer done", body: "Take a break" })
    ).resolves.toBeNull();

    expect(adapter.log).toEqual([
      {
        kind: "sent",
        tag: "clock/pomodoro",
        title: "Clock: Timer done",
        body: "Take a break",
      },
    ]);
    expect(adapter.active.get("clock/pomodoro")).toEqual({
      title: "Clock: Timer done",
      body: "Take a break",
    });
    expect(fallback).not.toHaveBeenCalled();
  });

  it("replaces the notification with the same id", async () => {
    const adapter = createMemorySystemNotificationAdapter();
    const { service } = build(adapter);

    await service.send(clockPlugin, { id: "pomodoro", title: "Timer done", body: "First" });
    await service.send(clockPlugin, { id: "pomodoro", title: "Break over", body: "Second" });

    expect(adapter.log.map((entry) => entry.kind)).toEqual(["sent", "replaced"]);
    expect([...adapter.active.keys()]).toEqual(["clock/pomodoro"]);
    expect(adapter.active.get("clock/pomodoro")).toEqual({
      title: "Clock: Break over",
      body: "Second",
    });
  });

  it("keeps each Plugin's namespace apart, so a cancel withdraws only that Plugin's", async () => {
    const adapter = createMemorySystemNotificationAdapter();
    const { service } = build(adapter);

    await service.send(
      { id: "alarms", name: "Alarms" },
      { id: "next", title: "Wake", body: "7:00" }
    );
    await service.send(
      { id: "timers", name: "Timers" },
      { id: "next", title: "Wake", body: "8:00" }
    );

    expect([...adapter.active.keys()]).toEqual(["alarms/next", "timers/next"]);

    await service.cancel("timers", "next");

    expect([...adapter.active.keys()]).toEqual(["alarms/next"]);
    expect(adapter.active.get("alarms/next")?.body).toBe("7:00");
  });

  it("delivers three quick sends in order, each at least a second after the last", async () => {
    const clock = createClock();
    const adapter = createMemorySystemNotificationAdapter();
    const shownAt: number[] = [];
    const { service, fallback } = build(
      {
        ...adapter,
        show: async (notification) => {
          shownAt.push(clock.now());
          await adapter.show(notification);
        },
      },
      clock
    );

    const sends = [
      service.send(clockPlugin, { id: "one", title: "One", body: "1" }),
      service.send(clockPlugin, { id: "two", title: "Two", body: "2" }),
      service.send(clockPlugin, { id: "three", title: "Three", body: "3" }),
    ];
    await expect(Promise.all(sends)).resolves.toEqual([null, null, null]);

    expect(adapter.log.map((entry) => entry.tag)).toEqual([
      "clock/one",
      "clock/two",
      "clock/three",
    ]);
    expect(shownAt).toEqual([0, 1000, 2000]);
    for (let index = 1; index < shownAt.length; index += 1) {
      expect(shownAt[index] - shownAt[index - 1]).toBeGreaterThanOrEqual(1000);
    }
    expect(fallback).not.toHaveBeenCalled();
  });

  it("does not make one Plugin wait on another's budget", async () => {
    const clock = createClock();
    const adapter = createMemorySystemNotificationAdapter();
    const shownAt: number[] = [];
    const { service } = build(
      {
        ...adapter,
        show: async (notification) => {
          shownAt.push(clock.now());
          await adapter.show(notification);
        },
      },
      clock
    );

    await Promise.all([
      service.send({ id: "alarms", name: "Alarms" }, { id: "a", title: "A", body: "A" }),
      service.send({ id: "timers", name: "Timers" }, { id: "a", title: "A", body: "A" }),
    ]);

    expect(clock.waits).toEqual([]);
    expect(shownAt).toEqual([0, 0]);
    expect(adapter.log).toHaveLength(2);
  });

  it("falls back to the toast when permission is denied, and shows nothing", async () => {
    const adapter = createMemorySystemNotificationAdapter();
    adapter.setPermission("denied");
    const { service, fallback } = build(adapter);

    await expect(
      service.send(clockPlugin, { id: "pomodoro", title: "Timer done", body: "Take a break" })
    ).resolves.toBeNull();

    expect(adapter.log).toEqual([]);
    expect(adapter.active.size).toBe(0);
    expect(fallback).toHaveBeenCalledExactlyOnceWith("Clock: Timer done. Take a break");
  });

  it("also falls back while the OS has not been asked yet", async () => {
    const adapter = createMemorySystemNotificationAdapter();
    adapter.setPermission("default");
    const { service, fallback } = build(adapter);

    await service.send(clockPlugin, { id: "pomodoro", title: "Timer done", body: "Take a break" });

    expect(adapter.log).toEqual([]);
    expect(fallback).toHaveBeenCalledExactlyOnceWith("Clock: Timer done. Take a break");
  });

  it("falls back when the device refuses at show time, without rejecting", async () => {
    const adapter = createMemorySystemNotificationAdapter();
    const { service, fallback } = build({
      ...adapter,
      show: async () => {
        throw new Error("the device refused");
      },
    });

    await expect(
      service.send(clockPlugin, { id: "pomodoro", title: "Timer done", body: "Take a break" })
    ).resolves.toBeNull();

    expect(adapter.active.size).toBe(0);
    expect(fallback).toHaveBeenCalledExactlyOnceWith("Clock: Timer done. Take a break");
  });
});

describe("cancel()", () => {
  it("resolves null for an id that is not showing, and logs nothing", async () => {
    const adapter = createMemorySystemNotificationAdapter();
    const { service } = build(adapter);

    await expect(service.cancel("clock", "never-sent")).resolves.toBeNull();

    expect(adapter.log).toEqual([]);
  });

  it("runs after a queued send, so the send delivers and is then withdrawn", async () => {
    const adapter = createMemorySystemNotificationAdapter();
    const { service } = build(adapter);

    const first = service.send(clockPlugin, { id: "open", title: "One", body: "1" });
    const second = service.send(clockPlugin, { id: "queued", title: "Two", body: "2" });
    const cancelled = service.cancel("clock", "queued");

    await expect(Promise.all([first, second, cancelled])).resolves.toEqual([null, null, null]);

    expect(adapter.log.map((entry) => entry.kind)).toEqual(["sent", "sent", "cancelled"]);
    expect([...adapter.active.keys()]).toEqual(["clock/open"]);
  });
});

describe("status() and requestPermission()", () => {
  it("reports the OS's permission, closed scheduling, and exact timing", async () => {
    const adapter = createMemorySystemNotificationAdapter();
    const { service } = build(adapter);

    await expect(service.status()).resolves.toEqual({
      permission: "granted",
      canScheduleWhileClosed: false,
      exactTiming: true,
    });

    adapter.setPermission("denied");
    adapter.setCanScheduleWhileClosed(true);
    adapter.setExactTiming(false);

    await expect(service.status()).resolves.toEqual({
      permission: "denied",
      canScheduleWhileClosed: true,
      exactTiming: false,
    });
  });

  it("asks the OS and remembers the answer", async () => {
    const adapter = createMemorySystemNotificationAdapter();
    const { service } = build(adapter);

    adapter.requestAnswer = "denied";

    await expect(service.requestPermission()).resolves.toEqual({ permission: "denied" });
    await expect(adapter.permission()).resolves.toBe("denied");
  });
});

describe("scheduled send()", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Builds the service on the real clock, which the fake timers drive. */
  function buildLive(adapter: SystemNotificationAdapter) {
    const fallback = vi.fn<(text: string) => void>();
    const service = createPluginSystemNotifications({ adapter, fallback });
    return { service, fallback };
  }

  it("hands a future one to the device with the prefixed title, and it fires at its deadline", async () => {
    const adapter = createMemorySystemNotificationAdapter();
    const { service, fallback } = buildLive(adapter);

    await expect(
      service.send(clockPlugin, { id: "alarm", title: "Wake up", body: "7:00", at: 5_000 })
    ).resolves.toBeNull();

    expect(adapter.scheduled.get("clock/alarm")).toEqual({
      title: "Clock: Wake up",
      body: "7:00",
      at: 5_000,
    });
    expect(adapter.active.size).toBe(0);

    await vi.advanceTimersByTimeAsync(3_999);
    expect(adapter.active.size).toBe(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(adapter.active.get("clock/alarm")).toEqual({ title: "Clock: Wake up", body: "7:00" });
    expect(fallback).not.toHaveBeenCalled();
  });

  it("caps a Plugin at 20 pending, lets the same id replace, and frees a slot at the deadline", async () => {
    const adapter = createMemorySystemNotificationAdapter();
    const { service } = buildLive(adapter);

    for (let index = 0; index < 20; index += 1) {
      await expect(
        service.send(clockPlugin, { id: `n${index}`, title: `N${index}`, body: "b", at: 5_000 })
      ).resolves.toBeNull();
    }

    await expect(
      service.send(clockPlugin, { id: "n20", title: "N20", body: "b", at: 5_000 })
    ).resolves.toEqual({
      error: "limit",
      message: "At most 20 scheduled System Notifications can be pending for one Plugin.",
    });
    expect(adapter.scheduled.size).toBe(20);

    await expect(
      service.send(clockPlugin, { id: "n0", title: "N0 again", body: "b", at: 5_000 })
    ).resolves.toBeNull();
    expect(adapter.scheduled.size).toBe(20);

    await vi.advanceTimersByTimeAsync(4_000);

    await expect(
      service.send(clockPlugin, { id: "n20", title: "N20", body: "b", at: 9_000 })
    ).resolves.toBeNull();
    expect([...adapter.scheduled.keys()]).toEqual(["clock/n20"]);
  });

  it("keeps the deadline itself when permission is denied, and toasts at it", async () => {
    const adapter = createMemorySystemNotificationAdapter();
    adapter.setPermission("denied");
    const { service, fallback } = buildLive(adapter);

    await service.send(clockPlugin, { id: "nap", title: "Nap over", body: "Stand up", at: 5_000 });

    expect(adapter.log).toEqual([]);
    expect(fallback).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(3_999);
    expect(fallback).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(fallback).toHaveBeenCalledExactlyOnceWith("Clock: Nap over. Stand up");
  });

  it("withdraws a pending scheduled one when the same id is sent now", async () => {
    const adapter = createMemorySystemNotificationAdapter();
    const { service } = buildLive(adapter);

    await service.send(clockPlugin, { id: "alarm", title: "Wake", body: "7:00", at: 5_000 });
    await service.send(clockPlugin, { id: "alarm", title: "Now", body: "Wake now" });

    expect(adapter.log.map((entry) => entry.kind)).toEqual(["scheduled", "cancelled", "sent"]);
    expect(adapter.scheduled.has("clock/alarm")).toBe(false);
    expect(adapter.active.get("clock/alarm")).toEqual({ title: "Clock: Now", body: "Wake now" });

    await vi.advanceTimersByTimeAsync(5_000);
    expect(adapter.log).toHaveLength(3);
  });
});

describe("cancelPlugin()", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("cancel() withdraws a pending one and frees its slot", async () => {
    const adapter = createMemorySystemNotificationAdapter();
    const fallback = vi.fn<(text: string) => void>();
    const service = createPluginSystemNotifications({ adapter, fallback });

    for (let index = 0; index < 20; index += 1) {
      await service.send(clockPlugin, {
        id: `n${index}`,
        title: `N${index}`,
        body: "b",
        at: 5_000,
      });
    }

    await service.cancel("clock", "n0");

    expect(adapter.scheduled.has("clock/n0")).toBe(false);
    expect(adapter.log.at(-1)).toEqual({ kind: "cancelled", tag: "clock/n0" });

    await expect(
      service.send(clockPlugin, { id: "n20", title: "N20", body: "b", at: 5_000 })
    ).resolves.toBeNull();
  });

  it("withdraws every pending and shown one of that Plugin, and leaves another Plugin's", async () => {
    const adapter = createMemorySystemNotificationAdapter();
    const fallback = vi.fn<(text: string) => void>();
    const service = createPluginSystemNotifications({ adapter, fallback });
    const alarmsPlugin = { id: "alarms", name: "Alarms" };

    await service.send(clockPlugin, { id: "alarm", title: "Wake", body: "7:00", at: 5_000 });
    await service.send(clockPlugin, { id: "shown", title: "Now", body: "here" });
    await service.send(alarmsPlugin, { id: "alarm", title: "Wake", body: "8:00", at: 5_000 });
    await service.send(alarmsPlugin, { id: "shown", title: "Now", body: "there" });

    await expect(service.cancelPlugin("clock")).resolves.toBeNull();

    expect([...adapter.scheduled.keys()]).toEqual(["alarms/alarm"]);
    expect([...adapter.active.keys()]).toEqual(["alarms/shown"]);
    expect(adapter.active.get("alarms/shown")?.body).toBe("there");

    await vi.advanceTimersByTimeAsync(5_000);
    expect([...adapter.active.keys()]).toEqual(["alarms/shown", "alarms/alarm"]);
  });
});

describe("onClick()", () => {
  it("maps a clicked tag to the Plugin id before the first slash", () => {
    const adapter = createMemorySystemNotificationAdapter();
    const { service } = build(adapter);
    const handler = vi.fn<(pluginId: string) => void>();

    const unsubscribe = service.onClick(handler);

    adapter.click("p1/x");
    expect(handler).toHaveBeenCalledExactlyOnceWith("p1");

    adapter.click("no-slash");
    expect(handler).toHaveBeenCalledTimes(1);

    unsubscribe();
    adapter.click("p1/y");
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
