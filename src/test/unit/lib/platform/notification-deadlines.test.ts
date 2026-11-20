import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNotificationDeadlines } from "@/lib/platform/notification-deadlines";

const SECOND_MS = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const START = new Date("2026-01-01T00:00:00Z").getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createNotificationDeadlines()", () => {
  it("fires at the deadline and not before", async () => {
    const fire = vi.fn();
    const deadlines = createNotificationDeadlines(fire);
    const notification = {
      tag: "clock/alarm",
      title: "Alarm",
      body: "Wake",
      at: START + SECOND_MS,
    };

    deadlines.schedule(notification);
    await vi.advanceTimersByTimeAsync(SECOND_MS - 1);
    expect(fire).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(fire).toHaveBeenCalledTimes(1);
    expect(fire).toHaveBeenCalledWith(notification);
  });

  it("replaces the earlier deadline when the same tag is scheduled again", async () => {
    const fire = vi.fn();
    const deadlines = createNotificationDeadlines(fire);

    deadlines.schedule({ tag: "clock/alarm", title: "First", body: "One", at: START + SECOND_MS });
    deadlines.schedule({
      tag: "clock/alarm",
      title: "Second",
      body: "Two",
      at: START + 2 * SECOND_MS,
    });

    await vi.advanceTimersByTimeAsync(SECOND_MS);
    expect(fire).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(SECOND_MS);
    expect(fire).toHaveBeenCalledTimes(1);
    expect(fire).toHaveBeenCalledWith({
      tag: "clock/alarm",
      title: "Second",
      body: "Two",
      at: START + 2 * SECOND_MS,
    });
  });

  it("never fires a cancelled deadline", async () => {
    const fire = vi.fn();
    const deadlines = createNotificationDeadlines(fire);

    deadlines.schedule({ tag: "clock/alarm", title: "Alarm", body: "Wake", at: START + SECOND_MS });
    deadlines.cancel("clock/alarm");

    await vi.advanceTimersByTimeAsync(10 * SECOND_MS);
    expect(fire).not.toHaveBeenCalled();
  });

  it("cancels by prefix and leaves the other prefixes alone", async () => {
    const fire = vi.fn();
    const deadlines = createNotificationDeadlines(fire);

    deadlines.schedule({ tag: "clock/one", title: "One", body: "1", at: START + SECOND_MS });
    deadlines.schedule({ tag: "clock/two", title: "Two", body: "2", at: START + SECOND_MS });
    deadlines.schedule({ tag: "timer/one", title: "Three", body: "3", at: START + SECOND_MS });
    deadlines.cancelAll("clock/");

    await vi.advanceTimersByTimeAsync(SECOND_MS);
    expect(fire).toHaveBeenCalledTimes(1);
    expect(fire).toHaveBeenCalledWith({
      tag: "timer/one",
      title: "Three",
      body: "3",
      at: START + SECOND_MS,
    });
  });

  it("fires a deadline already past on the next tick", async () => {
    const fire = vi.fn();
    const deadlines = createNotificationDeadlines(fire);
    const notification = {
      tag: "clock/late",
      title: "Late",
      body: "Now",
      at: START - 5 * SECOND_MS,
    };

    deadlines.schedule(notification);
    expect(fire).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(0);
    expect(fire).toHaveBeenCalledWith(notification);
  });

  it("re-arms a deadline longer than the timer maximum until it is due", async () => {
    const fire = vi.fn();
    const deadlines = createNotificationDeadlines(fire);
    const notification = {
      tag: "clock/month",
      title: "Month",
      body: "Away",
      at: START + 30 * DAY_MS,
    };

    deadlines.schedule(notification);
    await vi.advanceTimersByTimeAsync(30 * DAY_MS - 1);
    expect(fire).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(fire).toHaveBeenCalledWith(notification);
  });

  it("forgets a deadline once it fired", async () => {
    const fire = vi.fn();
    const deadlines = createNotificationDeadlines(fire);

    deadlines.schedule({ tag: "clock/one", title: "One", body: "1", at: START + SECOND_MS });
    await vi.advanceTimersByTimeAsync(SECOND_MS);
    deadlines.cancel("clock/one");

    await vi.advanceTimersByTimeAsync(SECOND_MS);
    expect(fire).toHaveBeenCalledTimes(1);
  });
});
