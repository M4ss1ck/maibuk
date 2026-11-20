/**
 * The host's System Notification service for Plugins (ADR 0042, #869): the
 * delivery behind the Plugin API's `notifications.system` and
 * `notifications.cancel`.
 *
 * The service is pure: it holds the per-Plugin queue and the fallback rule, and
 * takes the platform adapter as a dependency. A Plugin's ids are its own (a tag
 * is `<pluginId>/<id>`), so one Plugin can never replace or cancel another's
 * notification. Maibuk allows at most one immediate System Notification per
 * second per Plugin, so a Plugin's sends go through its own chain, one at a
 * time, each waiting out the rest of that second: nothing is dropped, and one
 * Plugin never waits on another. Where the device refuses permission, or
 * showing one fails, the author still sees the notice as Maibuk's toast.
 */

import { createNotificationDeadlines } from "@/lib/platform/notification-deadlines";
import type { SystemNotificationAdapter, SystemNotificationPermission } from "@/lib/platform/types";

/** Maibuk's limit: one immediate System Notification per second, per Plugin (ADR 0042). */
const MIN_GAP_MS = 1000;

/** The tag one sent notification is shown under; the Plugin id scopes it. */
export function systemNotificationTag(pluginId: string, id: string): string {
  return `${pluginId}/${id}`;
}

/** What the service exposes to the Plugin API's notification methods. */
interface PluginSystemNotifications {
  /** Shows one, or falls back to Maibuk's toast; resolves once it was delivered either way. */
  send(
    plugin: { id: string; name: string },
    notification: { id: string; title: string; body: string }
  ): Promise<null>;
  /** Withdraws one; resolves once the platform withdrew it, or the device refused to. */
  cancel(pluginId: string, id: string): Promise<null>;
  /** The OS's answer now, and whether the OS fires one while Maibuk is closed. */
  status(): Promise<{
    permission: SystemNotificationPermission;
    canScheduleWhileClosed: boolean;
  }>;
  /** Asks the OS, which the web allows only inside a user action. */
  requestPermission(): Promise<{ permission: SystemNotificationPermission }>;
}

/** What the service is built with; `now` and `wait` exist for its tests. */
interface PluginSystemNotificationsDeps {
  adapter: SystemNotificationAdapter;
  /** Maibuk's toast, which the caller passes `toast.info`, bypassing its own 5 s limit. */
  fallback: (text: string) => void;
  /** Milliseconds since the epoch; defaults to `Date.now`. */
  now?: () => number;
  /** Waits `ms` milliseconds; defaults to a `setTimeout` promise. */
  wait?: (ms: number) => Promise<void>;
}

function defaultWait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * The System Notification service. Every send and cancel for one Plugin joins
 * that Plugin's chain, so they run in the order they were called; a send waits
 * until a second has passed since that Plugin's previous delivered one.
 * `cancel` joins the chain too (a cancel called after a queued send runs after
 * it) but never waits for the budget, since withdrawing one is not a show.
 */
export function createPluginSystemNotifications(
  deps: PluginSystemNotificationsDeps
): PluginSystemNotifications {
  const now = deps.now ?? Date.now;
  const wait = deps.wait ?? defaultWait;
  /** Each Plugin's tail: the last queued operation, which never rejects. */
  const chains = new Map<string, Promise<unknown>>();
  /** When each Plugin's previous send finished delivering, so the next can wait it out. */
  const deliveredAt = new Map<string, number>();

  function enqueue<T>(pluginId: string, run: () => Promise<T>): Promise<T> {
    const previous = chains.get(pluginId) ?? Promise.resolve();
    const next = previous.then(run);
    chains.set(
      pluginId,
      next.then(
        () => undefined,
        () => undefined
      )
    );
    return next;
  }

  async function deliver(
    plugin: { id: string; name: string },
    notification: { id: string; title: string; body: string }
  ): Promise<null> {
    const tag = systemNotificationTag(plugin.id, notification.id);
    const title = `${plugin.name}: ${notification.title}`;
    const granted = await deps.adapter.permission().then(
      (permission) => permission === "granted",
      () => false
    );
    if (granted) {
      try {
        await deps.adapter.show({ tag, title, body: notification.body });
        return null;
      } catch {
        // The device refused at show time; the toast below still reaches the author.
      }
    }
    deps.fallback(`${title}. ${notification.body}`);
    return null;
  }

  async function sendQueued(
    plugin: { id: string; name: string },
    notification: { id: string; title: string; body: string }
  ): Promise<null> {
    const previous = deliveredAt.get(plugin.id);
    if (previous !== undefined) {
      const remaining = MIN_GAP_MS - (now() - previous);
      if (remaining > 0) await wait(remaining);
    }
    const sent = await deliver(plugin, notification);
    deliveredAt.set(plugin.id, now());
    return sent;
  }

  return {
    send(plugin, notification) {
      return enqueue(plugin.id, () => sendQueued(plugin, notification));
    },
    cancel(pluginId, id) {
      return enqueue(pluginId, async () => {
        try {
          await deps.adapter.cancel(systemNotificationTag(pluginId, id));
        } catch {
          // An unknown tag is not an error, and neither is a device that refuses.
        }
        return null;
      });
    },
    async status() {
      return {
        permission: await deps.adapter.permission(),
        canScheduleWhileClosed: deps.adapter.canScheduleWhileClosed(),
      };
    },
    async requestPermission() {
      return { permission: await deps.adapter.requestPermission() };
    },
  };
}

/** One entry of the memory adapter's log. */
interface MemorySystemNotificationLogEntry {
  kind: "sent" | "replaced" | "scheduled" | "cancelled";
  tag: string;
  title?: string;
  body?: string;
  /** The deadline a `"scheduled"` entry was recorded for, ms since the epoch. */
  at?: number;
}

/** The memory device the test kit exposes as `host.systemNotifications`. */
export type MemorySystemNotificationAdapter = SystemNotificationAdapter & {
  readonly log: MemorySystemNotificationLogEntry[];
  readonly active: ReadonlyMap<string, { title: string; body: string }>;
  readonly scheduled: ReadonlyMap<string, { title: string; body: string; at: number }>;
  setPermission(permission: SystemNotificationPermission): void;
  setCanScheduleWhileClosed(value: boolean): void;
  setExactTiming(value: boolean): void;
  /** Simulates the author clicking a notification, so a test sees the Plugin's handler. */
  click(tag: string): void;
  requestAnswer: SystemNotificationPermission;
};

/**
 * The in-memory System Notification adapter a Plugin's tests use: it shows
 * nothing, and records what the host asked of it instead, so a test asserts the
 * notification the host produced without a device.
 *
 * ```ts
 * const notifications = createMemorySystemNotificationAdapter();
 * // ...drive the Plugin, then:
 * expect(notifications.log.at(-1)).toMatchObject({ kind: "sent", tag: "clock/pomodoro" });
 * expect(notifications.active.get("clock/pomodoro")?.body).toBe("Break time");
 * ```
 *
 * - `log` lists every show, schedule, and cancel in order: `"sent"` for a new
 *   tag, `"replaced"` when the tag was already showing (a second send with the
 *   same id replaces the first), `"scheduled"` when one was given a deadline,
 *   `"cancelled"` when a cancel withdrew one.
 * - `active` holds the notifications currently showing, keyed by tag.
 * - `scheduled` holds the ones waiting for their deadline, keyed by tag; a host
 *   timer moves each into `active` when it is due.
 * - `setPermission` plays the OS's answer, and `requestPermission` answers with
 *   `requestAnswer` and remembers it; both start at `"granted"`.
 * - `setCanScheduleWhileClosed` plays whether the OS fires one after Maibuk
 *   closes; it starts `false`, which is every platform but Android.
 * - `setExactTiming` plays whether a scheduled one fires on time; it starts
 *   `true`.
 * - `click` runs the handlers `onClick` registered with the tag, as a click
 *   on the notification would.
 */
export function createMemorySystemNotificationAdapter(): MemorySystemNotificationAdapter {
  const log: MemorySystemNotificationLogEntry[] = [];
  const active = new Map<string, { title: string; body: string }>();
  const scheduled = new Map<string, { title: string; body: string; at: number }>();
  const clickHandlers = new Set<(tag: string) => void>();
  let permission: SystemNotificationPermission = "granted";
  let canSchedule = false;
  let exactTiming = true;

  function record(kind: "sent" | "replaced", tag: string, title: string, body: string): void {
    log.push({ kind, tag, title, body });
    active.set(tag, { title, body });
  }

  const deadlines = createNotificationDeadlines((notification) => {
    scheduled.delete(notification.tag);
    record(
      active.has(notification.tag) ? "replaced" : "sent",
      notification.tag,
      notification.title,
      notification.body
    );
  });

  const adapter: MemorySystemNotificationAdapter = {
    log,
    active,
    scheduled,
    requestAnswer: "granted",
    setPermission(next): void {
      permission = next;
    },
    setCanScheduleWhileClosed(value): void {
      canSchedule = value;
    },
    setExactTiming(value): void {
      exactTiming = value;
    },
    async permission() {
      return permission;
    },
    async requestPermission() {
      permission = adapter.requestAnswer;
      return permission;
    },
    async show(notification) {
      record(
        active.has(notification.tag) ? "replaced" : "sent",
        notification.tag,
        notification.title,
        notification.body
      );
    },
    async schedule({ tag, title, body, at }) {
      scheduled.set(tag, { title, body, at });
      log.push({ kind: "scheduled", tag, title, body, at });
      deadlines.schedule({ tag, title, body, at });
    },
    async cancel(tag) {
      deadlines.cancel(tag);
      const wasScheduled = scheduled.delete(tag);
      const wasShowing = active.delete(tag);
      if (wasScheduled || wasShowing) log.push({ kind: "cancelled", tag });
    },
    async cancelAll(prefix) {
      deadlines.cancelAll(prefix);
      const tags = new Set([...scheduled.keys(), ...active.keys()]);
      for (const tag of tags) {
        if (!tag.startsWith(prefix)) continue;
        scheduled.delete(tag);
        active.delete(tag);
        log.push({ kind: "cancelled", tag });
      }
    },
    async exactTiming() {
      return exactTiming;
    },
    onClick(handler) {
      clickHandlers.add(handler);
      return () => {
        clickHandlers.delete(handler);
      };
    },
    click(tag) {
      for (const handler of clickHandlers) handler(tag);
    },
    canScheduleWhileClosed() {
      return canSchedule;
    },
  };

  return adapter;
}
