// @vitest-environment jsdom
/**
 * The Alarms core on its own: the behavior the page's suite cannot reach with a
 * page mounted. Every Alert is a recorded System Notification, the clock is
 * fixed so an occurrence is a known instant, and the offset is a constant or a
 * variable the test moves, so a changed time zone is provable without a real
 * zone.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestHost } from "@/features/plugins/test-kit";
import { createPluginClient } from "@/plugin-sdk";
import {
  ALARM_SCHEDULE_CAP,
  type Alarm,
  alarmNotificationId,
  createAlarms,
  type MissedAlarm,
} from "./alarms";
import { clockManifest } from "./test-support";
import type { OffsetAt } from "./time";

/** Monday, noon UTC: every Alarm below is set later the same day. */
const START = Date.UTC(2030, 0, 7, 12, 0);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** A fixed zone, read at UTC. */
const UTC: OffsetAt = () => 0;

/** Every host a fake-clock test built, stopped after the test so no page outlives it. */
const openHosts: ReturnType<typeof createTestHost>[] = [];

/** The stored Alarms, or an empty list when none were written. */
function storedAlarms(storage: Map<string, unknown>): Alarm[] {
  const value = storage.get("alarms");
  return Array.isArray(value) ? (value as Alarm[]) : [];
}

/** The tag the host scopes one Alarm's Alert under. */
function tagFor(alarm: Alarm): string {
  return `maibuk-clock/${alarmNotificationId(alarm.id)}`;
}

/**
 * Takes the clock over only after the host ran, so its host is started and
 * stopped on real timers (a fake clock never runs the teardown's task).
 */
function jumpTo(now: number): void {
  vi.useFakeTimers({
    now,
    shouldAdvanceTime: true,
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
}

describe("Clock Alarm core", () => {
  afterEach(async () => {
    // The Plugin's teardown waits on a real task, which a fake clock never runs.
    vi.useRealTimers();
    const pending = openHosts.splice(0);
    for (const host of pending) await host.stop();
  });

  it("schedules an Alarm at its next occurrence, and follows edits, switches, and deletes", async () => {
    const storage = new Map<string, unknown>();
    const host = createTestHost({ manifest: clockManifest(), storage });
    openHosts.push(host);
    jumpTo(START);
    const alarms = createAlarms(createPluginClient(host.port), UTC);
    await alarms.load();
    const changes = vi.fn();
    alarms.subscribe(changes);

    const alarm = alarms.add({ hour: 13, minute: 0, label: "Write", weekdays: [] });
    expect(alarm.id).not.toBe("");
    expect(alarm).toMatchObject({
      hour: 13,
      minute: 0,
      label: "Write",
      weekdays: [],
      enabled: true,
      nextAt: START + HOUR,
    });
    expect(changes).toHaveBeenCalled();
    expect(alarms.snapshot()).toEqual([alarm]);

    const tag = tagFor(alarm);
    await vi.waitFor(() =>
      expect(host.systemNotifications.scheduled.get(tag)).toMatchObject({
        at: START + HOUR,
        title: "Clock: Write",
        body: "13:00",
      })
    );
    await vi.waitFor(() => expect(storedAlarms(storage)).toEqual([alarm]));

    // Monday, 15:00: the same Alarm, rescheduled at the new occurrence.
    alarms.edit(alarm.id, { hour: 15, minute: 0, label: "Write more", weekdays: [1] });
    const edited = alarms.snapshot()[0];
    expect(edited).toMatchObject({
      hour: 15,
      minute: 0,
      label: "Write more",
      weekdays: [1],
      enabled: true,
      nextAt: START + 3 * HOUR,
    });
    await vi.waitFor(() =>
      expect(host.systemNotifications.scheduled.get(tag)).toMatchObject({
        at: START + 3 * HOUR,
        title: "Clock: Write more",
        body: "15:00",
      })
    );
    await vi.waitFor(() => expect(storedAlarms(storage)).toEqual([edited]));

    alarms.setEnabled(alarm.id, false);
    expect(alarms.snapshot()[0]).toMatchObject({ enabled: false, nextAt: null });
    await vi.waitFor(() => expect(host.systemNotifications.scheduled.has(tag)).toBe(false));
    expect(host.systemNotifications.log).toContainEqual({ kind: "cancelled", tag });

    alarms.setEnabled(alarm.id, true);
    await vi.waitFor(() =>
      expect(host.systemNotifications.scheduled.get(tag)?.at).toBe(START + 3 * HOUR)
    );

    alarms.remove(alarm.id);
    expect(alarms.snapshot()).toEqual([]);
    await vi.waitFor(() => expect(host.systemNotifications.scheduled.has(tag)).toBe(false));
    await vi.waitFor(() => expect(storedAlarms(storage)).toEqual([]));
  });

  it("switches a one-off Alarm off when it fires, and moves a repeating one on", async () => {
    const storage = new Map<string, unknown>();
    const host = createTestHost({ manifest: clockManifest(), storage });
    openHosts.push(host);
    jumpTo(START);
    const alarms = createAlarms(createPluginClient(host.port), UTC);
    await alarms.load();

    const oneOff = alarms.add({ hour: 13, minute: 0, label: "One-off", weekdays: [] });
    const repeating = alarms.add({
      hour: 13,
      minute: 0,
      label: "Daily",
      weekdays: [0, 1, 2, 3, 4, 5, 6],
    });
    await vi.waitFor(() => expect(host.systemNotifications.scheduled.size).toBe(2));

    await vi.advanceTimersByTimeAsync(HOUR);

    const nextDay = START + 25 * HOUR;
    await vi.waitFor(() => {
      const snapshot = alarms.snapshot();
      expect(snapshot.find((alarm) => alarm.id === oneOff.id)).toMatchObject({
        enabled: false,
        nextAt: null,
      });
      expect(snapshot.find((alarm) => alarm.id === repeating.id)?.nextAt).toBe(nextDay);
    });
    // The Alert the host already showed is dropped; the next occurrence is scheduled.
    expect(host.systemNotifications.scheduled.has(tagFor(oneOff))).toBe(false);
    await vi.waitFor(() =>
      expect(host.systemNotifications.scheduled.get(tagFor(repeating))?.at).toBe(nextDay)
    );
    await vi.waitFor(() => expect(storedAlarms(storage)).toEqual(alarms.snapshot()));
  });

  it("schedules only the nearest 18 Alarms, and takes the next one as one fires", async () => {
    const storage = new Map<string, unknown>();
    const host = createTestHost({ manifest: clockManifest(), storage });
    openHosts.push(host);
    jumpTo(START);
    const alarms = createAlarms(createPluginClient(host.port), UTC);
    await alarms.load();

    const added: Alarm[] = [];
    // Added farthest first, so only a schedule built from the nearest occurrence
    // picks the 18 the author would expect.
    for (let minute = 24; minute >= 0; minute--) {
      added.push(alarms.add({ hour: 13, minute, label: `Alarm ${minute}`, weekdays: [] }));
    }
    // No limit on how many are kept, and they stay in the order they were added.
    expect(alarms.snapshot().map((alarm) => alarm.id)).toEqual(added.map((alarm) => alarm.id));

    await vi.waitFor(() =>
      expect(host.systemNotifications.scheduled.size).toBe(ALARM_SCHEDULE_CAP)
    );
    for (const [index, alarm] of added.entries()) {
      expect(host.systemNotifications.scheduled.has(tagFor(alarm))).toBe(
        24 - index < ALARM_SCHEDULE_CAP
      );
    }

    // The nearest fires (a one-off, so it is done) and frees its slot.
    await vi.advanceTimersByTimeAsync(HOUR);

    const nineteenth = added[24 - ALARM_SCHEDULE_CAP];
    await vi.waitFor(() =>
      expect(host.systemNotifications.scheduled.get(tagFor(nineteenth))?.at).toBe(
        START + HOUR + ALARM_SCHEDULE_CAP * MINUTE
      )
    );
    expect(host.systemNotifications.scheduled.size).toBe(ALARM_SCHEDULE_CAP);
    expect(host.systemNotifications.scheduled.has(tagFor(added[24]))).toBe(false);
  });

  it("reports an occurrence missed while closed once, and schedules the rest again", async () => {
    const storage = new Map<string, unknown>();
    const passedAt = START - 3 * HOUR;
    const missedAlarm: Alarm = {
      id: "missed",
      hour: 9,
      minute: 0,
      label: "Write",
      weekdays: [],
      enabled: true,
      nextAt: passedAt,
    };
    const repeated: Alarm = {
      id: "repeat",
      hour: 13,
      minute: 30,
      label: "Read",
      weekdays: [1],
      enabled: true,
      nextAt: START + 90 * MINUTE,
    };
    const offAlarm: Alarm = {
      id: "off",
      hour: 7,
      minute: 0,
      label: "",
      weekdays: [2],
      enabled: false,
      nextAt: null,
    };
    storage.set("alarms", [missedAlarm, repeated, offAlarm]);
    const host = createTestHost({ manifest: clockManifest(), storage });
    openHosts.push(host);
    jumpTo(START);
    const alarms = createAlarms(createPluginClient(host.port), UTC);

    const missed: MissedAlarm[] = await alarms.load();
    expect(missed).toEqual([{ alarm: missedAlarm, at: passedAt }]);
    const snapshot = alarms.snapshot();
    expect(snapshot.find((alarm) => alarm.id === "missed")).toEqual({
      ...missedAlarm,
      enabled: false,
      nextAt: null,
    });
    expect(snapshot.find((alarm) => alarm.id === "off")).toEqual(offAlarm);
    expect(snapshot.find((alarm) => alarm.id === "repeat")?.nextAt).toBe(START + 90 * MINUTE);

    await vi.waitFor(() =>
      expect(host.systemNotifications.scheduled.get(tagFor(repeated))?.at).toBe(START + 90 * MINUTE)
    );
    expect(host.systemNotifications.scheduled.has(tagFor(missedAlarm))).toBe(false);
    expect(host.systemNotifications.scheduled.has(tagFor(offAlarm))).toBe(false);
    await vi.waitFor(() => expect(storedAlarms(storage)).toEqual(alarms.snapshot()));

    // A second start reads what the first one stored: nothing is missed twice,
    // and every occurrence still ahead is sent again.
    const nextHost = createTestHost({ manifest: clockManifest(), storage });
    openHosts.push(nextHost);
    const restarted = createAlarms(createPluginClient(nextHost.port), UTC);
    expect(await restarted.load()).toEqual([]);
    await vi.waitFor(() =>
      expect(nextHost.systemNotifications.scheduled.get(tagFor(repeated))?.at).toBe(
        START + 90 * MINUTE
      )
    );
  });

  it("moves every occurrence still ahead when the time zone changes", async () => {
    const storage = new Map<string, unknown>();
    const host = createTestHost({ manifest: clockManifest(), storage });
    openHosts.push(host);
    jumpTo(START);
    let offset = 0;
    const alarms = createAlarms(createPluginClient(host.port), () => offset);
    await alarms.load();

    const alarm = alarms.add({ hour: 13, minute: 0, label: "Write", weekdays: [] });
    expect(alarm.nextAt).toBe(START + HOUR);
    await vi.waitFor(() =>
      expect(host.systemNotifications.scheduled.get(tagFor(alarm))?.at).toBe(START + HOUR)
    );

    // UTC-1: the same 13:00 reads an hour later, so its occurrence moves with it.
    offset = 60;
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(alarms.snapshot()[0]?.nextAt).toBe(START + 2 * HOUR);
    await vi.waitFor(() =>
      expect(host.systemNotifications.scheduled.get(tagFor(alarm))?.at).toBe(START + 2 * HOUR)
    );
    await vi.waitFor(() => expect(storedAlarms(storage)).toEqual(alarms.snapshot()));
  });

  it("keeps a whole hour and minute, so a fractional field cannot drop the Alarm on restart", async () => {
    const storage = new Map<string, unknown>();
    const host = createTestHost({ manifest: clockManifest(), storage });
    openHosts.push(host);
    jumpTo(START);
    const alarms = createAlarms(createPluginClient(host.port), UTC);
    await alarms.load();

    const alarm = alarms.add({ hour: 13.5, minute: 10.7, label: "", weekdays: [] });
    expect(alarm).toMatchObject({ hour: 13, minute: 10, nextAt: START + HOUR + 10 * MINUTE });
    alarms.edit(alarm.id, { hour: 14.9, minute: 0.2, label: "", weekdays: [] });
    expect(alarms.snapshot()[0]).toMatchObject({ hour: 14, minute: 0 });

    await vi.waitFor(() => expect(storedAlarms(storage)).toHaveLength(1));
    const restarted = createAlarms(createPluginClient(host.port), UTC);
    await restarted.load();
    expect(restarted.snapshot()).toHaveLength(1);
  });

  it("rings once after a long sleep, moving a repeating Alarm to its next occurrence from now", async () => {
    const storage = new Map<string, unknown>();
    const host = createTestHost({ manifest: clockManifest(), storage });
    openHosts.push(host);
    jumpTo(START);
    const alarms = createAlarms(createPluginClient(host.port), UTC);
    await alarms.load();
    const daily = alarms.add({ hour: 13, minute: 0, label: "", weekdays: [0, 1, 2, 3, 4, 5, 6] });
    const tag = tagFor(daily);
    await vi.waitFor(() => expect(host.systemNotifications.scheduled.has(tag)).toBe(true));

    // The device sleeps past three occurrences; the held timeout runs late, once.
    const wake = START + 3 * 24 * HOUR + 2 * HOUR;
    const before = host.systemNotifications.log.length;
    vi.setSystemTime(wake);
    await vi.advanceTimersByTimeAsync(2 * HOUR);

    const next = START + 4 * 24 * HOUR + HOUR;
    await vi.waitFor(() => expect(alarms.snapshot()[0]?.nextAt).toBe(next));
    await vi.waitFor(() => expect(host.systemNotifications.scheduled.get(tag)?.at).toBe(next));
    // One Alert sent for the next occurrence, none for the ones slept through.
    const sentSince = host.systemNotifications.log
      .slice(before)
      .filter((entry) => entry.kind !== "cancelled");
    expect(sentSince).toHaveLength(1);
  });

  it("keeps the stored Alarms when one is added before startup finished reading them", async () => {
    const storage = new Map<string, unknown>();
    const host = createTestHost({ manifest: clockManifest(), storage });
    openHosts.push(host);
    jumpTo(START);
    const first = createAlarms(createPluginClient(host.port), UTC);
    await first.load();
    first.add({ hour: 13, minute: 0, label: "Stored", weekdays: [] });
    await vi.waitFor(() => expect(storedAlarms(storage)).toHaveLength(1));

    const restarted = createAlarms(createPluginClient(host.port), UTC);
    const loading = restarted.load();
    restarted.add({ hour: 14, minute: 0, label: "Early", weekdays: [] });
    await loading;

    expect(restarted.snapshot().map((alarm) => alarm.label)).toEqual(["Stored", "Early"]);
    await vi.waitFor(() =>
      expect(storedAlarms(storage).map((alarm) => alarm.label)).toEqual(["Stored", "Early"])
    );
  });

  it("re-sends every scheduled Alert in the new hour cycle, once", async () => {
    const storage = new Map<string, unknown>();
    const host = createTestHost({ manifest: clockManifest(), storage });
    openHosts.push(host);
    jumpTo(START);
    const client = createPluginClient(host.port);
    const system = vi.spyOn(client.notifications, "system");
    const alarms = createAlarms(client, UTC);
    await alarms.load();

    const alarm = alarms.add({ hour: 7, minute: 30, label: "", weekdays: [] });
    const tag = tagFor(alarm);
    await vi.waitFor(() => expect(host.systemNotifications.scheduled.get(tag)?.body).toBe("07:30"));

    // The same occurrence is sent again under the same id, now written in 12-hour form.
    const callsBefore = system.mock.calls.length;
    alarms.setHourCycle(12);
    await vi.waitFor(() =>
      expect(host.systemNotifications.scheduled.get(tag)?.body).toBe("7:30 AM")
    );
    expect(system.mock.calls.length).toBe(callsBefore + 1);

    // Setting the hour cycle already in use is not a change: nothing is sent again.
    const callsAfter = system.mock.calls.length;
    alarms.setHourCycle(12);
    expect(system.mock.calls.length).toBe(callsAfter);
  });
});
