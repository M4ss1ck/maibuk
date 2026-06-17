// `writing` and `time` are *data-collection* categories — toggling them off
// stops the corresponding events from being written and purges existing rows.
// `engagement` is a *view-only* preference — it controls whether the WPM /
// dashboard section is rendered on /metrics. There are no `engagement.*`
// event types; engagement metrics are derived from `session.*` (gated by
// `time`).
export type MetricsCategory = "writing" | "time" | "engagement";

export type EventType =
  | "writing.typed"
  | "writing.deleted"
  | "writing.pasted"
  | "session.started"
  | "session.ended"
  | "session.active"
  | "aggregate.daily"
  | "ai.inserted" // reserved -- not emitted in v1
  | "ai.edited"; // reserved -- not emitted in v1

export interface WritingMetricPayload {
  words: number;
  chars: number;
  chapterId: string | null;
}

export interface SessionMetricPayload {
  sessionId: string;
  durationSec?: number;
  activeSec?: number;
  deepestStreakSec?: number;
}

export interface DailyAggregateMetricPayload {
  bucket: "daily-v1";
  date: string;
  rawEvents: number;
  sourceEventIds?: string[];
  typedWords: number;
  deletedWords: number;
  pastedWords: number;
  activeSec: number;
  deepestSessionSec: number;
  timeOfDay: { hour: number; words: number }[];
  timeByWork: { workId: string; activeSec: number }[];
}

export type MetricPayload =
  | WritingMetricPayload
  | SessionMetricPayload
  | DailyAggregateMetricPayload
  | Record<string, string | number | boolean | null | undefined>;

export interface MetricEvent {
  id: string;
  timestamp: string;
  localDate: string;
  tzOffsetMin: number;
  deviceId: string;
  eventType: EventType;
  workId: string | null;
  payload: MetricPayload;
  schemaVersion: number;
}

export interface MetricsSettings {
  enabled: Record<MetricsCategory, boolean>;
  syncMetrics: boolean;
  streakDailyWordThreshold: number;
  idleThresholdSec: number;
}

export interface MetricsCacheEntry {
  cacheKey: string;
  aggregateVersion: number;
  sourceHighWatermark: string;
  windowStart: string;
  computedAt: string;
  payload: unknown;
}
