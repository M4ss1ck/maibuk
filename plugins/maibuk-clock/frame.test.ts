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
import { afterEach, describe, expect, it } from "vitest";
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

  it("renders the Spanish labels without a hardcoded English string", () => {
    renderFrame({ labels: ES, language: "es", hourCycle: 24 });

    expect(el("tab-timer-label").textContent).toBe("Temporizador");
    expect(el("tab-stopwatch-label").textContent).toBe("Cronómetro");
    expect(el("pomodoro-phase").textContent).toBe("Pomodoro 2 de 4");
    expect(el("cycle-lengths").textContent).toBe("25 · 5 · 15 min, los descansos empiezan solos");
    expect(el("pomodoro-reset").getAttribute("aria-label")).toBe("Reiniciar ciclo");
    expect(el("timer-primary-label").textContent).toBe("Iniciar 25:00");
    expect(el("pomodoros-today").textContent).toBe("Pomodoros hoy: 3");

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
    ];
    for (const word of english) expect(visible).not.toContain(word);
  });

  it("tells the Worker the Frame closed when the page is hidden", () => {
    const port = renderFrame();
    window.dispatchEvent(new Event("pagehide"));
    expect(posted(port, "closed")).toHaveLength(1);
  });
});
