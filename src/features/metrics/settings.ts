import type { MetricsCategory, MetricsSettings } from "./types";

export const METRICS_DEV_DISABLED_KEY = "maibuk.metrics.disabled";

export const DEFAULT_METRICS_SETTINGS: MetricsSettings = {
  enabled: { writing: true, time: true, engagement: true },
  syncMetrics: false,
  streakDailyWordThreshold: 50,
  idleThresholdSec: 30,
};

export function normalizeMetrics(value: unknown): MetricsSettings {
  const candidate = (value && typeof value === "object" ? value : {}) as Partial<MetricsSettings>;
  const enabled = (
    candidate.enabled && typeof candidate.enabled === "object" ? candidate.enabled : {}
  ) as Partial<Record<MetricsCategory, unknown>>;

  return {
    enabled: {
      writing:
        typeof enabled.writing === "boolean"
          ? enabled.writing
          : DEFAULT_METRICS_SETTINGS.enabled.writing,
      time:
        typeof enabled.time === "boolean" ? enabled.time : DEFAULT_METRICS_SETTINGS.enabled.time,
      engagement:
        typeof enabled.engagement === "boolean"
          ? enabled.engagement
          : DEFAULT_METRICS_SETTINGS.enabled.engagement,
    },
    syncMetrics: candidate.syncMetrics === true,
    streakDailyWordThreshold: coercePositiveInt(
      candidate.streakDailyWordThreshold,
      DEFAULT_METRICS_SETTINGS.streakDailyWordThreshold
    ),
    idleThresholdSec: coercePositiveInt(
      candidate.idleThresholdSec,
      DEFAULT_METRICS_SETTINGS.idleThresholdSec
    ),
  };
}

export function isMetricsDevDisabled(): boolean {
  try {
    return localStorage.getItem(METRICS_DEV_DISABLED_KEY) === "true";
  } catch {
    return false;
  }
}

function coercePositiveInt(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}
