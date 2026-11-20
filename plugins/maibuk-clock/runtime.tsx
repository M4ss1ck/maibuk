/**
 * The Clock runtime: the Clock page and the Command handlers it answers. Kept
 * apart from `index.tsx` (the Worker bootstrap) so a test can drive the same
 * logic over the polyfill-free Remote UI entry the test kit uses
 * (`@/plugin-sdk/ui-serve`), without loading the Worker's Remote DOM polyfill
 * into jsdom. Imports only `@/plugin-sdk` (and its subpaths) and its own files.
 *
 * The page draws the four tabs its glossary names. The Timer tab holds the
 * live Timer; every other tab's panel is empty until its own ticket fills it,
 * so each one says it is coming soon. The Timer tab is selected first, and the
 * selected tab is page-local state. The page owns the Timer's subscription and
 * its once-a-second redraw, so its polite live region speaks from below the
 * tabs on every tab, not only the Timer's.
 */

import { useEffect, useState, type ComponentType } from "react";
import {
  PLUGIN_COMMAND_RUN_REQUEST,
  ui,
  type HostRequestHandler,
  type PluginClient,
} from "@/plugin-sdk";
import { translate, type ClockKey } from "./i18n";
import { createPomodoro, type ClockPomodoro, type PomodoroSnapshot } from "./pomodoro";
import { remainingCycleMs, todayCount } from "./cycle";
import {
  formatClockTime,
  formatDuration,
  hourCycleFor,
  joinDuration,
  MS_PER_MINUTE,
  remainingMs,
  splitDuration,
  type TimerState,
} from "./time";
import { createTimer, type ClockTimer } from "./timer";

/** The Clock page id, exactly as the manifest declares it. */
export const CLOCK_PAGE_ID = "clock";

/** The Pomodoro Settings row id, exactly as the manifest declares it. */
export const POMODORO_SETTINGS_ROW_ID = "pomodoro";

/** The Command-local ids the manifest declares. */
export const OPEN_CLOCK = "openClock";
export const TOGGLE_TIMER = "toggleTimer";
export const TOGGLE_POMODORO = "togglePomodoro";
export const SKIP_POMODORO = "skipPomodoro";

/** The tabs the page draws, in the glossary's order. */
const TABS = ["pomodoro", "timer", "stopwatch", "alarms"] as const;

/** One tab's key, which is also its runtime catalog key. */
type ClockTab = (typeof TABS)[number];

/** The tab selected when the page opens. */
const DEFAULT_TAB: ClockTab = "timer";

/** What the OS answered about System Notifications, as the banner reads it. */
type NotificationStatus = Awaited<ReturnType<PluginClient["notifications"]["systemStatus"]>>;

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
 * Wires the client to the Clock page and the Command handlers. The Timer and the
 * Pomodoro are created here and live for the Plugin's lifetime, so a Command run
 * and a page mount act on the same ones.
 */
export function startClock(client: PluginClient, serve: ClockServe): Promise<void> {
  const timer = createTimer(client);
  const pomodoro = createPomodoro(client);
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
    })
    .catch(() => {});
  serve(client, {
    pages: { [CLOCK_PAGE_ID]: createClockPage(client, timer, pomodoro) },
    settingsRows: { [POMODORO_SETTINGS_ROW_ID]: createPomodoroSettings(client, pomodoro) },
    onHostRequest: (method, params) => handleHostRequest(client, timer, pomodoro, method, params),
  });
  return started;
}

/** Answers the host's health check and runs the Plugin's Commands. */
function handleHostRequest(
  client: PluginClient,
  timer: ClockTimer,
  pomodoro: ClockPomodoro,
  method: string,
  params: unknown
): unknown {
  if (method === "health.check") return "pong";
  if (method === PLUGIN_COMMAND_RUN_REQUEST)
    return runClockCommand(client, timer, pomodoro, params);
  throw new Error(`No handler for ${method}`);
}

/**
 * Answers one Command run. `Open Clock` is the page's navigating Command, so the
 * host normally navigates without a `command.run`; answering it here keeps the
 * page reachable the other way. `Start or pause the Timer` toggles the one
 * Timer the Plugin holds, `Start or pause the Pomodoro` toggles the Cycle, and
 * `Skip to the next Pomodoro or break` moves it on.
 */
async function runClockCommand(
  client: PluginClient,
  timer: ClockTimer,
  pomodoro: ClockPomodoro,
  params: unknown
): Promise<null> {
  const { id } = (params ?? {}) as { id?: unknown };
  if (id === OPEN_CLOCK) await client.navigation.openPage({ pageId: CLOCK_PAGE_ID });
  if (id === TOGGLE_TIMER) timer.toggle();
  if (id === TOGGLE_POMODORO) pomodoro.toggle();
  if (id === SKIP_POMODORO) pomodoro.skip();
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

/** Reads a tab selection back, keeping the current tab when the host sends an unknown key. */
function asTab(value: string): ClockTab {
  return (TABS as readonly string[]).includes(value) ? (value as ClockTab) : DEFAULT_TAB;
}

/**
 * What the polite live region says. It names the whole minute left, so it
 * changes on the minute rather than every second, and names the end once.
 */
function liveRegionText(state: TimerState, now: number, language: string): string {
  if (state.status === "ended") return translate(language, "timerEndedAnnounce");
  if (state.status === "idle") return "";
  const minutes = Math.ceil(remainingMs(state, now) / MS_PER_MINUTE);
  if (minutes <= 1) return translate(language, "oneMinuteLeft");
  return translate(language, "minutesLeft").replace("{n}", String(minutes));
}

interface TimerPanelProps {
  client: PluginClient;
  timer: ClockTimer;
  language: string;
  state: TimerState;
  now: number;
  recent: readonly number[];
}

/**
 * The Timer tab. It draws the remaining time the page hands it, the length
 * fields and the recent quick picks when the Timer is idle or ended, the
 * control its status calls for, and the notification banner. The page owns the
 * Timer's subscription and its once-a-second redraw, so this panel holds no
 * timer of its own.
 */
function TimerPanel({ client, timer, language, state, now, recent }: TimerPanelProps) {
  const [status, setStatus] = useState<NotificationStatus | null>(null);

  useEffect(() => {
    let active = true;
    void client.notifications
      .systemStatus()
      .then((next) => {
        if (active) setStatus(next);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [client]);

  const remaining = remainingMs(state, now);
  const parts = splitDuration(state.length);

  const setPart = (part: "hours" | "minutes" | "seconds", value: number) => {
    timer.setLength(joinDuration({ ...splitDuration(state.length), [part]: value }));
  };

  const allowNotifications = () => {
    void client.notifications
      .requestSystemPermission()
      .then(() => client.notifications.systemStatus())
      .then((next) => setStatus(next))
      .catch(() => {});
  };

  return (
    <ui.View direction="column" gap="md">
      <ui.Text size="lg" weight="semibold">
        {formatDuration(remaining)}
      </ui.Text>

      {status !== null && status.permission !== "granted" ? (
        <ui.View direction="row" gap="sm" align="center">
          <ui.Status tone="warning">{translate(language, "notificationsOff")}</ui.Status>
          <ui.Button variant="secondary" onPress={allowNotifications}>
            {translate(language, "allowNotifications")}
          </ui.Button>
        </ui.View>
      ) : null}
      {status !== null && !status.canScheduleWhileClosed ? (
        <ui.Text tone="muted">{translate(language, "alertsNeedOpen")}</ui.Text>
      ) : null}
      {status !== null && status.canScheduleWhileClosed && !status.exactTiming ? (
        <ui.Text tone="muted">{translate(language, "alertsMayBeLate")}</ui.Text>
      ) : null}

      {state.status === "idle" || state.status === "ended" ? (
        <ui.View direction="column" gap="sm">
          <ui.View direction="row" gap="sm" align="end">
            <ui.NumberField
              label={translate(language, "hours")}
              value={parts.hours}
              minValue={0}
              maxValue={99}
              onChange={(event) => setPart("hours", event.detail)}
            />
            <ui.NumberField
              label={translate(language, "minutes")}
              value={parts.minutes}
              minValue={0}
              maxValue={59}
              onChange={(event) => setPart("minutes", event.detail)}
            />
            <ui.NumberField
              label={translate(language, "seconds")}
              value={parts.seconds}
              minValue={0}
              maxValue={59}
              onChange={(event) => setPart("seconds", event.detail)}
            />
          </ui.View>
          {recent.length > 0 ? (
            <ui.View direction="row" gap="sm" wrap>
              {recent.map((length) => (
                <ui.Button key={length} variant="secondary" onPress={() => timer.setLength(length)}>
                  {formatDuration(length)}
                </ui.Button>
              ))}
            </ui.View>
          ) : null}
          <ui.View direction="row" gap="sm">
            <ui.Button variant="primary" onPress={() => timer.start()}>
              {translate(language, "start")}
            </ui.Button>
          </ui.View>
        </ui.View>
      ) : null}

      {state.status === "paused" ? (
        <ui.View direction="row" gap="sm">
          <ui.Button variant="primary" onPress={() => timer.start()}>
            {translate(language, "resume")}
          </ui.Button>
          <ui.Button variant="secondary" onPress={() => timer.reset()}>
            {translate(language, "reset")}
          </ui.Button>
        </ui.View>
      ) : null}

      {state.status === "ended" ? (
        <ui.View direction="row" gap="sm">
          <ui.Button variant="secondary" onPress={() => timer.reset()}>
            {translate(language, "reset")}
          </ui.Button>
        </ui.View>
      ) : null}

      {state.status === "running" ? (
        <ui.View direction="row" gap="sm">
          <ui.Button variant="primary" onPress={() => timer.pause()}>
            {translate(language, "pause")}
          </ui.Button>
          <ui.Button variant="secondary" onPress={() => timer.reset()}>
            {translate(language, "reset")}
          </ui.Button>
        </ui.View>
      ) : null}
    </ui.View>
  );
}

/** A whole number of minutes, at least one, from a number field's value. */
function wholeMinutes(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.round(value)) : 1;
}

interface PomodoroPanelProps {
  pomodoro: ClockPomodoro;
  language: string;
  snapshot: PomodoroSnapshot;
  now: number;
}

/**
 * The Pomodoro tab. It draws the phase and its number in the Cycle, the time
 * left (or the sentence that names the phase ended), today's count, and the
 * controls the status calls for. The page owns the Cycle's subscription and its
 * once-a-second redraw, so this panel holds no timer of its own.
 */
function PomodoroPanel({ pomodoro, language, snapshot, now }: PomodoroPanelProps) {
  const { state, settings, today } = snapshot;
  const phase = translate(language, state.phase);
  const total = settings.longBreakEvery;
  const count = todayCount(today, now, new Date(now).getTimezoneOffset());
  const remaining = remainingCycleMs(state, settings, now);

  return (
    <ui.View direction="column" gap="md">
      <ui.Heading level={3}>{phase}</ui.Heading>
      <ui.Text>
        {translate(language, "pomodoroOfCycle")
          .replace("{n}", String(state.pomodoro))
          .replace("{total}", String(total))}
      </ui.Text>
      <ui.Text size="lg" weight="semibold">
        {state.status === "ended"
          ? translate(language, "phaseEnded").replace("{phase}", phase)
          : formatDuration(remaining)}
      </ui.Text>
      <ui.Text tone="muted">
        {translate(language, "pomodorosToday").replace("{n}", String(count))}
      </ui.Text>

      <ui.View direction="row" gap="sm" wrap>
        {state.status === "idle" || state.status === "ended" ? (
          <ui.Button variant="primary" onPress={() => pomodoro.start()}>
            {translate(language, "start")}
          </ui.Button>
        ) : null}
        {state.status === "running" ? (
          <ui.Button variant="primary" onPress={() => pomodoro.pause()}>
            {translate(language, "pause")}
          </ui.Button>
        ) : null}
        {state.status === "paused" ? (
          <ui.Button variant="primary" onPress={() => pomodoro.start()}>
            {translate(language, "resume")}
          </ui.Button>
        ) : null}
        <ui.Button variant="secondary" onPress={() => pomodoro.skip()}>
          {translate(language, "skip")}
        </ui.Button>
        <ui.Button variant="secondary" onPress={() => pomodoro.reset()}>
          {translate(language, "resetCycle")}
        </ui.Button>
      </ui.View>
    </ui.View>
  );
}

/**
 * The `pomodoro` Settings row's body: the three lengths, the count before a Long
 * Break, and the two auto-start switches. Each change is written straight to
 * the Cycle, which persists it under its one key, so the row survives a reload.
 * Labels come from the runtime catalogs.
 */
function createPomodoroSettings(client: PluginClient, pomodoro: ClockPomodoro): ComponentType {
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
          minValue={1}
          step={1}
          onChange={(event) =>
            pomodoro.setSettings({ pomodoroMinutes: wholeMinutes(event.detail) })
          }
        />
        <ui.NumberField
          label={translate(language, "shortBreakMinutes")}
          value={settings.shortBreakMinutes}
          minValue={1}
          step={1}
          onChange={(event) =>
            pomodoro.setSettings({ shortBreakMinutes: wholeMinutes(event.detail) })
          }
        />
        <ui.NumberField
          label={translate(language, "longBreakMinutes")}
          value={settings.longBreakMinutes}
          minValue={1}
          step={1}
          onChange={(event) =>
            pomodoro.setSettings({ longBreakMinutes: wholeMinutes(event.detail) })
          }
        />
        <ui.NumberField
          label={translate(language, "longBreakEvery")}
          value={settings.longBreakEvery}
          minValue={1}
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

/**
 * The Clock page: a heading and the four tabs, the Timer's selected first. The
 * page owns the Timer's and the Cycle's state, so the polite live region sits
 * below the tabs and speaks the same on every one of them. The Timer and
 * Pomodoro tabs draw their panels; the other two say they are coming soon until
 * their own tickets replace them.
 */
function createClockPage(
  client: PluginClient,
  timer: ClockTimer,
  pomodoro: ClockPomodoro
): ComponentType {
  function ClockPage() {
    const language = useLanguage(client);
    const [tab, setTab] = useState<ClockTab>(DEFAULT_TAB);
    const [snapshot, setSnapshot] = useState(() => timer.snapshot());
    const [pomodoroSnapshot, setPomodoroSnapshot] = useState(() => pomodoro.snapshot());
    const [now, setNow] = useState(() => Date.now());
    const items = TABS.map((key) => ({
      value: key,
      label: translate(language, key),
    }));

    useEffect(
      () =>
        timer.subscribe(() => {
          setSnapshot(timer.snapshot());
          setNow(Date.now());
        }),
      [timer]
    );

    // Subscribed, then read once, so a load that settled before the effect ran
    // still reaches the page.
    useEffect(() => {
      const sync = () => {
        setPomodoroSnapshot(pomodoro.snapshot());
        setNow(Date.now());
      };
      sync();
      return pomodoro.subscribe(sync);
    }, [pomodoro]);

    const running =
      snapshot.state.status === "running" || pomodoroSnapshot.state.status === "running";

    // The redraw exists only while the page is mounted and a phase runs.
    useEffect(() => {
      if (!running) return;
      const id = setInterval(() => setNow(Date.now()), 1_000);
      return () => clearInterval(id);
    }, [running]);

    const state = snapshot.state;
    const announcement = liveRegionText(state, now, language);

    return (
      <ui.View direction="column" gap="md">
        <ui.Tabs
          label={translate(language, "tabs")}
          items={items}
          selectedKey={tab}
          onChange={(event) => setTab(asTab(event.detail))}
        >
          {tab === "timer" ? (
            <TimerPanel
              client={client}
              timer={timer}
              language={language}
              state={state}
              now={now}
              recent={snapshot.recent}
            />
          ) : tab === "pomodoro" ? (
            <PomodoroPanel
              pomodoro={pomodoro}
              language={language}
              snapshot={pomodoroSnapshot}
              now={now}
            />
          ) : (
            <ui.EmptyState
              title={translate(language, tab)}
              description={translate(language, "comingSoon")}
            />
          )}
        </ui.Tabs>
        {announcement === "" ? null : <ui.Status tone="info">{announcement}</ui.Status>}
      </ui.View>
    );
  }
  return ClockPage;
}
