/**
 * The Activity log: one entry per MCP tool call the server answers, holding
 * only what the Plugin page shows (when, which Agent, which tool, which item,
 * and whether it worked), never the author's text. The log lives in memory in
 * the Worker so the page reads it without a round trip, and lands in Plugin
 * storage under `activity` so turning the Plugin off and on keeps it.
 */

import type { PluginClient } from "@/plugin-sdk";
import { isLibraryUnavailable } from "./library";

/** The newest Activities the log keeps; older ones drop first. */
export const ACTIVITY_LIMIT = 500;

/** The storage key holding the Activity log. */
const ACTIVITY_STORAGE_KEY = "activity";

/** One MCP tool call as the Activity log records it: no content, only what the page shows. */
export interface Activity {
  /** When the call was answered, in ms since the epoch. */
  at: number;
  /** The resolved Connection name, or null when the request named no Agent. */
  agent: string | null;
  /** The tool the Agent called. */
  tool: string;
  /** The id of the most specific item the call named, or null when it named none. */
  item: string | null;
  result: "ok" | "error";
}

/** What the tool handlers report for one call; the entry adds `at` and `agent`. */
export type ActivityCall = Omit<Activity, "at" | "agent">;

/** Records one call for the Connection it belongs to. */
export type ActivityRecorder = (call: ActivityCall) => void;

/** The log, oldest first. A new entry replaces the array, so a render can compare it. */
let entries: Activity[] = [];

/** The page's re-renders, told whenever the log changes. */
const listeners = new Set<() => void>();

/** The Plugin storage writer, installed on start; null before it. */
let client: PluginClient | null = null;

/** How far the stored log may fall behind the newest entry. */
let writeEveryMs = 0;

/** When the stored log was last written, or 0 so the first entry writes at once. */
let writtenAt = 0;

/** The trailing write that lands entries the throttle held back, or null. */
let trailing: ReturnType<typeof setTimeout> | null = null;

/** Writes queue behind each other, so storage always ends on the newest log. */
let writes: Promise<unknown> = Promise.resolve();

/** The current log, oldest first. */
export function activityEntries(): readonly Activity[] {
  return entries;
}

/** Calls `listener` on each new entry; returns the function that stops it. */
export function subscribeActivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Tells the page the log moved. */
function publish(): void {
  for (const listener of listeners) listener();
}

/**
 * Appends one entry, drops the oldest past `ACTIVITY_LIMIT`, tells the page,
 * and persists through the same throttle the Connections use.
 */
export function recordActivity(activity: Activity): void {
  entries = [...entries, activity].slice(-ACTIVITY_LIMIT);
  publish();
  persist();
}

/** The stored log as Activities, or none when it holds anything else. */
function storedActivities(value: unknown): Activity[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-ACTIVITY_LIMIT) as Activity[];
}

/**
 * Reads the stored log into memory for this start. A failed read (the
 * Tutorial) starts empty and leaves storage alone: the empty log is never
 * written back over the entries a later start should still find.
 */
export async function startActivityLog(target: PluginClient, windowMs: number): Promise<void> {
  client = target;
  writeEveryMs = windowMs;
  writtenAt = 0;
  // A fresh start answers a new client, so its writes never queue behind the
  // one a stopped Worker left pending.
  writes = Promise.resolve();
  if (trailing !== null) {
    clearTimeout(trailing);
    trailing = null;
  }
  let stored: unknown;
  try {
    stored = await target.storage.get({ key: ACTIVITY_STORAGE_KEY });
  } catch (error) {
    if (!isLibraryUnavailable(error)) throw error;
    stored = undefined;
  }
  entries = storedActivities(stored);
  publish();
}

/**
 * Writes the log now, or after the throttle window when it was written too
 * recently, so a burst of calls costs one storage call, not one each. The
 * trailing write lands the last entries the window held back.
 */
function persist(): void {
  if (client === null) return;
  const wait = writeEveryMs - (Date.now() - writtenAt);
  if (wait <= 0) {
    write();
    return;
  }
  if (trailing !== null) return;
  trailing = setTimeout(() => {
    trailing = null;
    write();
  }, wait);
}

/** Queues one storage write of the current log. */
function write(): void {
  const target = client;
  if (target === null) return;
  if (trailing !== null) {
    clearTimeout(trailing);
    trailing = null;
  }
  writtenAt = Date.now();
  const value = entries;
  writes = writes
    .then(() => target.storage.set({ key: ACTIVITY_STORAGE_KEY, value }))
    .catch(() => {
      // The Library is unavailable (the Tutorial): the next write repeats the log.
    });
}
