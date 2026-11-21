/**
 * Clock's Frame wire protocol (#886): the messages the Plugin Worker and the
 * Clock Frame exchange over the Frame's MessagePort. The host never parses them
 * (`docs/plugins/frame-ui.md`), so this file is the one place both sides agree
 * on. `assets/ui/clock.js` mirrors these shapes as JSDoc typedefs and cannot
 * import this module: a Frame script is a classic script in an opaque origin,
 * so a relative import would fail closed.
 *
 * Every message starts with `kind`. The Worker owns the Timer, the Pomodoro,
 * the Stopwatch, the Alarms, and the labels, and answers every change with the
 * whole state as raw JSON; the Frame owns the markup, the keyboard, and every
 * derived display. The Worker drops any Frame message it cannot validate.
 * Imports only `@/plugin-sdk` types and this Plugin's files.
 */

import type { PluginClient } from "@/plugin-sdk";
import type { Alarm, AlarmInput, ClockAlarms } from "./alarms";
import { isValidPomodoroSettings, type PomodoroSettings } from "./cycle";
import { catalogFor, type ClockKey } from "./i18n";
import type { ClockPomodoro, PomodoroSnapshot } from "./pomodoro";
import type { ClockStopwatch } from "./stopwatch";
import { type ClockTab, type ClockTabState, isClockTab } from "./tab";
import type { ClockTimer, TimerSnapshot } from "./timer";
import { hourCycleFor, MAX_TIMER_LENGTH_MS, type StopwatchState } from "./time";

/* Worker -> Frame */

/** The localized strings the Frame shows, rebuilt in the app language. */
export interface FrameLabelsMessage {
  kind: "labels";
  language: string;
  hourCycle: 12 | 24;
  labels: Record<ClockKey, string>;
}

/** The System Notification facts the Frame's banner draws. */
export interface FrameNotificationStatus {
  permission: string;
  canScheduleWhileClosed: boolean;
  exactTiming: boolean;
}

/** Everything the Frame derives its display from, as raw JSON states. */
export interface FrameStateMessage {
  kind: "state";
  timer: TimerSnapshot;
  pomodoro: PomodoroSnapshot;
  stopwatch: StopwatchState;
  alarms: Alarm[];
  notifications: FrameNotificationStatus | null;
  /** The tab this device last opened; the Frame follows it only when it changes. */
  tab: ClockTab;
}

export type WorkerToFrameMessage =
  | FrameLabelsMessage
  | FrameStateMessage
  | { kind: "pomodoro.openSettings" };

/* Frame -> Worker */

/** One control the author pressed; the Worker drops anything malformed. */
export type FrameToWorkerMessage =
  | { kind: "timer.start" }
  | { kind: "timer.pause" }
  | { kind: "timer.reset" }
  | { kind: "timer.setLength"; length: number }
  | { kind: "pomodoro.start" }
  | { kind: "pomodoro.pause" }
  | { kind: "pomodoro.skip" }
  | { kind: "pomodoro.reset" }
  | { kind: "pomodoro.setSettings"; settings: PomodoroSettings }
  | { kind: "stopwatch.start" }
  | { kind: "stopwatch.pause" }
  | { kind: "stopwatch.lap" }
  | { kind: "stopwatch.reset" }
  | { kind: "alarm.add"; input: AlarmInput }
  | { kind: "alarm.edit"; id: string; input: AlarmInput }
  | { kind: "alarm.setEnabled"; id: string; enabled: boolean }
  | { kind: "alarm.remove"; id: string }
  | { kind: "notifications.allow" }
  | { kind: "tab.select"; tab: ClockTab }
  | { kind: "closed" };

/** A whole clock field, from zero through `max`. */
function isClockField(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max;
}

/**
 * One validated Alarm input, with its weekdays deduped and sorted, or null when
 * a field is missing or out of range. The Alarms module clamps what it is given,
 * so a malformed day would silently become another Alarm here.
 */
function alarmInput(value: unknown): AlarmInput | null {
  if (typeof value !== "object" || value === null) return null;
  const input = value as Record<string, unknown>;
  const { hour, minute, label, weekdays } = input;
  if (!isClockField(hour, 23) || !isClockField(minute, 59)) return null;
  if (typeof label !== "string") return null;
  if (!Array.isArray(weekdays) || !weekdays.every((day) => isClockField(day, 6))) return null;
  return { hour, minute, label, weekdays: [...new Set(weekdays)].sort((a, b) => a - b) };
}

/**
 * Holds the one open-settings request between the Command and a Frame that may
 * not have received its labels yet. `request` raises a flag and tells the
 * listeners; `take` reads the flag once and clears it, so a request reaches one
 * Frame once.
 */
export interface SettingsRequest {
  request(): void;
  take(): boolean;
  subscribe(listener: () => void): () => void;
}

/** A fresh settings request: pending on `request`, handed out once by `take`. */
export function createSettingsRequest(): SettingsRequest {
  let pending = false;
  const listeners = new Set<() => void>();
  return {
    request() {
      pending = true;
      for (const listener of listeners) listener();
    },
    take() {
      const value = pending;
      pending = false;
      return value;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * Wires one mounted Clock Frame to the modules the Worker holds: sends the
 * labels and the whole state on connect, sends the state again on every module
 * change and after the notification status is read, runs the Frame's intents,
 * and re-sends the labels on `language.changed`. A pending settings request is
 * posted once the labels have gone out, so the Frame has its words before it
 * opens the dialog. Returns the dispose, which the Frame's own `closed` also
 * runs. Client errors are swallowed, as `runtime.tsx` does today.
 */
export function connectClockFrame(
  port: MessagePort,
  deps: {
    client: PluginClient;
    timer: ClockTimer;
    pomodoro: ClockPomodoro;
    stopwatch: ClockStopwatch;
    alarms: ClockAlarms;
    tab: ClockTabState;
    settingsRequest: SettingsRequest;
  }
): () => void {
  const { client, timer, pomodoro, stopwatch, alarms, tab, settingsRequest } = deps;
  let disposed = false;
  let labelsSent = false;
  let language = "en";
  let notifications: FrameNotificationStatus | null = null;
  const unsubscribes: (() => void | Promise<void>)[] = [];

  function post(message: WorkerToFrameMessage): void {
    if (disposed) return;
    port.postMessage(message);
  }

  function sendLabels(): void {
    post({
      kind: "labels",
      language,
      hourCycle: hourCycleFor(language),
      labels: { ...catalogFor(language) },
    });
    labelsSent = true;
    sendSettingsRequest();
  }

  /** Posts the open-settings signal once, only after the labels are out. */
  function sendSettingsRequest(): void {
    if (disposed || !labelsSent) return;
    if (!settingsRequest.take()) return;
    post({ kind: "pomodoro.openSettings" });
  }

  function sendState(): void {
    post({
      kind: "state",
      timer: timer.snapshot(),
      pomodoro: pomodoro.snapshot(),
      stopwatch: stopwatch.snapshot(),
      alarms: alarms.snapshot(),
      notifications,
      tab: tab.snapshot(),
    });
  }

  function applyLanguage(next: string): void {
    language = next;
    sendLabels();
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    port.onmessage = null;
    for (const unsubscribe of unsubscribes.splice(0)) void unsubscribe();
    try {
      port.close();
    } catch {
      // A port that never started has nothing to close.
    }
  }

  function handle(value: unknown): void {
    if (disposed || typeof value !== "object" || value === null) return;
    const kind = (value as { kind?: unknown }).kind;
    switch (kind) {
      case "timer.start":
        timer.start();
        return;
      case "timer.pause":
        timer.pause();
        return;
      case "timer.reset":
        timer.reset();
        return;
      case "timer.setLength": {
        const { length } = value as { length: unknown };
        if (typeof length !== "number" || !Number.isFinite(length) || length < 0) return;
        // A length the Duration input could never express would freeze the readout.
        if (length > MAX_TIMER_LENGTH_MS) return;
        timer.setLength(length);
        return;
      }
      case "pomodoro.start":
        pomodoro.start();
        return;
      case "pomodoro.pause":
        pomodoro.pause();
        return;
      case "pomodoro.skip":
        pomodoro.skip();
        return;
      case "pomodoro.reset":
        pomodoro.reset();
        return;
      case "pomodoro.setSettings": {
        const { settings } = value as { settings: unknown };
        if (!isValidPomodoroSettings(settings)) return;
        pomodoro.setSettings({
          pomodoroMinutes: settings.pomodoroMinutes,
          shortBreakMinutes: settings.shortBreakMinutes,
          longBreakMinutes: settings.longBreakMinutes,
          longBreakEvery: settings.longBreakEvery,
          autoStartBreaks: settings.autoStartBreaks,
          autoStartPomodoros: settings.autoStartPomodoros,
        });
        return;
      }
      case "stopwatch.start":
        stopwatch.start();
        return;
      case "stopwatch.pause":
        stopwatch.pause();
        return;
      case "stopwatch.lap":
        stopwatch.lap();
        return;
      case "stopwatch.reset":
        stopwatch.reset();
        return;
      case "alarm.add": {
        const { input } = value as { input: unknown };
        const checked = alarmInput(input);
        if (checked !== null) alarms.add(checked);
        return;
      }
      case "alarm.edit": {
        const { id, input } = value as { id: unknown; input: unknown };
        const checked = alarmInput(input);
        if (typeof id === "string" && checked !== null) alarms.edit(id, checked);
        return;
      }
      case "alarm.setEnabled": {
        const { id, enabled } = value as { id: unknown; enabled: unknown };
        if (typeof id === "string" && typeof enabled === "boolean") {
          alarms.setEnabled(id, enabled);
        }
        return;
      }
      case "alarm.remove": {
        const { id } = value as { id: unknown };
        if (typeof id === "string") alarms.remove(id);
        return;
      }
      case "notifications.allow":
        void client.notifications
          .requestSystemPermission()
          .then(() => client.notifications.systemStatus())
          .then((status) => {
            notifications = status;
            sendState();
          })
          .catch(() => {});
        return;
      case "tab.select": {
        const { tab: next } = value as { tab: unknown };
        if (isClockTab(next)) tab.select(next);
        return;
      }
      case "closed":
        dispose();
        return;
      default:
        return;
    }
  }

  port.onmessage = (event: MessageEvent) => handle(event.data);
  port.start();

  unsubscribes.push(
    timer.subscribe(sendState),
    pomodoro.subscribe(sendState),
    stopwatch.subscribe(sendState),
    alarms.subscribe(sendState),
    tab.subscribe(sendState),
    settingsRequest.subscribe(sendSettingsRequest)
  );
  sendState();

  void client.language
    .get()
    .then((value) => applyLanguage(value.language))
    .catch(() => {});

  void client
    .on("language.changed", (payload) => applyLanguage(payload.language))
    .then((unsubscribe) => {
      if (disposed) void unsubscribe();
      else unsubscribes.push(unsubscribe);
    })
    .catch(() => {});

  void client.notifications
    .systemStatus()
    .then((status) => {
      notifications = status;
      sendState();
    })
    .catch(() => {});

  return dispose;
}
