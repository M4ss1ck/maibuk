/**
 * The Clock runtime: the Clock Frame's Worker half and the Command handlers it
 * answers. Kept apart from `index.tsx` (the Worker bootstrap) so a test can
 * drive the same logic over the polyfill-free Remote UI entry the test kit uses
 * (`@/plugin-sdk/ui-serve`), without loading the Worker's Remote DOM polyfill
 * into jsdom. Imports only `@/plugin-sdk` (and its subpaths) and its own files.
 *
 * The Clock page is a Frame (`assets/ui/clock.html`, #886): the host draws it
 * and the Frame owns its markup, keyboard, and every derived display, while
 * this runtime owns the Timer, the Cycle, the Stopwatch, and the Alarms.
 * `connectClockFrame` wires each mounted Frame to those four, so a Command run
 * and a mounted Frame act on the same ones.
 */

import { useEffect, useState, type ComponentType } from "react";
import {
  PLUGIN_COMMAND_RUN_REQUEST,
  ui,
  type HostRequestHandler,
  type PluginClient,
} from "@/plugin-sdk";
import { translate, type ClockKey } from "./i18n";
import { createAlarms } from "./alarms";
import { POMODORO_LIMITS } from "./cycle";
import { createPomodoro, type ClockPomodoro } from "./pomodoro";
import { createStopwatch, type ClockStopwatch } from "./stopwatch";
import { formatClockTime, hourCycleFor } from "./time";
import { createTimer, type ClockTimer } from "./timer";
import { connectClockFrame, createSettingsRequest, type SettingsRequest } from "./frame-protocol";

/** The Clock page id, exactly as the manifest declares it. */
export const CLOCK_PAGE_ID = "clock";

/** The Pomodoro Settings row id, exactly as the manifest declares it. */
export const POMODORO_SETTINGS_ROW_ID = "pomodoro";

/** The Command-local ids the manifest declares. */
export const OPEN_CLOCK = "openClock";
export const TOGGLE_TIMER = "toggleTimer";
export const TOGGLE_POMODORO = "togglePomodoro";
export const SKIP_POMODORO = "skipPomodoro";
export const OPEN_POMODORO_SETTINGS = "openPomodoroSettings";
export const TOGGLE_STOPWATCH = "toggleStopwatch";
export const LAP_STOPWATCH = "lapStopwatch";

/**
 * The host's Remote UI and request entry (`servePluginUi`), Worker or test. The
 * two SDK entries share this shape, so the runtime takes whichever the caller
 * supplies.
 */
export type ClockServe = (
  client: Pick<PluginClient, "onHostRequest">,
  options: {
    pages: Record<string, ComponentType>;
    settingsRows?: Record<string, ComponentType>;
    onHostRequest?: HostRequestHandler;
  }
) => void;

/**
 * The sentence telling the author a phase ended while Maibuk was closed, written
 * the way the Alert's own body names the time.
 */
function missedSentence(language: string, key: ClockKey, endedAt: number): string {
  const time = formatClockTime(
    endedAt,
    new Date(endedAt).getTimezoneOffset(),
    hourCycleFor(language)
  );
  return translate(language, key).replace("{time}", time);
}

/**
 * Tells the author, once, that a Timer or a Pomodoro ended while Maibuk was
 * closed. Only a device that granted the permission and fires a scheduled Alert
 * while closed (Android) already told them; one that was refused never posted
 * it, and one that cannot answer or show an Alert leaves them without a toast.
 */
async function reportMissed(client: PluginClient, sentences: readonly string[]): Promise<void> {
  const status = await client.notifications.systemStatus();
  if (status.permission === "granted" && status.canScheduleWhileClosed) return;
  await client.notifications.show({ variant: "info", message: sentences.join(" ") });
}

/**
 * Wires the client to the Clock Frame and the Command handlers. The Timer, the
 * Pomodoro, the Stopwatch, and the Alarms are created here and live for the
 * Plugin's lifetime, so a Command run and a mounted Frame act on the same ones.
 */
export function startClock(client: PluginClient, serve: ClockServe): Promise<void> {
  const timer = createTimer(client);
  const pomodoro = createPomodoro(client);
  const stopwatch = createStopwatch(client);
  const alarms = createAlarms(client);
  // One request for the Plugin's lifetime: a Command run while no Frame is
  // mounted leaves it pending until the next Frame has received its labels.
  const settingsRequest = createSettingsRequest();
  // The Toggle Button shows whether a phase runs: every change to the Cycle is
  // mirrored onto it, only when the pressed value moves, and never loudly.
  let buttonPressed: boolean | null = null;
  const showPressed = (): void => {
    const pressed = pomodoro.snapshot().state.status === "running";
    if (pressed === buttonPressed) return;
    buttonPressed = pressed;
    void client.toolbar.setPressed({ button: TOGGLE_POMODORO, pressed }).catch(() => {});
  };
  pomodoro.subscribe(showPressed);
  // The Alerts and the missed-end toast read the app language, so it is read
  // before load reconciles a Timer or Pomodoro that ended while Maibuk was
  // closed; "en" stays the fallback. The returned promise settles once that
  // startup reconciliation, and its one toast, is done.
  const started = (async () => {
    let language = "en";
    try {
      language = (await client.language.get()).language;
    } catch {
      // Keep the language the Timer and the Pomodoro already have.
    }
    timer.setLanguage(language);
    pomodoro.setLanguage(language);
    alarms.setLanguage(language);
    const missed: string[] = [];
    const timerEndedAt = await timer.load();
    if (timerEndedAt !== null) {
      missed.push(missedSentence(language, "timerEndedWhileClosed", timerEndedAt));
    }
    const pomodoroEnd = await pomodoro.load();
    // The Cycle a restart found may already run, so the button is set from what
    // load settled on, once.
    showPressed();
    if (pomodoroEnd !== null) {
      const key: ClockKey =
        pomodoroEnd.phase === "pomodoro" ? "pomodoroEndedWhileClosed" : "breakEndedWhileClosed";
      missed.push(missedSentence(language, key, pomodoroEnd.endedAt));
    }
    // A Stopwatch never ends on its own, so load reports no missed end.
    await stopwatch.load();
    // An Alarm missed while Maibuk was closed joins the one toast, in the same
    // 12/24-hour form its own Alert names the time; load has turned a one-off
    // Alarm off and moved a repeating one on.
    const missedAlarms = await alarms.load();
    for (const missedAlarm of missedAlarms) {
      missed.push(missedSentence(language, "alarmMissed", missedAlarm.at));
    }
    if (missed.length === 0) return;
    try {
      await reportMissed(client, missed);
    } catch {
      // A device that cannot say or show it leaves the author without a toast.
    }
  })();
  // The Alerts' words follow the app language. Subscribed once here, not per
  // page, so switching tabs never re-subscribes.
  void client
    .on("language.changed", (payload) => {
      timer.setLanguage(payload.language);
      pomodoro.setLanguage(payload.language);
      alarms.setLanguage(payload.language);
    })
    .catch(() => {});
  // Every mounted Clock Frame speaks to the same four modules over its own
  // port; the Frame tells the Worker when it closes, and `connectClockFrame`
  // then drops that Frame's subscriptions and closes the port. The host closes
  // the port before that message arrives, so the previous connection is
  // disposed here too; only one whole-page Clock Frame is mounted at a time,
  // so there is never more than one to keep.
  let disposeFrame: (() => void) | null = null;
  client.onFrame((frame) => {
    disposeFrame?.();
    disposeFrame = connectClockFrame(frame.port, {
      client,
      timer,
      pomodoro,
      stopwatch,
      alarms,
      settingsRequest,
    });
  });
  serve(client, {
    pages: {},
    settingsRows: { [POMODORO_SETTINGS_ROW_ID]: createPomodoroSettings(client, pomodoro) },
    onHostRequest: (method, params) =>
      handleHostRequest(client, timer, pomodoro, stopwatch, settingsRequest, method, params),
  });
  return started;
}

/** Answers the host's health check and runs the Plugin's Commands. */
function handleHostRequest(
  client: PluginClient,
  timer: ClockTimer,
  pomodoro: ClockPomodoro,
  stopwatch: ClockStopwatch,
  settingsRequest: SettingsRequest,
  method: string,
  params: unknown
): unknown {
  if (method === "health.check") return "pong";
  if (method === PLUGIN_COMMAND_RUN_REQUEST)
    return runClockCommand(client, timer, pomodoro, stopwatch, settingsRequest, params);
  throw new Error(`No handler for ${method}`);
}

/**
 * Answers one Command run. `Open Clock` is the page's navigating Command, so the
 * host normally navigates without a `command.run`; answering it here keeps the
 * page reachable the other way. `Start or pause the Timer` toggles the one
 * Timer the Plugin holds, `Start or pause the Pomodoro` toggles the Cycle,
 * `Skip to the next Pomodoro or break` moves it on, `Pomodoro settings` opens
 * the Clock page and asks its Frame to show the settings dialog, `Start or pause
 * the Stopwatch` toggles the Stopwatch, and `Mark a Lap` marks one while it runs.
 */
async function runClockCommand(
  client: PluginClient,
  timer: ClockTimer,
  pomodoro: ClockPomodoro,
  stopwatch: ClockStopwatch,
  settingsRequest: SettingsRequest,
  params: unknown
): Promise<null> {
  const { id } = (params ?? {}) as { id?: unknown };
  if (id === OPEN_CLOCK) await client.navigation.openPage({ pageId: CLOCK_PAGE_ID });
  if (id === OPEN_POMODORO_SETTINGS) {
    settingsRequest.request();
    await client.navigation.openPage({ pageId: CLOCK_PAGE_ID });
  }
  if (id === TOGGLE_TIMER) timer.toggle();
  if (id === TOGGLE_POMODORO) pomodoro.toggle();
  if (id === SKIP_POMODORO) pomodoro.skip();
  if (id === TOGGLE_STOPWATCH) stopwatch.toggle();
  if (id === LAP_STOPWATCH) stopwatch.lap();
  return null;
}

/** The app language as the SDK signals it: the current value at mount, then every change. */
function useLanguage(client: PluginClient): string {
  const [language, setLanguage] = useState("en");
  useEffect(() => {
    let active = true;
    const apply = (next: string) => {
      if (active) setLanguage(next);
    };
    void client.language
      .get()
      .then((value) => apply(value.language))
      .catch(() => {});
    let unsubscribe: (() => Promise<void>) | null = null;
    void client
      .on("language.changed", (payload) => apply(payload.language))
      .then((off) => {
        unsubscribe = off;
      })
      .catch(() => {});
    return () => {
      active = false;
      if (unsubscribe !== null) void unsubscribe();
    };
  }, [client]);
  return language;
}

/** A whole number of minutes, at least one, from a number field's value. */
function wholeMinutes(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.round(value)) : 1;
}

/**
 * The `pomodoro` Settings row's body: the three lengths, the count before a Long
 * Break, and the two auto-start switches. Each change is written straight to
 * the Cycle, which persists it under its one key, so the row survives a reload.
 * The number fields take their bounds from `POMODORO_LIMITS`, so the row cannot
 * store what the Clock page's dialog refuses. Labels come from the runtime
 * catalogs.
 */
function createPomodoroSettings(client: PluginClient, pomodoro: ClockPomodoro): ComponentType {
  const { minutes, longBreakEvery } = POMODORO_LIMITS;

  function PomodoroSettings() {
    const language = useLanguage(client);
    const [settings, setSettings] = useState(() => pomodoro.snapshot().settings);

    useEffect(() => {
      const sync = () => setSettings(pomodoro.snapshot().settings);
      sync();
      return pomodoro.subscribe(sync);
    }, [pomodoro]);

    return (
      <ui.View direction="column" gap="md">
        <ui.NumberField
          label={translate(language, "pomodoroMinutes")}
          value={settings.pomodoroMinutes}
          minValue={minutes.min}
          maxValue={minutes.max}
          step={1}
          onChange={(event) =>
            pomodoro.setSettings({ pomodoroMinutes: wholeMinutes(event.detail) })
          }
        />
        <ui.NumberField
          label={translate(language, "shortBreakMinutes")}
          value={settings.shortBreakMinutes}
          minValue={minutes.min}
          maxValue={minutes.max}
          step={1}
          onChange={(event) =>
            pomodoro.setSettings({ shortBreakMinutes: wholeMinutes(event.detail) })
          }
        />
        <ui.NumberField
          label={translate(language, "longBreakMinutes")}
          value={settings.longBreakMinutes}
          minValue={minutes.min}
          maxValue={minutes.max}
          step={1}
          onChange={(event) =>
            pomodoro.setSettings({ longBreakMinutes: wholeMinutes(event.detail) })
          }
        />
        <ui.NumberField
          label={translate(language, "longBreakEvery")}
          value={settings.longBreakEvery}
          minValue={longBreakEvery.min}
          maxValue={longBreakEvery.max}
          step={1}
          onChange={(event) => pomodoro.setSettings({ longBreakEvery: wholeMinutes(event.detail) })}
        />
        <ui.Switch
          label={translate(language, "autoStartBreaks")}
          isSelected={settings.autoStartBreaks}
          onChange={(event) => pomodoro.setSettings({ autoStartBreaks: event.detail })}
        />
        <ui.Switch
          label={translate(language, "autoStartPomodoros")}
          isSelected={settings.autoStartPomodoros}
          onChange={(event) => pomodoro.setSettings({ autoStartPomodoros: event.detail })}
        />
      </ui.View>
    );
  }
  return PomodoroSettings;
}
