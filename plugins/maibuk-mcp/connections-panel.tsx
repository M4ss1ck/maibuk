/**
 * The MCP Server page's live half (#594, part 2): the Status that says how many
 * Agents are connected, the Connections table, and the Activity log. It lives
 * beside `page.tsx` rather than inside it because the setup half is already long
 * enough that the page would pass 400 lines with these sections added.
 *
 * Both lists are read-only SDK `Table`s, so the host keeps them navigable;
 * nothing here adds a per-row action. Each section subscribes to the module
 * store the runtime owns, so opening, moving, or ending a Connection and every
 * answered tool call repaint the page without a round trip.
 */

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { ui } from "@/plugin-sdk";
import { ACTIVITY_LIMIT, activityEntries, subscribeActivity, type Activity } from "./activity";
import { translate, type McpKey } from "./i18n";
import { liveConnections, subscribeConnections, type ConnectionRecord } from "./live";

/** How often the Connections table repaints its relative labels. */
export const RELATIVE_TICK_MS = 30_000;

/** The clock, read again every `intervalMs` for as long as the caller stays mounted. */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** One runtime string lookup, bound to the page's language. */
type Translate = (key: McpKey) => string;

/** The live Connections, repainted whenever one opens, moves, or ends. */
function useLiveConnections(): readonly ConnectionRecord[] {
  return useSyncExternalStore(subscribeConnections, liveConnections, liveConnections);
}

/** The Activity log, repainted on every entry. */
function useActivity(): readonly Activity[] {
  return useSyncExternalStore(subscribeActivity, activityEntries, activityEntries);
}

/** The localized count sentence: one Agent, or a plural form with the count. */
function connectedText(language: string, count: number, t: Translate): string {
  // Both shipped catalogs split at one, but the rule lives with the locale so a
  // language that adds another form later reads its own category.
  const form = new Intl.PluralRules(language).select(count);
  if (form === "one") return t("connectedOne");
  return t("connectedMany").replace("{count}", String(count));
}

/** The Status beside the page heading, live for as long as the page is open. */
export function LiveIndicator({ language }: { language: string }): ReactNode {
  const connections = useLiveConnections();
  const t = (key: McpKey) => translate(language, key);
  return (
    <ui.Status tone={connections.length === 0 ? "info" : "success"}>
      {connections.length === 0
        ? t("noConnections")
        : connectedText(language, connections.length, t)}
    </ui.Status>
  );
}

/** The live Connections and the Activity log, newest first. */
export function LiveSections({ language }: { language: string }): ReactNode {
  return (
    <ui.View direction="column" gap="lg">
      <ConnectionsSection language={language} />
      <ActivitySection language={language} />
    </ui.View>
  );
}

/** Who is connected right now, with how long ago each Agent last called. */
function ConnectionsSection({ language }: { language: string }): ReactNode {
  const connections = useLiveConnections();
  const t = (key: McpKey) => translate(language, key);
  // The relative labels count from the clock, so the section repaints them on
  // its own timer: without one, "now" would freeze until the next Connection
  // change, and the list would claim an Agent called hours after it last did.
  const now = useNow(RELATIVE_TICK_MS);

  return (
    <ui.View direction="column" gap="sm">
      <ui.Heading level={3}>{t("connectionsHeading")}</ui.Heading>
      {connections.length === 0 ? (
        <ui.EmptyState title={t("connectionsEmpty")} />
      ) : (
        <ui.Table
          label={t("connectionsLabel")}
          columns={[
            { value: "agent", label: t("agentColumn") },
            { value: "lastActivity", label: t("lastActivityColumn") },
          ]}
        >
          {connections.map((connection) => (
            <ui.TableRow
              key={connection.name}
              cells={[
                { value: "agent", label: connection.name },
                {
                  value: "lastActivity",
                  label: relativeTime(connection.lastActivityAt, language, now),
                },
              ]}
            />
          ))}
        </ui.Table>
      )}
    </ui.View>
  );
}

/**
 * The newest `ACTIVITY_LIMIT` answered calls, newest first. The log already
 * caps itself; the slice repeats the intent here so the renderer never depends
 * on it. 500 rows are 500 elements on the wire (the cells are a prop, not a
 * node each), far under the host's 10,000-node limit.
 */
function ActivitySection({ language }: { language: string }): ReactNode {
  const entries = useActivity();
  const t = (key: McpKey) => translate(language, key);
  const newest = [...entries].reverse().slice(0, ACTIVITY_LIMIT);

  return (
    <ui.View direction="column" gap="sm">
      <ui.Heading level={3}>{t("activityHeading")}</ui.Heading>
      {newest.length === 0 ? (
        <ui.EmptyState title={t("activityEmpty")} />
      ) : (
        <ui.Table
          label={t("activityLabel")}
          columns={[
            { value: "time", label: t("timeColumn") },
            { value: "agent", label: t("agentColumn") },
            { value: "tool", label: t("toolColumn") },
            { value: "item", label: t("itemColumn") },
            { value: "result", label: t("resultColumn") },
          ]}
        >
          {newest.map((entry, index) => (
            <ui.TableRow
              key={`${entry.at}:${index}`}
              cells={[
                { value: "time", label: shortTime(entry.at, language) },
                { value: "agent", label: entry.agent ?? t("unnamedAgent") },
                { value: "tool", label: entry.tool },
                { value: "item", label: entry.item ?? t("emptyValue") },
                {
                  value: "result",
                  label: entry.result === "ok" ? t("resultOk") : t("resultError"),
                },
              ]}
            />
          ))}
        </ui.Table>
      )}
    </ui.View>
  );
}

/** One formatter per locale; a long log would otherwise build 500 of them. */
const timeFormatters = new Map<string, Intl.DateTimeFormat>();

/** One instant as the app's locale writes a short date and time. */
function shortTime(at: number, language: string): string {
  let formatter = timeFormatters.get(language);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat(language, { dateStyle: "short", timeStyle: "short" });
    timeFormatters.set(language, formatter);
  }
  return formatter.format(at);
}

/** The units a last-activity label counts down, largest first. */
const RELATIVE_UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

/** One relative formatter per locale. */
const relativeFormatters = new Map<string, Intl.RelativeTimeFormat>();

/** How long ago one instant was, in the app's locale. */
function relativeTime(at: number, language: string, now: number): string {
  let formatter = relativeFormatters.get(language);
  if (formatter === undefined) {
    formatter = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
    relativeFormatters.set(language, formatter);
  }
  const seconds = Math.round((at - now) / 1_000);
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= size) return formatter.format(Math.round(seconds / size), unit);
  }
  return formatter.format(seconds, "second");
}
