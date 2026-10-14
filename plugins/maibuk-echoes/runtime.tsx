/**
 * The Echoes runtime: the report page and the detection Settings row it serves,
 * plus the Command handlers it answers. Kept apart from `index.tsx` (the Worker
 * bootstrap) so a test can drive the same logic over the polyfill-free Remote UI
 * entry the test kit uses (`@/plugin-sdk/ui-serve`), without loading the
 * Worker's Remote DOM polyfill into jsdom. Imports only `@/plugin-sdk` (and its
 * subpaths) and its own files.
 *
 * The page is a placeholder for the report the later units draw. It already
 * reads the scope the `Find echoes` Command stored, so opening the page from a
 * Chapter or Book Item Menu lands on that item. The Settings row is the
 * `detection` row's body, mounted by the host under the row's Plugin-local id.
 */

import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import {
  PLUGIN_COMMAND_RUN_REQUEST,
  ui,
  type HostRequestHandler,
  type PluginClient,
} from "@/plugin-sdk";
import {
  DEFAULT_ECHO_SETTINGS,
  NEARBY_WINDOW_MAX,
  NEARBY_WINDOW_MIN,
  type EchoSettings,
} from "./find-echoes";
import { translate } from "./i18n";
import { clampNearbyWindow, readEchoesSettings, writeEchoesSettings } from "./settings";

/** The report page id, exactly as the manifest declares it. */
export const REPORT_PAGE_ID = "report";

/** The Settings row whose body the Plugin draws, exactly as the manifest declares its id. */
export const SETTINGS_ROW_ID = "detection";

/** The Command-local ids the manifest declares. */
export const OPEN_ECHOES = "openEchoes";
export const FIND_ECHOES = "findEchoes";

/** What the report is scoped to: a Book, or one Chapter inside it. */
export interface EchoScope {
  bookId: string;
  chapterId?: string;
}

/**
 * The host's Remote UI and request entry (`servePluginUi`), Worker or test. The
 * two SDK entries share this shape, so the runtime takes whichever the caller
 * supplies.
 */
export type EchoServe = (
  client: Pick<PluginClient, "onHostRequest">,
  options: {
    pages: Record<string, ComponentType>;
    settingsRows?: Record<string, ComponentType>;
    onHostRequest?: HostRequestHandler;
  }
) => void;

/** The item a targeted Command was invoked on, as the host captured it. */
interface EchoCommandTarget {
  kind?: string;
  id?: string;
}

/** The runtime's own state; one per activation, so tests never share it. */
interface EchoRuntime {
  scope: EchoScope | null;
}

/** Wires the client to the report page, the Settings row, and the Command handlers. */
export function startEchoes(client: PluginClient, serve: EchoServe): void {
  const runtime: EchoRuntime = { scope: null };
  serve(client, {
    pages: { [REPORT_PAGE_ID]: createReportPage(client, runtime) },
    settingsRows: { [SETTINGS_ROW_ID]: createDetectionSettings(client) },
    onHostRequest: (method, params) => handleHostRequest(client, runtime, method, params),
  });
}

function handleHostRequest(
  client: PluginClient,
  runtime: EchoRuntime,
  method: string,
  params: unknown
): unknown {
  if (method === "health.check") return "pong";
  if (method === PLUGIN_COMMAND_RUN_REQUEST) return runEchoCommand(client, runtime, params);
  throw new Error(`No handler for ${method}`);
}

/**
 * Answers one Command run. `Find echoes` stores the scope from the item the
 * host captured, then opens the report; `Open Echoes` is the report page's
 * navigating Command, so the host normally navigates without a `command.run`,
 * and answering it here keeps the page reachable the other way.
 */
async function runEchoCommand(
  client: PluginClient,
  runtime: EchoRuntime,
  params: unknown
): Promise<null> {
  const { id, target } = (params ?? {}) as { id?: string; target?: EchoCommandTarget };
  if (id !== FIND_ECHOES && id !== OPEN_ECHOES) return null;
  if (id === FIND_ECHOES) runtime.scope = await scopeForTarget(client, target);
  await client.navigation.openPage({ pageId: REPORT_PAGE_ID });
  return null;
}

/** The scope a Command target implies: a Book, or a Chapter and its Book. */
async function scopeForTarget(
  client: PluginClient,
  target: EchoCommandTarget | undefined
): Promise<EchoScope | null> {
  if (target === undefined || typeof target.id !== "string") return null;
  try {
    if (target.kind === "book") return { bookId: target.id };
    if (target.kind === "chapter") {
      const chapter = await client.library.chapters.get({ chapterId: target.id });
      return chapter === null ? null : { bookId: chapter.bookId, chapterId: chapter.id };
    }
  } catch {
    return null;
  }
  return null;
}

/** The report page: the placeholder plus the scope it was opened for. */
function createReportPage(client: PluginClient, runtime: EchoRuntime): ComponentType {
  function ReportPage() {
    const language = useEchoLanguage(client);
    const [scopeLabel, setScopeLabel] = useState<string | null>(null);
    const scope = runtime.scope;
    useEffect(() => {
      let cancelled = false;
      void resolveScopeLabel(client, scope).then((label) => {
        if (!cancelled) setScopeLabel(label);
      });
      return () => {
        cancelled = true;
      };
    }, [client, scope]);
    return (
      <ui.View direction="column" gap="md">
        <ui.Text>{translate(language, "report.placeholder")}</ui.Text>
        <ui.Text>{scopeLabel ?? translate(language, "report.noBook")}</ui.Text>
      </ui.View>
    );
  }
  return ReportPage;
}

/**
 * The name to show for the scope: the Chapter's title when one is scoped, its
 * Book's title otherwise, and the first Book when no scope was stored.
 */
async function resolveScopeLabel(
  client: PluginClient,
  scope: EchoScope | null
): Promise<string | null> {
  try {
    if (scope === null) {
      const books = await client.library.books.list();
      return books[0]?.title ?? null;
    }
    if (scope.chapterId !== undefined) {
      const chapter = await client.library.chapters.get({ chapterId: scope.chapterId });
      if (chapter !== null) return chapter.title;
    }
    const book = await client.library.books.get({ bookId: scope.bookId });
    return book === null ? null : book.title;
  } catch {
    return null;
  }
}

/**
 * The app language as the SDK signals it: the current value at mount, then
 * every change, in React state so the page re-renders on a switch.
 */
function useEchoLanguage(client: PluginClient): string {
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

/**
 * The `detection` Settings row's body: one switch per echo kind the detection
 * supports, the stemming switch, the nearby-echo window, and the ignore list.
 * Values load from the Plugin's storage on mount and every change is written
 * back, so the row survives a reload; labels come from the runtime catalogs.
 */
function createDetectionSettings(client: PluginClient): ComponentType {
  function DetectionSettings() {
    const language = useEchoLanguage(client);
    const [settings, setSettings] = useState<EchoSettings>(() => ({
      ...DEFAULT_ECHO_SETTINGS,
      ignore: [],
    }));
    // Nothing is written before the stored value has been read, so a slow read
    // cannot be clobbered by the initial defaults.
    const hydrated = useRef(false);

    useEffect(() => {
      let cancelled = false;
      void readEchoesSettings(client).then((stored) => {
        if (cancelled) return;
        hydrated.current = true;
        setSettings(stored);
      });
      return () => {
        cancelled = true;
      };
    }, [client]);

    useEffect(() => {
      if (!hydrated.current) return;
      void writeEchoesSettings(client, settings);
    }, [client, settings]);

    const update = useCallback((patch: Partial<EchoSettings>) => {
      setSettings((current) => ({ ...current, ...patch }));
    }, []);

    return (
      <ui.View direction="column" gap="md">
        <ui.Switch
          label={translate(language, "settings.nearby")}
          isSelected={settings.nearby}
          onChange={(event) => update({ nearby: event.detail })}
        />
        <ui.Switch
          label={translate(language, "settings.overused")}
          isSelected={settings.overused}
          onChange={(event) => update({ overused: event.detail })}
        />
        <ui.Switch
          label={translate(language, "settings.phrase")}
          isSelected={settings.phrases}
          onChange={(event) => update({ phrases: event.detail })}
        />
        <ui.Switch
          label={translate(language, "settings.stemming")}
          isSelected={settings.stemming}
          onChange={(event) => update({ stemming: event.detail })}
        />
        <ui.NumberField
          label={translate(language, "settings.nearbyWindow")}
          value={settings.nearbyWindow}
          // The field carries detection's own range so a typed value is clamped
          // on commit; the settings module clamps again as the storage guard,
          // so anything read from a stale or malformed store stays in range.
          minValue={NEARBY_WINDOW_MIN}
          maxValue={NEARBY_WINDOW_MAX}
          onChange={(event) => update({ nearbyWindow: clampNearbyWindow(event.detail) })}
        />
        <ui.MultiSelectCombobox
          label={translate(language, "settings.ignoreList")}
          options={[]}
          selectedKeys={settings.ignore}
          allowsCustomValue
          onChange={(event) => update({ ignore: [...event.detail] })}
        />
      </ui.View>
    );
  }
  return DetectionSettings;
}
