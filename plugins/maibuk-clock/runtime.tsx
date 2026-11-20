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
import { translate } from "./i18n";
import {
  formatDuration,
  joinDuration,
  MS_PER_MINUTE,
  remainingMs,
  splitDuration,
  type TimerState,
} from "./time";
import { createTimer, type ClockTimer } from "./timer";

/** The Clock page id, exactly as the manifest declares it. */
export const CLOCK_PAGE_ID = "clock";

/** The Command-local ids the manifest declares. */
export const OPEN_CLOCK = "openClock";
export const TOGGLE_TIMER = "toggleTimer";

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
    onHostRequest?: HostRequestHandler;
  }
) => void;

/**
 * Wires the client to the Clock page and the Command handlers. The Timer is
 * created here and lives for the Plugin's lifetime, so a Command run and a page
 * mount act on the same one.
 */
export function startClock(client: PluginClient, serve: ClockServe): Promise<void> {
  const timer = createTimer(client);
  // The Alert and the end toast read the app language, so it is read before load
  // reconciles a Timer that ended while Maibuk was closed; "en" stays the fallback.
  // The returned promise settles once that startup reconciliation is done.
  const started = (async () => {
    try {
      const value = await client.language.get();
      timer.setLanguage(value.language);
    } catch {
      // Keep the language the Timer already has.
    }
    await timer.load();
  })();
  // The Alert's words follow the app language. Subscribed once here, not per
  // page, so switching tabs never re-subscribes.
  void client
    .on("language.changed", (payload) => timer.setLanguage(payload.language))
    .catch(() => {});
  serve(client, {
    pages: { [CLOCK_PAGE_ID]: createClockPage(client, timer) },
    onHostRequest: (method, params) => handleHostRequest(client, timer, method, params),
  });
  return started;
}

/** Answers the host's health check and runs the Plugin's Commands. */
function handleHostRequest(
  client: PluginClient,
  timer: ClockTimer,
  method: string,
  params: unknown
): unknown {
  if (method === "health.check") return "pong";
  if (method === PLUGIN_COMMAND_RUN_REQUEST) return runClockCommand(client, timer, params);
  throw new Error(`No handler for ${method}`);
}

/**
 * Answers one Command run. `Open Clock` is the page's navigating Command, so the
 * host normally navigates without a `command.run`; answering it here keeps the
 * page reachable the other way. `Start or pause the Timer` toggles the one
 * Timer the Plugin holds.
 */
async function runClockCommand(
  client: PluginClient,
  timer: ClockTimer,
  params: unknown
): Promise<null> {
  const { id } = (params ?? {}) as { id?: unknown };
  if (id === OPEN_CLOCK) await client.navigation.openPage({ pageId: CLOCK_PAGE_ID });
  if (id === TOGGLE_TIMER) timer.toggle();
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

/**
 * The Clock page: a heading and the four tabs, the Timer's selected first. The
 * page owns the Timer's state, so the polite live region sits below the tabs
 * and speaks the same on every one of them. The Timer tab draws its panel;
 * every other tab says it is coming soon until its own ticket replaces it.
 */
function createClockPage(client: PluginClient, timer: ClockTimer): ComponentType {
  function ClockPage() {
    const language = useLanguage(client);
    const [tab, setTab] = useState<ClockTab>(DEFAULT_TAB);
    const [snapshot, setSnapshot] = useState(() => timer.snapshot());
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

    const running = snapshot.state.status === "running";

    // The redraw exists only while the page is mounted and the Timer runs.
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
