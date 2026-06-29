import type { MetricEvent } from "@/features/metrics/types";

type RecordEvents = (events: MetricEvent[]) => void;

interface SessionTrackerOptions {
  workId: string | null;
  deviceId: string;
  recordEvents: RecordEvents;
  idleThresholdSec: number;
}

export class SessionTracker {
  private sessionId: string | null = null;
  private startedAt: Date | null = null;
  private lastActiveAt: Date | null = null;

  constructor(private options: SessionTrackerOptions) {}

  start(now = new Date()): void {
    if (this.sessionId) return;
    this.sessionId = crypto.randomUUID();
    this.startedAt = now;
    this.lastActiveAt = now;
    this.options.recordEvents([
      this.buildEvent("session.started", { sessionId: this.sessionId }, now),
    ]);
  }

  markActive(now = new Date()): void {
    if (!this.sessionId) this.start(now);
    this.lastActiveAt = now;
  }

  end(now = new Date()): void {
    if (!this.sessionId || !this.startedAt) return;
    const durationSec = Math.max(0, Math.floor((now.getTime() - this.startedAt.getTime()) / 1000));
    const activeSec = this.lastActiveAt
      ? Math.min(
          durationSec,
          Math.max(0, Math.floor((this.lastActiveAt.getTime() - this.startedAt.getTime()) / 1000)) +
            this.options.idleThresholdSec
        )
      : 0;

    this.options.recordEvents([
      this.buildEvent(
        "session.ended",
        { sessionId: this.sessionId, durationSec, activeSec, deepestStreakSec: activeSec },
        now
      ),
      this.buildEvent("session.active", { sessionId: this.sessionId, activeSec }, now),
    ]);
    this.sessionId = null;
    this.startedAt = null;
    this.lastActiveAt = null;
  }

  private buildEvent(
    eventType: "session.started" | "session.ended" | "session.active",
    payload: Record<string, string | number>,
    now: Date
  ): MetricEvent {
    return {
      id: crypto.randomUUID(),
      timestamp: now.toISOString(),
      localDate: formatLocalDate(now),
      tzOffsetMin: -now.getTimezoneOffset(),
      deviceId: this.options.deviceId,
      eventType,
      workId: this.options.workId,
      payload,
      schemaVersion: 1,
    };
  }
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
