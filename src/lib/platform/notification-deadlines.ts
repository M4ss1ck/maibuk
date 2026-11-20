/**
 * The host-held deadlines behind a System Notification the OS cannot hold
 * (ADR 0042). They fire only while Maibuk runs and do not survive a restart, so
 * a caller that needs a closed app uses the OS instead.
 *
 * Reads the clock through `Date.now`, so a test can drive the deadlines with
 * fake timers.
 */

export interface NotificationDeadline {
  tag: string;
  title: string;
  body: string;
  /** Milliseconds since the epoch. */
  at: number;
}

export interface NotificationDeadlines {
  /** Arms or re-arms the deadline for the notification's tag. */
  schedule(notification: NotificationDeadline): void;
  /** Drops the deadline for `tag`, if there is one. */
  cancel(tag: string): void;
  /** Drops every deadline whose tag starts with `prefix`. */
  cancelAll(prefix: string): void;
}

/** `setTimeout`'s maximum delay, a 32-bit signed millisecond count (about 24.8 days). */
const MAX_TIMER_DELAY_MS = 2_147_483_647;

interface Entry {
  notification: NotificationDeadline;
  timer: ReturnType<typeof setTimeout> | undefined;
}

export function createNotificationDeadlines(
  fire: (notification: NotificationDeadline) => void
): NotificationDeadlines {
  const entries = new Map<string, Entry>();

  /**
   * Arms the entry's timer, stepping a deadline past the timer maximum, which
   * would otherwise fire at once.
   */
  function arm(entry: Entry): void {
    const remaining = entry.notification.at - Date.now();
    if (remaining > MAX_TIMER_DELAY_MS) {
      entry.timer = setTimeout(() => {
        arm(entry);
      }, MAX_TIMER_DELAY_MS);
      return;
    }
    entry.timer = setTimeout(
      () => {
        if (entries.get(entry.notification.tag) === entry) entries.delete(entry.notification.tag);
        fire(entry.notification);
      },
      Math.max(remaining, 0)
    );
  }

  return {
    schedule(notification) {
      const existing = entries.get(notification.tag);
      if (existing) clearTimeout(existing.timer);
      const entry: Entry = { notification, timer: undefined };
      entries.set(notification.tag, entry);
      arm(entry);
    },
    cancel(tag) {
      const entry = entries.get(tag);
      if (!entry) return;
      clearTimeout(entry.timer);
      entries.delete(tag);
    },
    cancelAll(prefix) {
      for (const [tag, entry] of entries) {
        if (!tag.startsWith(prefix)) continue;
        clearTimeout(entry.timer);
        entries.delete(tag);
      }
    },
  };
}
