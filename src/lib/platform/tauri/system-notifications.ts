import {
  cancel,
  isPermissionGranted,
  removeActive,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
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
    return requestPermission();
  },
  async show({ tag, title, body }): Promise<void> {
    sendNotification({ id: idFor(tag), title, body });
  },
  async cancel(tag): Promise<void> {
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
  },
  // Desktop fires only while Maibuk runs, so nothing is scheduled ahead yet.
  canScheduleWhileClosed(): boolean {
    return false;
  },
};
