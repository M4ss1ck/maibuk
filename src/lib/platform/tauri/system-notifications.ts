import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Schedule,
  cancel,
  isPermissionGranted,
  onAction,
  removeActive,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import type { ActionPerformed } from "@tauri-apps/plugin-notification";
import { IS_ANDROID } from "@/lib/platform";
import { createNotificationDeadlines } from "@/lib/platform/notification-deadlines";
import type { SystemNotificationAdapter, SystemNotificationPermission } from "@/lib/platform/types";

/**
 * The plugin ids a notification by number, and two tags that hashed to the same
 * number would replace each other. FNV-1a keeps that rare; the mask keeps the
 * result a positive 31-bit integer, which is the plugin's limit.
 */
export function notificationId(tag: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < tag.length; index += 1) {
    hash ^= tag.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  const positive = hash & 0x7fffffff;
  return positive || 1;
}

/** Which tag holds each id this run, so two tags that hash alike never share one. */
const tagsById = new Map<number, string>();

/**
 * The id a tag is shown under: its hash, or the next free id when another tag
 * already holds that hash, so one Plugin can never pick an id that reaches
 * another's notification.
 */
function idFor(tag: string): number {
  let id = notificationId(tag);
  for (;;) {
    const holder = tagsById.get(id);
    if (holder === undefined || holder === tag) break;
    id = (id % 0x7fffffff) + 1;
  }
  tagsById.set(id, tag);
  return id;
}

/**
 * The Android deadlines the OS holds, so a later run can withdraw them: the tag
 * table above is this run's, and a Plugin disabled after a restart still needs
 * its scheduled ones cancelled.
 */
const SCHEDULED_KEY = "maibuk.systemNotifications.scheduled";

function readScheduled(): Record<string, number> {
  try {
    const raw = localStorage.getItem(SCHEDULED_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const now = Date.now();
    const kept: Record<string, number> = {};
    for (const [tag, at] of Object.entries(parsed)) {
      if (typeof at === "number" && at > now) kept[tag] = at;
    }
    return kept;
  } catch {
    return {};
  }
}

function writeScheduled(records: Record<string, number>): void {
  try {
    localStorage.setItem(SCHEDULED_KEY, JSON.stringify(records));
  } catch {
    // Storage is best effort; an absent or full one only loses the record.
  }
}

function recordScheduled(tag: string, at: number): void {
  writeScheduled({ ...readScheduled(), [tag]: at });
}

function forgetScheduled(tag: string): void {
  const records = readScheduled();
  if (!(tag in records)) return;
  delete records[tag];
  writeScheduled(records);
}

/**
 * Which tag each Android id was sent under, kept across runs: the plugin's tap
 * event names no notification, so a tap is resolved from the id MainActivity
 * hands over, possibly in a later run. The newest 200 are kept.
 */
const IDS_KEY = "maibuk.systemNotifications.ids";
const MAX_REMEMBERED_IDS = 200;

function readIds(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(IDS_KEY) ?? "{}");
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function rememberId(id: number, tag: string): void {
  const ids = readIds();
  delete ids[id];
  ids[id] = tag;
  const kept = Object.entries(ids).slice(-MAX_REMEMBERED_IDS);
  try {
    localStorage.setItem(IDS_KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    // Storage is best effort; a lost entry only loses that tap's page.
  }
}

/** Withdraws both the pending (scheduled) and the shown one for a tag. */
async function withdraw(tag: string): Promise<void> {
  const id = idFor(tag);
  // A pending one is a scheduled one, which only Android has; elsewhere the
  // call fails, and there is nothing to cancel.
  try {
    await cancel([id]);
  } catch {
    // Unsupported on every desktop platform.
  }
  // A shown one stays in the notification centre until the OS dismisses it.
  try {
    await removeActive([{ id }]);
  } catch {
    // Unsupported on most platforms.
  }
  forgetScheduled(tag);
}

/** Whether Android may fire a scheduled one on time; it falls back to minutes late. */
async function exactAlarmsAllowed(): Promise<boolean> {
  try {
    return await invoke<boolean>("exact_alarms_allowed");
  } catch {
    return false;
  }
}

/** The click handlers the Plugin pages registered. */
const clickHandlers = new Set<(tag: string) => void>();
let listeningForClicks = false;

/** MainActivity's bridge to the id of the notification the author tapped (#870). */
interface NotificationTapBridge {
  /** The tapped id once, then -1 until the next tap. */
  take(): number;
}

/** Hands an Android tap from MainActivity's bridge to the handlers. */
function takeAndroidTap(): void {
  // Leave the tap for a later subscriber rather than drop it.
  if (clickHandlers.size === 0) return;
  const bridge = (
    globalThis.window as { MaibukNotificationTaps?: NotificationTapBridge } | undefined
  )?.MaibukNotificationTaps;
  const id = bridge?.take() ?? -1;
  if (id < 0) return;
  const tag = tagsById.get(id) ?? readIds()[id];
  if (tag) for (const handler of clickHandlers) handler(tag);
}

async function handleClick(event: ActionPerformed): Promise<void> {
  if (event.actionId !== "tap") return;
  const reported = event.notification as
    | (ActionPerformed["notification"] & { extra?: { tag?: unknown } })
    | null;
  const sent = reported?.extra?.tag ?? reported?.data?.tag;
  const tag = typeof sent === "string" ? sent : tagsById.get(reported?.id ?? -1);
  if (!tag) return;
  if (!IS_ANDROID) {
    // Desktop may hand the click to an app that is behind or minimized.
    const window = getCurrentWindow();
    try {
      await window.unminimize();
    } catch {
      // Not every desktop window manager allows it.
    }
    try {
      await window.show();
    } catch {
      // Already shown, or the platform refuses.
    }
    try {
      await window.setFocus();
    } catch {
      // Already focused, or the platform refuses.
    }
  }
  for (const handler of clickHandlers) handler(tag);
}

/** Registers the OS listener once, however many handlers subscribe. */
function listenForClicks(): void {
  if (listeningForClicks) return;
  listeningForClicks = true;
  if (IS_ANDROID) {
    // A cold-start tap is waiting already; a warm one is signalled by
    // MainActivity, and coming back to the app covers a missed signal.
    globalThis.window?.addEventListener("maibuk:notification-tap", takeAndroidTap);
    globalThis.document?.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") takeAndroidTap();
    });
    queueMicrotask(takeAndroidTap);
    return;
  }
  onAction((event) => {
    void handleClick(event);
  }).catch(() => {
    // No listener without the Tauri runtime; the next subscriber tries again.
    listeningForClicks = false;
  });
}

/** Where no OS holds a future notification, Maibuk keeps the deadline itself. */
const deadlines = createNotificationDeadlines((notification) => {
  void tauriSystemNotifications.show(notification).catch(() => {
    // A deadline has no caller to surface a refused show to.
  });
});

/** The OS notification, through the notification plugin (ADR 0042). */
export const tauriSystemNotifications: SystemNotificationAdapter = {
  async permission(): Promise<SystemNotificationPermission> {
    // The plugin's Notification shim holds the OS's full answer once it is not
    // "default"; the plugin's own read is only a boolean, which cannot say denied.
    const answer = globalThis.window?.Notification?.permission;
    if (answer === "granted" || answer === "denied") return answer;
    return (await isPermissionGranted()) ? "granted" : "default";
  },
  async requestPermission(): Promise<SystemNotificationPermission> {
    const answer = await requestPermission();
    // Without exact alarms Android may fire a deadline minutes late, so ask once
    // the OS granted notifications at all.
    if (IS_ANDROID && answer === "granted" && !(await exactAlarmsAllowed())) {
      try {
        await invoke("request_exact_alarms");
      } catch {
        // The author declined, or the platform cannot ask.
      }
    }
    return answer;
  },
  async show({ tag, title, body }): Promise<void> {
    const id = idFor(tag);
    if (IS_ANDROID) rememberId(id, tag);
    sendNotification({ id, title, body, extra: { tag } });
  },
  async schedule({ tag, title, body, at }): Promise<void> {
    if (!IS_ANDROID) {
      deadlines.schedule({ tag, title, body, at });
      return;
    }
    // Only Android's OS holds a future notification across a restart.
    const id = idFor(tag);
    rememberId(id, tag);
    sendNotification({
      id,
      title,
      body,
      extra: { tag },
      schedule: Schedule.at(new Date(at), false, true),
    });
    recordScheduled(tag, at);
  },
  async cancel(tag): Promise<void> {
    deadlines.cancel(tag);
    await withdraw(tag);
  },
  async cancelAll(prefix): Promise<void> {
    deadlines.cancelAll(prefix);
    // A recorded tag can outlive the run that scheduled it, so both sources count.
    const tags = new Set<string>();
    for (const tag of tagsById.values()) {
      if (tag.startsWith(prefix)) tags.add(tag);
    }
    for (const tag of Object.keys(readScheduled())) {
      if (tag.startsWith(prefix)) tags.add(tag);
    }
    for (const tag of tags) await withdraw(tag);
  },
  async exactTiming(): Promise<boolean> {
    if (!IS_ANDROID) return true;
    return exactAlarmsAllowed();
  },
  onClick(handler): () => void {
    clickHandlers.add(handler);
    listenForClicks();
    return () => {
      clickHandlers.delete(handler);
    };
  },
  // Only Android's OS holds a notification after Maibuk closes.
  canScheduleWhileClosed(): boolean {
    return IS_ANDROID;
  },
};
