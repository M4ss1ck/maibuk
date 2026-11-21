// @vitest-environment jsdom
/**
 * The Clock Frame's shell (#886) in jsdom: the real `assets/ui/clock.js` loaded
 * against the real `assets/ui/clock.html` markup and a stand-in
 * `window.maibuk.port`. Each behavior is driven by `user-event` key presses and
 * asserted by what the Frame drew and what it posted to the Worker, never by an
 * attribute the browser would keep on its own.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "./locales/runtime/en.json";
import es from "./locales/runtime/es.json";
import { tabTo, type User } from "./test-support";
import { formatClockTime } from "./time";

const HTML = readFileSync(join(__dirname, "assets/ui/clock.html"), "utf8");
const SCRIPT = readFileSync(join(__dirname, "assets/ui/clock.js"), "utf8");

const EN = en as Record<string, string>;
const ES = es as Record<string, string>;

/** One `window.maibuk.port`: records what the Frame posts, delivers what the Worker sends. */
class FakePort {
  onmessage: ((event: MessageEvent) => void) | null = null;
  readonly messages: Record<string, unknown>[] = [];
  start(): void {}
  close(): void {}
  postMessage(message: Record<string, unknown>): void {
    this.messages.push(message);
  }
  /** Hands the Frame one Worker -> Frame message. */
  deliver(message: Record<string, unknown>): void {
    this.onmessage?.({ data: message } as MessageEvent);
  }
}

/** Loads the Frame's markup and script with a stand-in port. */
function loadFrame(): FakePort {
  document.documentElement.innerHTML = HTML.replace(/^<!doctype html>\s*/i, "");
  const port = new FakePort();
  (window as unknown as { maibuk: unknown }).maibuk = { port };
  new Function(SCRIPT)();
  return port;
}

/** The `labels` message the Worker sends, catalog keys as they ship. */
function labelsMessage(
  catalog: Record<string, string>,
  language: string,
  hourCycle: 12 | 24
): Record<string, unknown> {
  return { kind: "labels", language, hourCycle, labels: { ...catalog } };
}

/** A whole Clock state, with today's day computed for the current clock. */
function stateMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Date.now();
  const day = Math.floor((now - new Date(now).getTimezoneOffset() * 60_000) / 86_400_000);
  return {
    kind: "state",
    timer: { state: { status: "idle", length: 1_500_000 }, recent: [300_000, 900_000, 1_500_000] },
    pomodoro: {
      state: { phase: "pomodoro", pomodoro: 2, status: "running", endsAt: now + 1_122_000 },
      settings: {
        pomodoroMinutes: 25,
        shortBreakMinutes: 5,
        longBreakMinutes: 15,
        longBreakEvery: 4,
        autoStartBreaks: true,
        autoStartPomodoros: false,
      },
      today: { day, count: 3 },
    },
    stopwatch: { status: "idle" },
    alarms: [],
    notifications: { permission: "granted", canScheduleWhileClosed: true, exactTiming: true },
    ...overrides,
  };
}

interface RenderOptions {
  labels?: Record<string, string>;
  language?: string;
  hourCycle?: 12 | 24;
  state?: Record<string, unknown>;
}

/** Loads the Frame and delivers the labels and the state, in that order. */
function renderFrame(options: RenderOptions = {}): FakePort {
  const port = loadFrame();
  port.deliver(
    labelsMessage(options.labels ?? EN, options.language ?? "en", options.hourCycle ?? 12)
  );
  port.deliver(options.state ?? stateMessage());
  return port;
}

/** The element with `id`, which the loaded markup always carries. */
function el(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`missing #${id}`);
  return element;
}

/** Every message of one kind, in the order the Frame posted them. */
function posted(port: FakePort, kind: string): Record<string, unknown>[] {
  return port.messages.filter((message) => message.kind === kind);
}

/** A keyboard-only user with no inter-key delay. */
function keyboardUser(): User {
  return userEvent.setup({ delay: null });
}

/** The one element matching `selector` inside `root`. */
function find(root: HTMLElement, selector: string): HTMLElement {
  const element = root.querySelector(selector);
  if (!(element instanceof HTMLElement)) throw new Error(`missing ${selector}`);
  return element;
}

/** The weekday toggle at `day`, 0=Sunday through 6. */
function dayToggle(day: number): HTMLInputElement {
  const input = el("alarm-days").querySelectorAll("input")[day];
  if (!(input instanceof HTMLInputElement)) throw new Error(`missing day ${day}`);
  return input;
}

/** An input's value, which the Frame writes and the author types into. */
function inputValue(id: string): string {
  const input = el(id);
  if (!(input instanceof HTMLInputElement)) throw new Error(`#${id} is not an input`);
  return input.value;
}

/** One Alarm the Worker holds, owed its occurrence. */
function alarmMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "a1",
    hour: 6,
    minute: 30,
    label: "Morning pages",
    weekdays: [1],
    enabled: true,
    nextAt: Date.now() + 3_600_000,
    ...overrides,
  };
}

afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  delete (window as unknown as { maibuk?: unknown }).maibuk;
  document.documentElement.innerHTML = "";
});

describe("Clock Frame", () => {
  it("draws nothing until both the labels and the state have arrived", () => {
    const port = loadFrame();
    expect(el("clock").hidden).toBe(true);

    port.deliver(stateMessage());
    expect(el("clock").hidden).toBe(true);

    port.deliver(labelsMessage(EN, "en", 12));
    expect(el("clock").hidden).toBe(false);
    expect(el("tab-timer-label").textContent).toBe("Timer");
    expect(el("tab-pomodoro-label").textContent).toBe("Pomodoro");
  });

  it("moves the section tabs with Arrow keys, Home, and End", async () => {
    renderFrame();
    const user = keyboardUser();

    await user.tab();
    expect(document.activeElement).toBe(el("tab-timer"));
    expect(el("panel-timer").hidden).toBe(false);

    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(el("tab-stopwatch"));
    expect(el("panel-stopwatch").hidden).toBe(false);
    expect(el("panel-timer").hidden).toBe(true);

    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(el("tab-alarms"));

    await user.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(el("tab-stopwatch"));

    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(el("tab-pomodoro"));
    expect(el("panel-pomodoro").hidden).toBe(false);

    await user.keyboard("{End}");
    expect(document.activeElement).toBe(el("tab-alarms"));
    expect(el("panel-alarms").hidden).toBe(false);
  });

  it("reaches Reset Cycle, Pause, and Skip by keyboard", async () => {
    const port = renderFrame();
    const user = keyboardUser();

    await user.tab();
    await user.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(el("tab-pomodoro"));

    await tabTo(user, el("pomodoro-reset"));
    await user.keyboard("{Enter}");
    expect(posted(port, "pomodoro.reset")).toHaveLength(1);

    await tabTo(user, el("pomodoro-primary"));
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(posted(port, "pomodoro.pause")).toHaveLength(2);

    await tabTo(user, el("pomodoro-skip"));
    await user.keyboard("{Enter}");
    expect(posted(port, "pomodoro.skip")).toHaveLength(1);
  });

  it("reaches Allow notifications, a Recent chip, and Start by keyboard", async () => {
    const port = renderFrame({
      state: stateMessage({
        notifications: { permission: "denied", canScheduleWhileClosed: false, exactTiming: false },
      }),
    });
    expect(el("banner").hidden).toBe(false);
    const user = keyboardUser();

    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(el("allow-notifications"));
    await user.keyboard("{Enter}");
    expect(posted(port, "notifications.allow")).toHaveLength(1);

    const chips = el("recent-list").querySelectorAll("button");
    expect(chips).toHaveLength(3);
    await tabTo(user, chips[0]);
    await user.keyboard("{Enter}");
    expect(port.messages).toContainEqual({ kind: "timer.setLength", length: 300_000 });

    await tabTo(user, el("timer-primary"));
    await user.keyboard("{Enter}");
    expect(posted(port, "timer.start")).toHaveLength(1);
  });

  it("posts a new Timer length when the author types minutes", async () => {
    const port = renderFrame();
    const user = keyboardUser();

    await user.tab();
    await tabTo(user, el("timer-minutes"));
    await user.clear(el("timer-minutes"));
    await user.type(el("timer-minutes"), "5");

    const lengths = posted(port, "timer.setLength").map((message) => message.length);
    expect(lengths).toContain(300_000);
  });

  it("shows Reset beside Start once the Timer has ended", async () => {
    const port = renderFrame({
      state: stateMessage({
        timer: { state: { status: "ended", length: 300_000, endedAt: Date.now() }, recent: [] },
      }),
    });
    expect(el("timer-setup").hidden).toBe(false);
    expect(el("timer-reset").hidden).toBe(false);
    expect(el("timer-primary-label").textContent).toBe("Start 5:00");
    const user = keyboardUser();

    await user.tab();
    await tabTo(user, el("timer-reset"));
    await user.keyboard("{Enter}");
    expect(posted(port, "timer.reset")).toHaveLength(1);
  });

  it("switches tabs from the Also running card", async () => {
    renderFrame({
      state: stateMessage({ stopwatch: { status: "paused", banked: 65_000, laps: [] } }),
    });
    expect(el("also-running").hidden).toBe(false);
    const buttons = el("also-running-list").querySelectorAll("button");
    expect(buttons).toHaveLength(2);
    const user = keyboardUser();

    await user.tab();
    await tabTo(user, buttons[1]);
    await user.keyboard("{Enter}");
    expect(el("panel-stopwatch").hidden).toBe(false);
    expect(document.activeElement).toBe(el("tab-stopwatch"));
  });

  it("announces the Timer's remaining minutes in the live region", () => {
    const port = renderFrame({
      state: stateMessage({
        timer: {
          state: { status: "running", length: 300_000, endsAt: Date.now() + 300_000 },
          recent: [],
        },
      }),
    });
    expect(el("live").textContent).toBe("5 minutes left");

    port.deliver(
      stateMessage({
        timer: { state: { status: "paused", length: 60_000, remaining: 60_000 }, recent: [] },
      })
    );
    expect(el("live").textContent).toBe("1 minute left");

    port.deliver(
      stateMessage({
        timer: { state: { status: "ended", length: 60_000, endedAt: Date.now() }, recent: [] },
      })
    );
    expect(el("live").textContent).toBe("Timer ended");

    port.deliver(stateMessage());
    expect(el("live").textContent).toBe("");
  });

  it("shows the Timer's end time and pauses it by keyboard while it runs", async () => {
    const endsAt = Date.now() + 600_000;
    const port = renderFrame({
      state: stateMessage({
        timer: { state: { status: "running", length: 900_000, endsAt }, recent: [] },
      }),
    });
    const offset = new Date(endsAt).getTimezoneOffset();
    expect(el("timer-time").textContent).toBe("10:00");
    expect(el("timer-sub").textContent).toBe(`ends ${formatClockTime(endsAt, offset, 12)}`);
    expect(el("timer-time").getAttribute("aria-label")).toBe("10:00 left");
    expect(el("timer-primary-label").textContent).toBe("Pause");
    const user = keyboardUser();

    await user.tab();
    await tabTo(user, el("timer-primary"));
    await user.keyboard(" ");
    expect(posted(port, "timer.pause")).toHaveLength(1);
  });

  it("starts, laps, pauses, resumes, and resets the Stopwatch by keyboard", async () => {
    const port = renderFrame();
    const user = keyboardUser();

    await user.tab();
    await user.keyboard("{ArrowRight}");
    expect(el("panel-stopwatch").hidden).toBe(false);
    expect(el("stopwatch-primary-label").textContent).toBe("Start");
    expect(el("stopwatch-lap").hidden).toBe(true);
    expect(el("laps-card").hidden).toBe(true);

    await tabTo(user, el("stopwatch-primary"));
    await user.keyboard("{Enter}");
    expect(posted(port, "stopwatch.start")).toHaveLength(1);

    port.deliver(
      stateMessage({ stopwatch: { status: "running", startedAt: Date.now(), banked: 0, laps: [] } })
    );
    expect(el("stopwatch-primary-label").textContent).toBe("Pause");
    expect(el("stopwatch-lap").hidden).toBe(false);
    expect(el("stopwatch-lap-pill").textContent).toBe("Lap 1");

    await tabTo(user, el("stopwatch-lap"));
    await user.keyboard("{Enter}");
    expect(posted(port, "stopwatch.lap")).toHaveLength(1);

    await tabTo(user, el("stopwatch-primary"));
    await user.keyboard(" ");
    expect(posted(port, "stopwatch.pause")).toHaveLength(1);

    port.deliver(stateMessage({ stopwatch: { status: "paused", banked: 65_000, laps: [] } }));
    expect(el("stopwatch-primary-label").textContent).toBe("Resume");
    expect(el("stopwatch-lap").hidden).toBe(true);
    expect(el("stopwatch-reset").hidden).toBe(false);

    await tabTo(user, el("stopwatch-primary"));
    await user.keyboard("{Enter}");
    expect(posted(port, "stopwatch.start")).toHaveLength(2);

    await tabTo(user, el("stopwatch-reset"));
    await user.keyboard("{Enter}");
    expect(posted(port, "stopwatch.reset")).toHaveLength(1);
  });

  it("lists the Laps newest first with the Fastest and Slowest marked", () => {
    renderFrame({
      state: stateMessage({
        stopwatch: {
          status: "paused",
          banked: 340_000,
          laps: [
            { length: 120_000, total: 120_000 },
            { length: 100_000, total: 220_000 },
            { length: 120_000, total: 340_000 },
          ],
        },
      }),
    });
    expect(el("laps-card").hidden).toBe(false);
    expect(el("laps-title").textContent).toBe("Laps");

    const rows = el("laps-body").querySelectorAll("tr");
    expect(rows).toHaveLength(3);
    const rowAt = (index: number) => {
      const cells = Array.from(rows[index].querySelectorAll("td"));
      return {
        number: cells[0].querySelector(".number")?.textContent,
        tag: cells[0].querySelector(".tag")?.textContent ?? "",
        lap: cells[1].textContent,
        total: cells[2].textContent,
      };
    };
    expect(rowAt(0)).toEqual({ number: "3", tag: "", lap: "00:02:00.00", total: "00:05:40.00" });
    expect(rowAt(1)).toEqual({
      number: "2",
      tag: "Fastest",
      lap: "00:01:40.00",
      total: "00:03:40.00",
    });
    expect(rowAt(2)).toEqual({
      number: "1",
      tag: "Slowest",
      lap: "00:02:00.00",
      total: "00:02:00.00",
    });
  });

  it("adds an alarm through the editor by keyboard", async () => {
    const port = renderFrame();
    const user = keyboardUser();

    expect(el("add-alarm").hidden).toBe(true);
    expect(el("pomodoros-today").hidden).toBe(false);

    await user.tab();
    await user.keyboard("{End}");
    expect(el("panel-alarms").hidden).toBe(false);
    expect(el("no-alarms").hidden).toBe(false);
    expect(el("no-alarms").textContent).toBe("No alarms yet.");
    expect(el("next-alarm").hidden).toBe(true);
    expect(el("add-alarm").closest("header")).not.toBeNull();
    expect(el("add-alarm").hidden).toBe(false);
    expect(el("pomodoros-today").hidden).toBe(true);

    await tabTo(user, el("add-alarm"));
    await user.keyboard("{Enter}");
    expect(el("alarm-editor").hidden).toBe(false);
    expect(document.activeElement).toBe(el("alarm-label"));
    expect(el("alarm-editor-title").textContent).toBe("Add alarm");

    await user.clear(el("alarm-hour"));
    await user.type(el("alarm-hour"), "7");
    await user.clear(el("alarm-minute"));
    await user.type(el("alarm-minute"), "15");
    await user.type(el("alarm-label"), "Morning pages");

    await tabTo(user, dayToggle(1));
    await user.keyboard(" ");
    expect(dayToggle(1).checked).toBe(true);
    expect(dayToggle(2).checked).toBe(false);

    await tabTo(user, el("alarm-save"));
    await user.keyboard("{Enter}");

    expect(posted(port, "alarm.add")).toEqual([
      {
        kind: "alarm.add",
        input: { hour: 7, minute: 15, label: "Morning pages", weekdays: [1] },
      },
    ]);
    expect(el("alarm-editor").hidden).toBe(true);
    expect(document.activeElement).toBe(el("add-alarm"));
  });

  it("opens the editor with the Alarm's fields and posts alarm.edit", async () => {
    const port = renderFrame({
      state: stateMessage({ alarms: [alarmMessage({ weekdays: [1, 2] })] }),
    });
    const user = keyboardUser();

    await user.tab();
    await user.keyboard("{End}");
    const edit = find(el("alarm-list"), '[aria-label="Edit 6:30 AM"]');

    await tabTo(user, edit);
    await user.keyboard("{Enter}");
    expect(el("alarm-editor").hidden).toBe(false);
    expect(el("alarm-editor-title").textContent).toBe("Edit 6:30 AM");
    expect(inputValue("alarm-hour")).toBe("06");
    expect(inputValue("alarm-minute")).toBe("30");
    expect(inputValue("alarm-label")).toBe("Morning pages");
    expect(dayToggle(1).checked).toBe(true);
    expect(dayToggle(2).checked).toBe(true);
    expect(dayToggle(3).checked).toBe(false);

    await user.clear(el("alarm-hour"));
    await user.type(el("alarm-hour"), "8");
    await tabTo(user, el("alarm-save"));
    await user.keyboard("{Enter}");

    expect(posted(port, "alarm.edit")).toEqual([
      {
        kind: "alarm.edit",
        id: "a1",
        input: { hour: 8, minute: 30, label: "Morning pages", weekdays: [1, 2] },
      },
    ]);
    expect(el("alarm-editor").hidden).toBe(true);
    expect(document.activeElement).toBe(edit);
  });

  it("turns an alarm off from its switch and deletes it by keyboard", async () => {
    const port = renderFrame({ state: stateMessage({ alarms: [alarmMessage()] }) });
    const user = keyboardUser();

    await user.tab();
    await user.keyboard("{End}");
    const toggle = find(el("alarm-list"), '[role="switch"]');
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(toggle.getAttribute("aria-label")).toBe("Alarm 6:30 AM");

    await tabTo(user, toggle);
    await user.keyboard(" ");
    expect(posted(port, "alarm.setEnabled")).toEqual([
      { kind: "alarm.setEnabled", id: "a1", enabled: false },
    ]);

    await tabTo(user, find(el("alarm-list"), '[aria-label="Delete 6:30 AM"]'));
    await user.keyboard("{Enter}");
    expect(posted(port, "alarm.remove")).toEqual([{ kind: "alarm.remove", id: "a1" }]);
  });

  it("names the repeat weekdays on the row's chips", async () => {
    const port = renderFrame({
      state: stateMessage({
        alarms: [
          alarmMessage({ weekdays: [0, 1, 2, 3, 4, 5, 6] }),
          alarmMessage({ id: "a2", hour: 13, minute: 15, label: "", weekdays: [] }),
        ],
      }),
    });
    const user = keyboardUser();

    await user.tab();
    await user.keyboard("{End}");
    await tabTo(user, find(el("alarm-list"), '[aria-label="Edit 6:30 AM"]'));

    const rows = el("alarm-list").querySelectorAll("li");
    const repeating = find(rows[0] as HTMLElement, ".alarm-repeat");
    expect(repeating.getAttribute("aria-label")).toBe("Sun, Mon, Tue, Wed, Thu, Fri, Sat");
    const chips = Array.from(repeating.querySelectorAll(".day-chip"));
    expect(chips).toHaveLength(7);
    expect(chips.map((chip) => chip.textContent)).toEqual(["S", "M", "T", "W", "T", "F", "S"]);
    expect(chips.every((chip) => chip.getAttribute("aria-hidden") === "true")).toBe(true);
    expect(chips.filter((chip) => chip.classList.contains("on"))).toHaveLength(7);

    const once = find(rows[1] as HTMLElement, ".alarm-repeat");
    expect(once.getAttribute("aria-label")).toBeNull();
    expect(once.textContent).toBe("Once");
    expect(once.querySelectorAll(".day-chip")).toHaveLength(0);
    expect(port.messages).toEqual([]);
  });

  it("names two Alarms at the same time apart by their label and repeat", async () => {
    const port = renderFrame({
      state: stateMessage({
        alarms: [
          alarmMessage({ weekdays: [1] }),
          alarmMessage({ id: "a2", label: "", weekdays: [] }),
        ],
      }),
    });
    const user = keyboardUser();

    await user.tab();
    await user.keyboard("{End}");
    const rows = el("alarm-list").querySelectorAll("li");
    const first = rows[0] as HTMLElement;
    const second = rows[1] as HTMLElement;

    // Both draw 6:30 AM, so each control names itself with the time, the label,
    // and the repeat that tell it from the other.
    expect(find(first, '[role="switch"]').getAttribute("aria-label")).toBe(
      "Alarm 6:30 AM, Morning pages, Mon"
    );
    expect(find(first, '[aria-label^="Edit "]').getAttribute("aria-label")).toBe(
      "Edit 6:30 AM, Morning pages, Mon"
    );
    expect(find(first, '[aria-label^="Delete "]').getAttribute("aria-label")).toBe(
      "Delete 6:30 AM, Morning pages, Mon"
    );
    expect(find(second, '[role="switch"]').getAttribute("aria-label")).toBe("Alarm 6:30 AM, Once");
    expect(find(second, '[aria-label^="Edit "]').getAttribute("aria-label")).toBe(
      "Edit 6:30 AM, Once"
    );
    expect(find(second, '[aria-label^="Delete "]').getAttribute("aria-label")).toBe(
      "Delete 6:30 AM, Once"
    );

    // The longer names are what the keyboard reaches: the second Alarm's switch
    // turns that one off, and the first Alarm's Edit opens its own fields.
    await tabTo(user, find(second, '[role="switch"]'));
    await user.keyboard(" ");
    expect(posted(port, "alarm.setEnabled")).toEqual([
      { kind: "alarm.setEnabled", id: "a2", enabled: false },
    ]);

    await tabTo(user, find(first, '[aria-label^="Edit "]'));
    await user.keyboard("{Enter}");
    expect(el("alarm-editor").hidden).toBe(false);
    expect(inputValue("alarm-label")).toBe("Morning pages");
    await user.keyboard("{Escape}");
    expect(el("alarm-editor").hidden).toBe(true);
  });

  it("closes the editor with Escape without posting and returns focus to Add alarm", async () => {
    const port = renderFrame();
    const user = keyboardUser();

    await user.tab();
    await user.keyboard("{End}");
    await tabTo(user, el("add-alarm"));
    await user.keyboard("{Enter}");
    expect(el("alarm-editor").hidden).toBe(false);

    await user.keyboard("{Escape}");
    expect(el("alarm-editor").hidden).toBe(true);
    expect(document.activeElement).toBe(el("add-alarm"));
    expect(port.messages).toEqual([]);
  });

  it("keeps Tab and Shift+Tab inside the alarm editor", async () => {
    renderFrame();
    const user = keyboardUser();

    await user.tab();
    await user.keyboard("{End}");
    await tabTo(user, el("add-alarm"));
    await user.keyboard("{Enter}");
    expect(document.activeElement).toBe(el("alarm-label"));

    await tabTo(user, el("alarm-save"));
    expect(document.activeElement).toBe(el("alarm-save"));
    await user.tab();
    expect(document.activeElement).toBe(el("alarm-editor-close"));

    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(document.activeElement).toBe(el("alarm-save"));
    expect(el("alarm-editor").hidden).toBe(false);
  });

  it("writes the next alarm in the local day and the hours left", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 10, 16, 13, 32, 0));
      const nextAt = new Date(2026, 10, 17, 6, 30, 0).getTime();
      const port = renderFrame({
        state: stateMessage({ alarms: [alarmMessage({ weekdays: [2], nextAt })] }),
      });
      expect(el("next-alarm").hidden).toBe(false);
      expect(el("next-alarm").textContent).toBe("Next alarm tomorrow at 6:30 AM, in 16 h 58 min");

      port.deliver(stateMessage({ alarms: [alarmMessage({ enabled: false, nextAt: null })] }));
      expect(el("next-alarm").hidden).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("counts no Pomodoros today after local midnight, with the Pomodoro tab open", async () => {
    // `shouldAdvanceTime` lets user-event's own zero-delay timeout run, which
    // its React wrapper always sets even when the suite fakes the clock.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.setSystemTime(new Date(2026, 10, 16, 23, 59, 30));
      const state = stateMessage();
      // An idle Cycle: nothing runs, so only the open Pomodoro tab keeps the tick.
      state.pomodoro = {
        ...(state.pomodoro as Record<string, unknown>),
        state: { phase: "pomodoro", pomodoro: 1, status: "idle" },
      };
      renderFrame({ state });
      const user = keyboardUser();

      await user.tab();
      await user.keyboard("{ArrowLeft}");
      expect(el("panel-pomodoro").hidden).toBe(false);
      expect(el("pomodoros-today").textContent).toBe("Pomodoros today: 3");

      // The tick crosses local midnight: the count is yesterday's, so it reads zero.
      vi.advanceTimersByTime(60_000);
      expect(el("pomodoros-today").textContent).toBe("Pomodoros today: 0");
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders the Spanish labels without a hardcoded English string", () => {
    renderFrame({
      labels: ES,
      language: "es",
      hourCycle: 24,
      state: stateMessage({
        stopwatch: {
          status: "paused",
          banked: 190_000,
          laps: [
            { length: 90_000, total: 90_000 },
            { length: 100_000, total: 190_000 },
          ],
        },
        alarms: [alarmMessage({ label: "Páginas", weekdays: [1, 2, 3, 4, 5] })],
      }),
    });

    expect(el("tab-timer-label").textContent).toBe("Temporizador");
    expect(el("tab-stopwatch-label").textContent).toBe("Cronómetro");
    expect(el("pomodoro-phase").textContent).toBe("Pomodoro 2 de 4");
    expect(el("cycle-lengths").textContent).toBe("25 · 5 · 15 min, los descansos empiezan solos");
    expect(el("pomodoro-reset").getAttribute("aria-label")).toBe("Reiniciar ciclo");
    expect(el("timer-primary-label").textContent).toBe("Iniciar 25:00");
    expect(el("pomodoros-today").textContent).toBe("Pomodoros hoy: 3");

    expect(el("laps-title").textContent).toBe("Vueltas");
    expect(el("laps-col-lap-time").textContent).toBe("Tiempo de vuelta");
    expect(el("stopwatch-primary-label").textContent).toBe("Reanudar");
    expect(el("stopwatch-reset").getAttribute("aria-label")).toBe("Reiniciar");
    const tags = Array.from(el("laps-body").querySelectorAll(".tag")).map((tag) => tag.textContent);
    expect(tags).toEqual(["Más lenta", "Más rápida"]);

    expect(el("add-alarm-label").textContent).toBe("Añadir alarma");
    const row = el("alarm-list").querySelector("li");
    const repeat = row?.querySelector(".alarm-repeat");
    expect(repeat?.getAttribute("aria-label")).toBe("Lun, Mar, Mié, Jue, Vie");
    const chips = Array.from(repeat?.querySelectorAll(".day-chip") ?? []).map(
      (chip) => chip.textContent
    );
    expect(chips).toEqual(["D", "L", "M", "M", "J", "V", "S"]);
    expect(row?.querySelector('[role="switch"]')?.getAttribute("aria-label")).toBe("Alarma 06:30");
    expect(row?.querySelector('[aria-label="Editar 06:30"]')).not.toBeNull();
    expect(row?.querySelector('[aria-label="Eliminar 06:30"]')).not.toBeNull();
    expect(el("next-alarm").textContent).toMatch(/^Próxima alarma .+ a las \d\d:\d\d, en /);

    const ariaLabels = [...document.querySelectorAll("[aria-label]")].map(
      (element) => element.getAttribute("aria-label") ?? ""
    );
    const visible = [document.body.textContent ?? "", ...ariaLabels].join(" ");
    const english = [
      "Timer",
      "Stopwatch",
      "Alarms",
      "Short break",
      "Long break",
      "Pomodoros today",
      "This Cycle",
      "Also running",
      "Recent",
      "Alerts",
      "Start",
      "Pause",
      "Resume",
      "Reset",
      "Skip",
      "Hours",
      "Minutes",
      "Seconds",
      "running",
      "Allow notifications",
      "Notifications are off",
      "Open",
      "Timer length",
      "breaks start on their own",
      "Laps",
      "Lap time",
      "Fastest",
      "Slowest",
      "Add alarm",
      "No alarms yet",
      "Once",
      "Repeat",
      "Save",
      "Hour",
      "Minute",
      "Label",
      "Next alarm",
      "today",
      "tomorrow",
      "Leave every day off",
    ];
    for (const word of english) expect(visible).not.toContain(word);
  });

  it("tells the Worker the Frame closed when the page is hidden", () => {
    const port = renderFrame();
    window.dispatchEvent(new Event("pagehide"));
    expect(posted(port, "closed")).toHaveLength(1);
  });
});
