/**
 * The Clock runtime: the Clock page and the Command handlers it answers. Kept
 * apart from `index.tsx` (the Worker bootstrap) so a test can drive the same
 * logic over the polyfill-free Remote UI entry the test kit uses
 * (`@/plugin-sdk/ui-serve`), without loading the Worker's Remote DOM polyfill
 * into jsdom. Imports only `@/plugin-sdk` (and its subpaths) and its own files.
 *
 * The page draws the four tabs its glossary names. Every tab's panel is empty
 * until its own ticket fills it, so each one says it is coming soon. The Timer
 * tab is selected first, and the selected tab is page-local state.
 */

import { useEffect, useState, type ComponentType } from "react";
import {
  PLUGIN_COMMAND_RUN_REQUEST,
  ui,
  type HostRequestHandler,
  type PluginClient,
} from "@/plugin-sdk";
import { translate } from "./i18n";

/** The Clock page id, exactly as the manifest declares it. */
export const CLOCK_PAGE_ID = "clock";

/** The Command-local ids the manifest declares. */
export const OPEN_CLOCK = "openClock";
export const TOGGLE_TIMER = "toggleTimer";

/** The tabs the page draws, in the glossary's order. */
const TABS = ["pomodoro", "timer", "stopwatch", "alarms"] as const;

/** One tab's key, which is also its runtime catalog key. */
type ClockTab = (typeof TABS)[number];

/** The tab selected when the page opens; the Timer's own ticket fills it. */
const DEFAULT_TAB: ClockTab = "timer";

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

/** Wires the client to the Clock page and the Command handlers. */
export function startClock(client: PluginClient, serve: ClockServe): void {
  serve(client, {
    pages: { [CLOCK_PAGE_ID]: createClockPage(client) },
    onHostRequest: (method, params) => handleHostRequest(client, method, params),
  });
}

/** Answers the host's health check and runs the Plugin's Commands. */
function handleHostRequest(client: PluginClient, method: string, params: unknown): unknown {
  if (method === "health.check") return "pong";
  if (method === PLUGIN_COMMAND_RUN_REQUEST) return runClockCommand(client, params);
  throw new Error(`No handler for ${method}`);
}

/**
 * Answers one Command run. `Open Clock` is the page's navigating Command, so the
 * host normally navigates without a `command.run`; answering it here keeps the
 * page reachable the other way. `Start or pause the Timer` is registered and
 * does nothing until the Timer's own ticket gives it state to act on.
 */
async function runClockCommand(client: PluginClient, params: unknown): Promise<null> {
  const { id } = (params ?? {}) as { id?: unknown };
  if (id === OPEN_CLOCK) await client.navigation.openPage({ pageId: CLOCK_PAGE_ID });
  if (id === TOGGLE_TIMER) return null;
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
 * The Clock page: a heading and the four tabs, the Timer's selected first. Each
 * panel is an EmptyState naming its tab and saying it is coming soon; the tab's
 * own ticket replaces it. The page holds no Timer state, interval, or storage
 * read.
 */
function createClockPage(client: PluginClient): ComponentType {
  function ClockPage() {
    const language = useLanguage(client);
    const [tab, setTab] = useState<ClockTab>(DEFAULT_TAB);
    const items = TABS.map((key) => ({
      value: key,
      label: translate(language, key),
    }));

    return (
      <ui.View direction="column" gap="md">
        <ui.Heading level={2}>{translate(language, "heading")}</ui.Heading>
        <ui.Tabs
          label={translate(language, "tabs")}
          items={items}
          selectedKey={tab}
          onChange={(event) => setTab(asTab(event.detail))}
        >
          <ui.EmptyState
            title={translate(language, tab)}
            description={translate(language, "comingSoon")}
          />
        </ui.Tabs>
      </ui.View>
    );
  }
  return ClockPage;
}
