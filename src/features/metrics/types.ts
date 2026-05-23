export type MetricsCategory = "writing" | "time" | "engagement";

export type EventType =
  | "writing.typed"
  | "writing.deleted"
  | "writing.pasted"
  | "session.started"
  | "session.ended"
  | "session.active"
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

export type MetricPayload =
  | WritingMetricPayload
  | SessionMetricPayload
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
  computedAt: string;
  payload: unknown;
}
