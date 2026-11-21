// @vitest-environment jsdom
/**
 * Clock's Frame wire protocol (#886), the Worker half, over a real
 * MessageChannel the way a mounted Clock Frame will speak it. The test builds
 * the real Timer, Pomodoro, Stopwatch, and Alarms over the Plugin test kit's
 * host, connects them to the Frame's port, and asserts the labels and state the
 * Worker sends and the effect of every intent the Frame can send. A malformed
 * intent must change nothing, and `closed` must silence the port.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestHost } from "@/features/plugins/test-kit";
import { createPluginClient } from "@/plugin-sdk";
import { createAlarms } from "./alarms";
import { DEFAULT_POMODORO_SETTINGS } from "./cycle";
import {
  connectClockFrame,
  type FrameLabelsMessage,
  type FrameStateMessage,
  type WorkerToFrameMessage,
} from "./frame-protocol";
import en from "./locales/runtime/en.json";
import es from "./locales/runtime/es.json";
import { createPomodoro } from "./pomodoro";
import { createStopwatch } from "./stopwatch";
import { clockManifest } from "./test-support";
import { MAX_TIMER_LENGTH_MS } from "./time";
import { createTimer } from "./timer";

/** The default Timer an empty storage leaves in place. */
const DEFAULT_TIMER = { state: { status: "idle", length: 1_500_000 }, recent: [] };

/** Every harness a test built, torn down after the test so no port outlives it. */
const openHarnesses: Harness[] = [];

interface Harness {
  host: ReturnType<typeof createTestHost>;
  timer: ReturnType<typeof createTimer>;
  pomodoro: ReturnType<typeof createPomodoro>;
  stopwatch: ReturnType<typeof createStopwatch>;
  alarms: ReturnType<typeof createAlarms>;
  /** Every message the Frame end received, in order. */
  messages: WorkerToFrameMessage[];
  /** True once the Worker closed the Frame end. */
  readonly closed: boolean;
  /** Sends one Frame -> Worker message. */
  send(message: unknown): void;
  dispose(): void;
  close(): void;
}

/**
 * The Frame's end of one real MessageChannel, with the Worker's `close`
 * recorded. Everything else delegates to the channel, so messages cross it
 * exactly as they will from `assets/ui/clock.js`.
 */
function framePort(port: MessagePort, onClose: () => void): MessagePort {
  return {
    get onmessage() {
      return port.onmessage;
    },
    set onmessage(handler: MessagePort["onmessage"]) {
      port.onmessage = handler;
    },
    start: () => port.start(),
    postMessage: (message: unknown) => port.postMessage(message),
    close: () => {
      onClose();
      port.close();
    },
  } as unknown as MessagePort;
}

/** The real modules, one Frame port, and the messages the Frame end received. */
function setup(
  options: { language?: string; permission?: "granted" | "denied" | "default" } = {}
): Harness {
  const host = createTestHost({
    manifest: clockManifest(),
    ...(options.language === undefined ? {} : { language: options.language }),
  });
  if (options.permission !== undefined) host.systemNotifications.setPermission(options.permission);
  const client = createPluginClient(host.port);
  const timer = createTimer(client);
  const pomodoro = createPomodoro(client);
  const stopwatch = createStopwatch(client);
  const alarms = createAlarms(client);
  const channel = new MessageChannel();
  const messages: WorkerToFrameMessage[] = [];
  channel.port2.onmessage = (event: MessageEvent) => {
    messages.push(event.data as WorkerToFrameMessage);
  };
  let closed = false;
  const dispose = connectClockFrame(
    framePort(channel.port1, () => {
      closed = true;
    }),
    { client, timer, pomodoro, stopwatch, alarms }
  );
  const harness: Harness = {
    host,
    timer,
    pomodoro,
    stopwatch,
    alarms,
    messages,
    get closed() {
      return closed;
    },
    send(message: unknown) {
      channel.port2.postMessage(message);
    },
    dispose,
    close() {
      channel.port2.close();
    },
  };
  openHarnesses.push(harness);
  return harness;
}

/** The states the Frame end received so far. */
function states(harness: Harness): FrameStateMessage[] {
  return harness.messages.filter(
    (message): message is FrameStateMessage => message.kind === "state"
  );
}

/** Waits until the Frame end received a message of `kind`, and returns the latest one. */
async function latest(
  harness: Harness,
  kind: WorkerToFrameMessage["kind"]
): Promise<WorkerToFrameMessage> {
  await vi.waitFor(() => {
    expect(harness.messages.some((message) => message.kind === kind)).toBe(true);
  });
  const matching = harness.messages.filter((message) => message.kind === kind);
  return matching[matching.length - 1];
}

/** Waits until the Worker sent the labels and a state carrying the notification status. */
async function connected(harness: Harness): Promise<void> {
  await latest(harness, "labels");
  await vi.waitFor(() => {
    const received = states(harness);
    expect(received.length).toBeGreaterThan(0);
    expect(received[received.length - 1].notifications).not.toBeNull();
  });
}

/** Sends one intent and waits for the state the Worker answers it with. */
async function apply(harness: Harness, message: unknown): Promise<FrameStateMessage> {
  const before = states(harness).length;
  harness.send(message);
  await vi.waitFor(() => expect(states(harness).length).toBeGreaterThan(before));
  const received = states(harness);
  return received[received.length - 1];
}

afterEach(async () => {
  for (const harness of openHarnesses.splice(0)) {
    harness.dispose();
    harness.close();
    await harness.host.stop();
  }
});

describe("connectClockFrame", () => {
  it("sends the labels and the whole state on connect", async () => {
    const harness = setup();
    const labels = (await latest(harness, "labels")) as FrameLabelsMessage;
    expect(labels.language).toBe("en");
    expect(labels.hourCycle).toBe(12);
    expect(labels.labels.timer).toBe(en.timer);
    expect(labels.labels.timeLeft).toBe(en.timeLeft);

    const state = (await latest(harness, "state")) as FrameStateMessage;
    expect(state.timer).toEqual(DEFAULT_TIMER);
    expect(state.pomodoro).toEqual({
      state: { phase: "pomodoro", pomodoro: 1, status: "idle" },
      settings: DEFAULT_POMODORO_SETTINGS,
      today: { day: 0, count: 0 },
    });
    expect(state.stopwatch).toEqual({ status: "idle" });
    expect(state.alarms).toEqual([]);

    await connected(harness);
    const received = states(harness);
    expect(received[received.length - 1].notifications).toEqual({
      permission: "granted",
      canScheduleWhileClosed: false,
      exactTiming: true,
    });
  });

  it("sends a fresh state whenever a module changes", async () => {
    const harness = setup();
    await connected(harness);
    const before = states(harness).length;
    harness.timer.start();
    await vi.waitFor(() => expect(states(harness).length).toBe(before + 1));
    expect(states(harness)[before].timer.state.status).toBe("running");
  });

  it("runs the Timer's intents", async () => {
    const harness = setup();
    await connected(harness);

    const set = await apply(harness, { kind: "timer.setLength", length: 600_000 });
    expect(set.timer.state).toEqual({ status: "idle", length: 600_000 });

    expect((await apply(harness, { kind: "timer.start" })).timer.state.status).toBe("running");
    expect((await apply(harness, { kind: "timer.pause" })).timer.state.status).toBe("paused");
    expect((await apply(harness, { kind: "timer.reset" })).timer.state).toEqual({
      status: "idle",
      length: 600_000,
    });
  });

  it("takes the longest length the Duration input can express", async () => {
    const harness = setup();
    await connected(harness);

    const set = await apply(harness, { kind: "timer.setLength", length: MAX_TIMER_LENGTH_MS });
    expect(set.timer.state).toEqual({ status: "idle", length: MAX_TIMER_LENGTH_MS });
  });

  it("runs the Pomodoro's intents", async () => {
    const harness = setup();
    await connected(harness);

    expect((await apply(harness, { kind: "pomodoro.start" })).pomodoro.state.status).toBe(
      "running"
    );
    expect((await apply(harness, { kind: "pomodoro.pause" })).pomodoro.state.status).toBe("paused");
    expect((await apply(harness, { kind: "pomodoro.skip" })).pomodoro.state).toEqual({
      phase: "shortBreak",
      pomodoro: 1,
      status: "idle",
    });
    expect((await apply(harness, { kind: "pomodoro.reset" })).pomodoro.state).toEqual({
      phase: "pomodoro",
      pomodoro: 1,
      status: "idle",
    });
  });

  it("runs the Stopwatch's intents", async () => {
    const harness = setup();
    await connected(harness);

    expect((await apply(harness, { kind: "stopwatch.start" })).stopwatch.status).toBe("running");
    const lapped = await apply(harness, { kind: "stopwatch.lap" });
    expect(lapped.stopwatch).toMatchObject({
      status: "running",
      laps: [{ length: expect.any(Number), total: expect.any(Number) }],
    });
    expect((await apply(harness, { kind: "stopwatch.pause" })).stopwatch.status).toBe("paused");
    expect((await apply(harness, { kind: "stopwatch.reset" })).stopwatch).toEqual({
      status: "idle",
    });
  });

  it("runs the Alarms' intents, deduping and sorting the weekdays it takes", async () => {
    const harness = setup();
    await connected(harness);

    const added = await apply(harness, {
      kind: "alarm.add",
      input: { hour: 9, minute: 30, label: "Tea", weekdays: [3, 1, 3] },
    });
    expect(added.alarms).toHaveLength(1);
    expect(added.alarms[0]).toMatchObject({
      hour: 9,
      minute: 30,
      label: "Tea",
      weekdays: [1, 3],
      enabled: true,
    });
    const id = added.alarms[0].id;

    const edited = await apply(harness, {
      kind: "alarm.edit",
      id,
      input: { hour: 10, minute: 15, label: "Coffee", weekdays: [] },
    });
    expect(edited.alarms[0]).toMatchObject({ hour: 10, minute: 15, label: "Coffee", weekdays: [] });

    const off = await apply(harness, { kind: "alarm.setEnabled", id, enabled: false });
    expect(off.alarms[0]).toMatchObject({ id, enabled: false, nextAt: null });

    const removed = await apply(harness, { kind: "alarm.remove", id });
    expect(removed.alarms).toEqual([]);
  });

  it("asks for the notification permission again on notifications.allow", async () => {
    const harness = setup({ permission: "denied" });
    await connected(harness);
    const before = states(harness);
    expect(before[before.length - 1].notifications?.permission).toBe("denied");

    const answered = await apply(harness, { kind: "notifications.allow" });
    expect(answered.notifications?.permission).toBe("granted");
  });

  it("drops every malformed intent without changing anything", async () => {
    const harness = setup();
    await connected(harness);
    const added = await apply(harness, {
      kind: "alarm.add",
      input: { hour: 7, minute: 0, label: "Wake", weekdays: [] },
    });
    const id = added.alarms[0].id;
    const before = states(harness).length;

    harness.send({ kind: "timer.setLength", length: -1 });
    harness.send({ kind: "timer.setLength", length: "ten" });
    harness.send({ kind: "timer.setLength", length: Number.POSITIVE_INFINITY });
    harness.send({ kind: "timer.setLength", length: 1e12 });
    harness.send({ kind: "timer.setLength", length: MAX_TIMER_LENGTH_MS + 1_000 });
    harness.send({ kind: "alarm.add", input: { hour: 24, minute: 0, label: "", weekdays: [] } });
    harness.send({ kind: "alarm.add", input: { hour: 12, minute: 60, label: "", weekdays: [] } });
    harness.send({ kind: "alarm.add", input: { hour: 12, minute: 0, label: "", weekdays: [7] } });
    harness.send({ kind: "alarm.add", input: { hour: 12, minute: 0, label: 1, weekdays: [] } });
    harness.send({ kind: "alarm.edit", id, input: { hour: 12, minute: 0, label: "x" } });
    harness.send({ kind: "alarm.setEnabled", id, enabled: "yes" });
    harness.send({ kind: "alarm.remove", id: 7 });
    harness.send({ kind: "closed.soon" });
    harness.send("not a message");

    // The Stopwatch's start travels behind them on the same port, so its state
    // arrives only after every malformed one was handled: one new state means
    // none of them was.
    const state = await apply(harness, { kind: "stopwatch.start" });
    expect(states(harness).length - before).toBe(1);
    expect(state.timer).toEqual(DEFAULT_TIMER);
    expect(state.alarms).toHaveLength(1);
    expect(state.alarms[0]).toMatchObject({ id, enabled: true, label: "Wake" });
    expect(state.stopwatch.status).toBe("running");
  });

  it("re-sends the labels in the new language when it changes", async () => {
    const harness = setup();
    await connected(harness);
    const first = (await latest(harness, "labels")) as FrameLabelsMessage;
    expect(first.language).toBe("en");

    harness.host.setLanguage("es");
    await vi.waitFor(() => {
      const labels = harness.messages.filter(
        (message): message is FrameLabelsMessage => message.kind === "labels"
      );
      expect(labels[labels.length - 1].language).toBe("es");
    });
    const labels = (await latest(harness, "labels")) as FrameLabelsMessage;
    expect(labels.hourCycle).toBe(24);
    expect(labels.labels.timer).toBe(es.timer);
    expect(labels.labels.timeLeft).toBe(es.timeLeft);
  });

  it("stops sending state once the Frame says closed", async () => {
    const harness = setup();
    await connected(harness);
    const before = states(harness).length;
    harness.send({ kind: "closed" });
    await vi.waitFor(() => expect(harness.closed).toBe(true));

    // Everything was unsubscribed before the port closed, so a module change
    // reaches no Frame.
    harness.timer.start();
    expect(states(harness).length).toBe(before);
  });
});
