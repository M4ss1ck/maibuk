import type { SystemNotificationAdapter, SystemNotificationPermission } from "@/lib/platform/types";

/** The notifications this page showed, so a tag can replace or withdraw its own. */
const showing = new Map<string, Notification>();

function hasNotifications(): boolean {
  return typeof Notification !== "undefined";
}

/**
 * The Web Notifications API. A tab with no user gesture cannot ask for
 * permission, and a mobile browser refuses `new Notification()` outside a
 * service worker, so both cases surface to the caller rather than silently
 * doing nothing.
 */
export const webSystemNotifications: SystemNotificationAdapter = {
  async permission(): Promise<SystemNotificationPermission> {
    if (!hasNotifications()) return "denied";
    return Notification.permission;
  },
  async requestPermission(): Promise<SystemNotificationPermission> {
    if (!hasNotifications()) return "denied";
    return Notification.requestPermission();
  },
  async show({ tag, title, body }): Promise<void> {
    if (!hasNotifications()) throw new Error("This browser has no System Notifications.");
    // The browser replaces a notification shown with the same tag, but the
    // page's own handle would be lost, so close it before it goes out of reach.
    showing.get(tag)?.close();
    showing.delete(tag);
    // Construction throws outside a service worker on a mobile browser; the
    // rejection is the caller's to surface.
    showing.set(tag, new Notification(title, { body, tag }));
  },
  async cancel(tag): Promise<void> {
    showing.get(tag)?.close();
    showing.delete(tag);
  },
  // No browser fires a notification once its page is closed.
  canScheduleWhileClosed(): boolean {
    return false;
  },
};
