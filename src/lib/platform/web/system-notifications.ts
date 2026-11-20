import { createNotificationDeadlines } from "@/lib/platform/notification-deadlines";
import type { SystemNotificationAdapter, SystemNotificationPermission } from "@/lib/platform/types";

/** The notifications this page showed, so a tag can replace or withdraw its own. */
const showing = new Map<string, Notification>();
/** The click handlers the Plugin pages registered, one per page that cares. */
const clickHandlers = new Set<(tag: string) => void>();

function hasNotifications(): boolean {
  return typeof Notification !== "undefined";
}

function showNow({ tag, title, body }: { tag: string; title: string; body: string }): void {
  if (!hasNotifications()) throw new Error("This browser has no System Notifications.");
  // The browser replaces a notification shown with the same tag, but the
  // page's own handle would be lost, so close it before it goes out of reach.
  showing.get(tag)?.close();
  showing.delete(tag);
  // Construction throws outside a service worker on a mobile browser; the
  // rejection is the caller's to surface.
  const notification = new Notification(title, { body, tag });
  notification.onclick = () => {
    window.focus();
    for (const handler of clickHandlers) handler(tag);
  };
  showing.set(tag, notification);
}

/** The page holds its own deadlines, so one fires while the tab is open and no longer. */
const deadlines = createNotificationDeadlines((notification) => {
  try {
    showNow(notification);
  } catch {
    // A deadline has no caller to surface a refused show to.
  }
});

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
  async show(notification): Promise<void> {
    showNow(notification);
  },
  async schedule(notification): Promise<void> {
    deadlines.schedule(notification);
  },
  async cancel(tag): Promise<void> {
    deadlines.cancel(tag);
    showing.get(tag)?.close();
    showing.delete(tag);
  },
  async cancelAll(prefix): Promise<void> {
    deadlines.cancelAll(prefix);
    for (const [tag, notification] of showing) {
      if (!tag.startsWith(prefix)) continue;
      notification.close();
      showing.delete(tag);
    }
  },
  // The page's own timer fires the notification as soon as it is due.
  async exactTiming(): Promise<boolean> {
    return true;
  },
  onClick(handler): () => void {
    clickHandlers.add(handler);
    return () => {
      clickHandlers.delete(handler);
    };
  },
  // No browser fires a notification once its page is closed.
  canScheduleWhileClosed(): boolean {
    return false;
  },
};
