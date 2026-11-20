/**
 * The host's System Notification service for Plugins (ADR 0042, #869, #870): the
 * delivery behind the Plugin API's `notifications.system` and
 * `notifications.cancel`, plus the host's own cancel-all when a Plugin stops.
 *
 * The service is pure: it holds the per-Plugin queue, the pending scheduled ids,
 * and the fallback rule, and takes the platform adapter as a dependency. A
 * Plugin's ids are its own (a tag is `<pluginId>/<id>`), so one Plugin can never
 * replace or cancel another's notification. Maibuk allows at most one immediate
 * System Notification per second per Plugin, so a Plugin's sends go through its
 * own chain, one at a time, each waiting out the rest of that second: nothing is
 * dropped, and one Plugin never waits on another. A send with a future `at` goes
 * through that same chain for ordering, but never waits for the second: the OS
 * holds it where it can, and Maibuk's own deadline holds it otherwise. Where the
 * device refuses permission, or showing one fails, the author still sees the
 * notice as Maibuk's toast.
 */

import { createNotificationDeadlines } from "@/lib/platform/notification-deadlines";
import type { SystemNotificationAdapter, SystemNotificationPermission } from "@/lib/platform/types";

/** Maibuk's limit: one immediate System Notification per second, per Plugin (ADR 0042). */
const MIN_GAP_MS = 1000;

/** Maibuk's limit: scheduled System Notifications pending at once, per Plugin (ADR 0042). */
export const MAX_PENDING_SCHEDULED = 20;

const LIMIT_MESSAGE = `At most ${MAX_PENDING_SCHEDULED} scheduled System Notifications can be pending for one Plugin.`;

/** The tag one sent notification is shown under; the Plugin id scopes it. */
export function systemNotificationTag(pluginId: string, id: string): string {
  return `${pluginId}/${id}`;
}

/** What the service exposes to the Plugin API's notification methods. */
export interface PluginSystemNotifications {
  /**
   * Shows one now, or at `at` (ms since the epoch) when that is still ahead,
   * falling back to Maibuk's toast; a second send with the same id replaces the
   * earlier one. Resolves null, or the limit error when the Plugin already has
   * MAX_PENDING_SCHEDULED ones pending.
   */
  send(
    plugin: { id: string; name: string },
    notification: { id: string; title: string; body: string; at?: number }
  ): Promise<null | { error: "limit"; message: string }>;
  /** Withdraws one, scheduled or shown; resolves once the platform withdrew it, or the device refused to. */
  cancel(pluginId: string, id: string): Promise<null>;
  /**
   * Withdraws every scheduled and shown one of a Plugin, at once. The host calls
   * this when the Plugin is disabled, removed, or loses `system-notifications`.
   */
  cancelPlugin(pluginId: string): Promise<null>;
  /**
   * The OS's answer now, whether the OS fires one while Maibuk is closed, and
   * whether a scheduled one fires on time.
   */
  status(): Promise<{
    permission: SystemNotificationPermission;
    canScheduleWhileClosed: boolean;
    exactTiming: boolean;
  }>;
  /** Asks the OS, which the web allows only inside a user action. */
  requestPermission(): Promise<{ permission: SystemNotificationPermission }>;
  /**
   * Calls `handler` with the Plugin id of a clicked one, after Maibuk came to the
   * front; returns the unsubscribe. A tag without a "/" belongs to no Plugin.
   */
  onClick(handler: (pluginId: string) => void): () => void;
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
 * `cancelPlugin` runs at once, outside the chain, because the Plugin is gone; a
 * send it still had queued finds itself stale and shows nothing.
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
  /** Each Plugin's scheduled ids still pending, and whether Maibuk holds the deadline. */
  const pending = new Map<string, Map<string, { viaHost: boolean }>>();
  /** Each Plugin's name, for the host deadline, which only carries the tag. */
  const pluginNames = new Map<string, string>();
  /**
   * Bumped by cancelPlugin, so a send still queued from before it finds itself
   * stale and shows nothing: a Plugin that was turned off never rings again.
   */
  const generations = new Map<string, number>();

  /** True once cancelPlugin ran for the Plugin after this was called. */
  function staleCheck(pluginId: string): () => boolean {
    const generation = generations.get(pluginId) ?? 0;
    return () => (generations.get(pluginId) ?? 0) !== generation;
  }

  /**
   * One deadline table for both kinds, keyed by tag: an OS-held one only frees
   * its pending slot when it passes, and a host-held one also shows it then.
   */
  const deadlines = createNotificationDeadlines((notification) => {
    const slash = notification.tag.indexOf("/");
    if (slash <= 0) return;
    const pluginId = notification.tag.slice(0, slash);
    const id = notification.tag.slice(slash + 1);
    const entry = dropPending(pluginId, id);
    if (!entry?.viaHost) return;
    const plugin = { id: pluginId, name: pluginNames.get(pluginId) ?? pluginId };
    const stale = staleCheck(pluginId);
    void enqueue(pluginId, () =>
      sendQueued(plugin, { id, title: notification.title, body: notification.body }, stale)
    ).catch(() => undefined);
  });

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

  function dropPending(pluginId: string, id: string): { viaHost: boolean } | undefined {
    const entries = pending.get(pluginId);
    const entry = entries?.get(id);
    if (!entries || !entry) return undefined;
    entries.delete(id);
    if (entries.size === 0) pending.delete(pluginId);
    return entry;
  }

  async function permissionGranted(): Promise<boolean> {
    return deps.adapter.permission().then(
      (permission) => permission === "granted",
      () => false
    );
  }

  /** Drops a pending scheduled one before the same id shows now, so it replaces it. */
  async function withdrawPending(pluginId: string, id: string): Promise<void> {
    if (!dropPending(pluginId, id)) return;
    const tag = systemNotificationTag(pluginId, id);
    deadlines.cancel(tag);
    try {
      await deps.adapter.cancel(tag);
    } catch {
      // An unknown tag is not an error, and neither is a device that refuses.
    }
  }

  async function deliver(
    plugin: { id: string; name: string },
    notification: { id: string; title: string; body: string }
  ): Promise<null> {
    const tag = systemNotificationTag(plugin.id, notification.id);
    const title = `${plugin.name}: ${notification.title}`;
    if (await permissionGranted()) {
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
    notification: { id: string; title: string; body: string },
    stale: () => boolean
  ): Promise<null> {
    if (stale()) return null;
    await withdrawPending(plugin.id, notification.id);
    const previous = deliveredAt.get(plugin.id);
    if (previous !== undefined) {
      const remaining = MIN_GAP_MS - (now() - previous);
      if (remaining > 0) await wait(remaining);
    }
    if (stale()) return null;
    const sent = await deliver(plugin, notification);
    deliveredAt.set(plugin.id, now());
    return sent;
  }

  async function scheduleSend(
    plugin: { id: string; name: string },
    notification: { id: string; title: string; body: string },
    at: number,
    stale: () => boolean
  ): Promise<null | { error: "limit"; message: string }> {
    if (stale()) return null;
    // Its time can pass while it waits behind the one-second budget, and the
    // OS drops a past time, so it shows now instead.
    if (at <= now()) return sendQueued(plugin, notification, stale);
    const entries = pending.get(plugin.id);
    const replacing = entries?.has(notification.id) ?? false;
    if (!replacing && (entries?.size ?? 0) >= MAX_PENDING_SCHEDULED) {
      return { error: "limit", message: LIMIT_MESSAGE };
    }
    const tag = systemNotificationTag(plugin.id, notification.id);
    let viaHost = !(await permissionGranted());
    if (!viaHost) {
      try {
        await deps.adapter.schedule({
          tag,
          title: `${plugin.name}: ${notification.title}`,
          body: notification.body,
          at,
        });
      } catch {
        // The OS cannot hold this one; Maibuk's deadline shows it instead.
        viaHost = true;
      }
    }
    if (stale()) {
      // cancelPlugin ran while the device was scheduling it.
      if (!viaHost) await deps.adapter.cancel(tag).catch(() => undefined);
      return null;
    }
    // Switching from an OS-held one to a host-held one must withdraw the OS one.
    if (viaHost && entries?.get(notification.id)?.viaHost === false) {
      try {
        await deps.adapter.cancel(tag);
      } catch {
        // An unknown tag is not an error, and neither is a device that refuses.
      }
    }
    const map = entries ?? new Map<string, { viaHost: boolean }>();
    map.set(notification.id, { viaHost });
    pending.set(plugin.id, map);
    pluginNames.set(plugin.id, plugin.name);
    deadlines.schedule({ tag, title: notification.title, body: notification.body, at });
    return null;
  }

  return {
    send(plugin, notification) {
      const at = notification.at;
      const stale = staleCheck(plugin.id);
      if (at !== undefined && at > now()) {
        return enqueue(plugin.id, () => scheduleSend(plugin, notification, at, stale));
      }
      return enqueue(plugin.id, () => sendQueued(plugin, notification, stale));
    },
    cancel(pluginId, id) {
      return enqueue(pluginId, async () => {
        const tag = systemNotificationTag(pluginId, id);
        dropPending(pluginId, id);
        deadlines.cancel(tag);
        try {
          await deps.adapter.cancel(tag);
        } catch {
          // An unknown tag is not an error, and neither is a device that refuses.
        }
        return null;
      });
    },
    async cancelPlugin(pluginId) {
      generations.set(pluginId, (generations.get(pluginId) ?? 0) + 1);
      pending.delete(pluginId);
      pluginNames.delete(pluginId);
      deadlines.cancelAll(`${pluginId}/`);
      try {
        await deps.adapter.cancelAll(`${pluginId}/`);
      } catch {
        // A device that refuses to withdraw is not an error for the caller.
      }
      return null;
    },
    async status() {
      let exactTiming = false;
      try {
        exactTiming = await deps.adapter.exactTiming();
      } catch {
        // A device that cannot say is treated as inexact.
      }
      return {
        permission: await deps.adapter.permission(),
        canScheduleWhileClosed: deps.adapter.canScheduleWhileClosed(),
        exactTiming,
      };
    },
    async requestPermission() {
      return { permission: await deps.adapter.requestPermission() };
    },
    onClick(handler) {
      return deps.adapter.onClick((tag) => {
        const slash = tag.indexOf("/");
        if (slash <= 0) return;
        handler(tag.slice(0, slash));
      });
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
