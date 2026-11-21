/**
 * The Alarms as the Plugin holds them: local times of day, each with the
 * occurrence it is owed and the System Notification that fires it. One list
 * lives for the Plugin's lifetime, in memory, and every change is written to
 * Plugin storage under one key so a restart finds it. The arithmetic stays in
 * `time.ts`; this module only decides when to call it and what to tell the host.
 *
 * The host allows one Plugin at most 20 pending scheduled System Notifications
 * (`src/features/plugins/system-notifications.ts`), and the Timer and the
 * Pomodoro each keep one, so only the nearest `ALARM_SCHEDULE_CAP` Alarms are
 * scheduled at a time; the rest are scheduled as earlier ones fire.
 *
 * One timeout is held for the nearest occurrence, and a minute-by-minute
 * interval while any Alarm is on, so a changed time zone moves an Alarm's
 * occurrence without the page being open.
 */

import type { PluginClient } from "@/plugin-sdk";
import { translate } from "./i18n";
import { formatClockTime, hourCycleFor, localOffsetAt, nextAlarmAt, type OffsetAt } from "./time";

/**
 * How many Alarms are scheduled at once. The host allows 20 pending scheduled
 * System Notifications per Plugin, and the Timer and the Pomodoro each keep one.
 */
export const ALARM_SCHEDULE_CAP = 18;

/** The Plugin storage key the Alarms are kept under. */
const STORAGE_KEY = "alarms";

/** How often the time zone is checked for a change while any Alarm is on. */
const ZONE_CHECK_MS = 60_000;

const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const DAYS_PER_WEEK = 7;

/** One Alarm: a local time of day, an optional label, and the weekdays it repeats on. */
export interface Alarm {
  id: string;
  hour: number;
  minute: number;
  label: string;
  /** 0=Sunday through 6; none means a one-off Alarm. */
  weekdays: number[];
  enabled: boolean;
  /** The occurrence the Alarm is owed, or null when it is off. */
  nextAt: number | null;
}

/** What the author sets on an Alarm; the id settles on its own and it starts on. */
export interface AlarmInput {
  hour: number;
  minute: number;
  label: string;
  weekdays: number[];
}

/** The System Notification id one Alarm is scheduled under. */
export function alarmNotificationId(id: string): string {
  return `alarm:${id}`;
}

/** An occurrence that came due while Maibuk was closed, reported once at startup. */
export interface MissedAlarm {
  alarm: Alarm;
  at: number;
}

/** The Alarms the page and the Commands share. */
export interface ClockAlarms {
  /**
   * Reads storage once; malformed entries are dropped. Every enabled Alarm
   * whose occurrence passed while Maibuk was closed is advanced and returned as
   * missed, the rest are scheduled again, and the timeout is held.
   */
  load(): Promise<MissedAlarm[]>;
  /** The Alarms in insertion order, as copies. */
  snapshot(): Alarm[];
  /** Listens for every change; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
  /** Adds an Alarm, on, owed its next occurrence. */
  add(input: AlarmInput): Alarm;
  /** Replaces one Alarm's time, label, and weekdays, keeping it as it was on or off. */
  edit(id: string, input: AlarmInput): void;
  /** Turns one Alarm on, owed its next occurrence, or off. */
  setEnabled(id: string, enabled: boolean): void;
  /** Drops one Alarm and its scheduled Alert. */
  remove(id: string): void;
  /** The language the Alerts' titles and bodies are written in. */
  setLanguage(language: string): void;
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

/** A whole clock field, from zero through `max`. */
function isClockField(value: unknown, max: number): value is number {
  return isInteger(value) && value >= 0 && value <= max;
}

/** One stored Alarm, or null when any field is not the shape this module writes. */
function parseAlarm(value: unknown): Alarm | null {
  if (typeof value !== "object" || value === null) return null;
  const alarm = value as Record<string, unknown>;
  const { id, hour, minute, label, weekdays, enabled, nextAt } = alarm;
  if (typeof id !== "string" || id === "") return null;
  if (!isClockField(hour, HOURS_PER_DAY - 1) || !isClockField(minute, MINUTES_PER_HOUR - 1))
    return null;
  if (typeof label !== "string") return null;
  if (!Array.isArray(weekdays) || !weekdays.every((day) => isClockField(day, DAYS_PER_WEEK - 1)))
    return null;
  if (typeof enabled !== "boolean") return null;
  if (nextAt !== null && !(typeof nextAt === "number" && Number.isFinite(nextAt))) return null;
  return { id, hour, minute, label, weekdays: [...weekdays], enabled, nextAt };
}

/** What storage held, dropping every entry that is not an Alarm; a non-list holds none. */
function parseStored(value: unknown): Alarm[] {
  if (!Array.isArray(value)) return [];
  const alarms: Alarm[] = [];
  for (const entry of value) {
    const alarm = parseAlarm(entry);
    if (alarm !== null) alarms.push(alarm);
  }
  return alarms;
}

/** One Alarm as a copy, so a caller can never reach into the list. */
function copy(alarm: Alarm): Alarm {
  return { ...alarm, weekdays: [...alarm.weekdays] };
}

/**
 * The input with a whole hour and minute in range: a number field may commit a
 * fraction, which storage would refuse on the next start and drop the Alarm.
 */
function wholeInput(input: AlarmInput): AlarmInput {
  const whole = (value: number, max: number) =>
    Math.min(max, Math.max(0, Math.trunc(Number.isFinite(value) ? value : 0)));
  return {
    ...input,
    hour: whole(input.hour, HOURS_PER_DAY - 1),
    minute: whole(input.minute, MINUTES_PER_HOUR - 1),
  };
}

/** A random id from `getRandomValues`: the sandboxed Plugin frame has no `randomUUID`. */
function randomAlarmId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Creates the Alarms, holding them in memory and persisting every change. */
export function createAlarms(
  client: PluginClient,
  offsetAt: OffsetAt = localOffsetAt
): ClockAlarms {
  let alarms: Alarm[] = [];
  let language = "en";
  let loaded = false;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let zoneWatch: ReturnType<typeof setInterval> | null = null;
  /** Every Alarm id the host holds an Alert for, with the occurrence it was sent for. */
  const scheduled = new Map<string, number>();
  const listeners = new Set<() => void>();

  async function persist(): Promise<void> {
    try {
      await client.storage.set({ key: STORAGE_KEY, value: alarms });
    } catch {
      // A store that refuses still leaves the Alarms usable in memory.
    }
  }

  function notify(): void {
    for (const listener of [...listeners]) listener();
  }

  function changed(): void {
    void persist();
    notify();
  }

  /**
   * Brings the host's pending Alerts in line with the list: the nearest
   * `ALARM_SCHEDULE_CAP` enabled Alarms are scheduled (only the ones whose
   * occurrence moved are sent again), and every id the host still holds for an
   * Alarm that is now off, gone, edited, or beyond the cap is cancelled.
   */
  function reschedule(): void {
    const due = alarms.filter(
      (alarm): alarm is Alarm & { nextAt: number } => alarm.enabled && alarm.nextAt !== null
    );
    due.sort((a, b) => a.nextAt - b.nextAt);
    const keep = new Set<string>();
    for (const alarm of due.slice(0, ALARM_SCHEDULE_CAP)) {
      keep.add(alarm.id);
      const at = alarm.nextAt;
      if (scheduled.get(alarm.id) === at) continue;
      scheduled.set(alarm.id, at);
      void client.notifications
        .system({
          id: alarmNotificationId(alarm.id),
          title: alarm.label.trim() !== "" ? alarm.label : translate(language, "alarm"),
          body: formatClockTime(at, offsetAt(at), hourCycleFor(language)),
          at,
        })
        .catch(() => {});
    }
    for (const id of [...scheduled.keys()]) {
      if (keep.has(id)) continue;
      scheduled.delete(id);
      void client.notifications.cancel({ id: alarmNotificationId(id) }).catch(() => {});
    }
  }

  function clearTimeoutForFiring(): void {
    if (timeout === null) return;
    clearTimeout(timeout);
    timeout = null;
  }

  /**
   * Advances every enabled Alarm whose occurrence has come due. A one-off Alarm
   * switches itself off; a repeating one moves to the occurrence after the one
   * that fired. The host already raised the Alert, so nothing is shown here.
   * Then the list is stored and the host rescheduled, so a later Alarm beyond
   * the cap takes the place the fired one held. A timeout that fires early (a
   * late clock adjustment left the occurrence ahead) is only held again.
   */
  function fire(): void {
    timeout = null;
    const now = Date.now();
    let fired = false;
    alarms = alarms.map((alarm) => {
      if (!alarm.enabled || alarm.nextAt === null || alarm.nextAt > now) return alarm;
      fired = true;
      if (alarm.weekdays.length === 0) return { ...alarm, enabled: false, nextAt: null };
      // From now, not from the occurrence: a sleep past several rings once.
      return { ...alarm, nextAt: nextAlarmAt(alarm, now, offsetAt) };
    });
    if (!fired) {
      holdFiring();
      return;
    }
    reschedule();
    holdFiring();
    holdZoneWatch();
    changed();
  }

  /** Holds the one timeout that fires the nearest occurrence. */
  function holdFiring(): void {
    clearTimeoutForFiring();
    let soonest: number | null = null;
    for (const alarm of alarms) {
      if (!alarm.enabled || alarm.nextAt === null) continue;
      if (soonest === null || alarm.nextAt < soonest) soonest = alarm.nextAt;
    }
    if (soonest === null) return;
    timeout = setTimeout(fire, Math.max(0, soonest - Date.now()));
  }

  function clearZoneWatch(): void {
    if (zoneWatch === null) return;
    clearInterval(zoneWatch);
    zoneWatch = null;
  }

  /**
   * Holds the interval that notices a changed time zone, while any Alarm is on.
   * An occurrence still ahead is worked out again from now; when one moved, the
   * list is stored, the host rescheduled, and the timeout held again.
   */
  function holdZoneWatch(): void {
    if (!alarms.some((alarm) => alarm.enabled)) {
      clearZoneWatch();
      return;
    }
    if (zoneWatch !== null) return;
    zoneWatch = setInterval(() => {
      const now = Date.now();
      let moved = false;
      alarms = alarms.map((alarm) => {
        // An occurrence that already came due is the firing timeout's business.
        if (!alarm.enabled || alarm.nextAt === null || alarm.nextAt <= now) return alarm;
        const next = nextAlarmAt(alarm, now, offsetAt);
        if (next === alarm.nextAt) return alarm;
        moved = true;
        return { ...alarm, nextAt: next };
      });
      if (!moved) return;
      reschedule();
      holdFiring();
      changed();
    }, ZONE_CHECK_MS);
  }

  return {
    async load() {
      if (loaded) return [];
      loaded = true;
      let stored: unknown;
      try {
        stored = await client.storage.get({ key: STORAGE_KEY });
      } catch {
        return [];
      }
      const now = Date.now();
      // An Alarm added before this read finished is kept after the stored ones.
      const early = new Set(alarms.map((alarm) => alarm.id));
      alarms = [...parseStored(stored).filter((alarm) => !early.has(alarm.id)), ...alarms];
      const missed: MissedAlarm[] = [];
      alarms = alarms.map((alarm) => {
        if (!alarm.enabled || alarm.nextAt === null || alarm.nextAt > now) return alarm;
        missed.push({ alarm: copy(alarm), at: alarm.nextAt });
        if (alarm.weekdays.length === 0) return { ...alarm, enabled: false, nextAt: null };
        return { ...alarm, nextAt: nextAlarmAt(alarm, alarm.nextAt, offsetAt) };
      });
      // The time zone may have changed while Maibuk was closed, so every
      // occurrence still ahead is worked out again from now.
      alarms = alarms.map((alarm) =>
        alarm.enabled ? { ...alarm, nextAt: nextAlarmAt(alarm, now, offsetAt) } : alarm
      );
      // Desktop and the web forget a scheduled Alert when Maibuk closes, so
      // every one still ahead is sent again.
      reschedule();
      holdFiring();
      holdZoneWatch();
      await persist();
      notify();
      return missed;
    },
    snapshot() {
      return alarms.map(copy);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    add(raw) {
      const input = wholeInput(raw);
      const alarm: Alarm = {
        id: randomAlarmId(),
        hour: input.hour,
        minute: input.minute,
        label: input.label,
        weekdays: [...input.weekdays],
        enabled: true,
        nextAt: nextAlarmAt(input, Date.now(), offsetAt),
      };
      alarms = [...alarms, alarm];
      reschedule();
      holdFiring();
      holdZoneWatch();
      changed();
      return copy(alarm);
    },
    edit(id, raw) {
      if (!alarms.some((alarm) => alarm.id === id)) return;
      const input = wholeInput(raw);
      const now = Date.now();
      alarms = alarms.map((alarm) =>
        alarm.id !== id
          ? alarm
          : {
              ...alarm,
              hour: input.hour,
              minute: input.minute,
              label: input.label,
              weekdays: [...input.weekdays],
              nextAt: alarm.enabled ? nextAlarmAt(input, now, offsetAt) : null,
            }
      );
      reschedule();
      holdFiring();
      holdZoneWatch();
      changed();
    },
    setEnabled(id, enabled) {
      const current = alarms.find((alarm) => alarm.id === id);
      if (current === undefined || current.enabled === enabled) return;
      const now = Date.now();
      alarms = alarms.map((alarm) =>
        alarm.id !== id
          ? alarm
          : { ...alarm, enabled, nextAt: enabled ? nextAlarmAt(alarm, now, offsetAt) : null }
      );
      reschedule();
      holdFiring();
      holdZoneWatch();
      changed();
    },
    remove(id) {
      if (!alarms.some((alarm) => alarm.id === id)) return;
      alarms = alarms.filter((alarm) => alarm.id !== id);
      reschedule();
      holdFiring();
      holdZoneWatch();
      changed();
    },
    setLanguage(next) {
      language = next;
    },
  };
}
