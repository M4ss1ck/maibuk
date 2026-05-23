export const METRICS_AGGREGATE_VERSION = 1;
export const METRICS_AGGREGATE_PAGE_SIZE = 10_000;

export type AggregateKey =
  | `heatmap:${number}`
  | "streak:current"
  | "dashboard:last30d";

export interface HeatmapDay {
  date: string;
  words: number;
  events: number;
}

export interface HeatmapAggregate {
  days: HeatmapDay[];
}

export interface StreakAggregate {
  currentStreak: number;
  longestStreak: number;
  daysThisWeek: number;
  daysThisMonth: number;
}

export interface TimeOfDayBucket {
  hour: number;
  words: number;
}

export interface WorkTimeBucket {
  workId: string;
  activeSec: number;
}

export interface DashboardAggregate {
  typedWords: number;
  deletedWords: number;
  pastedWords: number;
  netWords: number;
  editRatio: number;
  activeSec: number;
  deepestSessionSec: number;
  wpm: number;
  timeOfDay: TimeOfDayBucket[];
  timeByWork: WorkTimeBucket[];
}

export type AggregatePayload =
  | HeatmapAggregate
  | StreakAggregate
  | DashboardAggregate;

export interface AggregateParams {
  today?: string;
  dailyWordThreshold?: number;
}

export interface SnapshotWorkMetric {
  workId: string;
  title: string;
  wordCount: number;
}

export interface SnapshotMetrics {
  totalWords: number;
  perWork: SnapshotWorkMetric[];
}
