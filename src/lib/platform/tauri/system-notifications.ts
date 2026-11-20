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

async function handleClick(event: ActionPerformed): Promise<void> {
  if (event.actionId !== "tap") return;
  const reported = event.notification;
  const tag = reported?.data?.tag ?? tagsById.get(reported?.id ?? -1);
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
  void onAction((event) => {
    void handleClick(event);
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
    sendNotification({ id: idFor(tag), title, body, extra: { tag } });
  },
  async schedule({ tag, title, body, at }): Promise<void> {
    if (!IS_ANDROID) {
      deadlines.schedule({ tag, title, body, at });
      return;
    }
    // Only Android's OS holds a future notification across a restart.
    sendNotification({
      id: idFor(tag),
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
