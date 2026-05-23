import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Heatmap,
  PerWorkList,
  StreakCard,
  TimeOfDay,
  WpmChart,
} from "../components/metrics";
import { getSnapshotMetrics } from "../features/metrics/events-repo";
import { useSettingsStore } from "../features/settings/store";
import { getDatabase } from "../lib/db";
import { metricsService } from "../lib/metrics/MetricsService";
import type {
  DashboardAggregate,
  HeatmapAggregate,
  SnapshotMetrics,
  StreakAggregate,
} from "../features/metrics/aggregates/types";

export function Metrics() {
  const { t } = useTranslation();
  const threshold = useSettingsStore(
    (state) => state.metrics.streakDailyWordThreshold,
  );
  const [snapshot, setSnapshot] = useState<SnapshotMetrics | null>(null);
  const [heatmap, setHeatmap] = useState<HeatmapAggregate | null>(null);
  const [streak, setStreak] = useState<StreakAggregate | null>(null);
  const [dashboard, setDashboard] = useState<DashboardAggregate | null>(null);
  const [eventsLoading, setEventsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void getDatabase().then(getSnapshotMetrics).then((value) => {
      if (!cancelled) setSnapshot(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const year = new Date().getFullYear();
    const today = formatLocalDate(new Date());

    setEventsLoading(true);
    void Promise.all([
      metricsService.getAggregate(`heatmap:${year}`),
      metricsService.getAggregate("streak:current", {
        today,
        dailyWordThreshold: threshold,
      }),
      metricsService.getAggregate("dashboard:last30d"),
    ]).then(([heatmapPayload, streakPayload, dashboardPayload]) => {
      if (cancelled) return;
      setHeatmap(heatmapPayload as HeatmapAggregate);
      setStreak(streakPayload as StreakAggregate);
      setDashboard(dashboardPayload as DashboardAggregate);
      setEventsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [threshold]);

  return (
    <div className="h-full overflow-auto bg-background">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 p-6 md:p-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-normal">
              {t("metrics.title")}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("metrics.subtitle")}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-card px-4 py-3 text-right">
            <p className="text-sm text-muted-foreground">{t("metrics.totalWords")}</p>
            <p className="text-3xl font-semibold tabular-nums">
              {(snapshot?.totalWords ?? 0).toLocaleString()}
            </p>
          </div>
        </header>

        <StreakCard aggregate={streak} isLoading={eventsLoading} />

        <Heatmap aggregate={heatmap} isLoading={eventsLoading} />

        <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
          <WpmChart aggregate={dashboard} isLoading={eventsLoading} />
          <TimeOfDay aggregate={dashboard} isLoading={eventsLoading} />
        </div>

        <PerWorkList
          snapshot={snapshot}
          dashboard={dashboard}
          isLoading={eventsLoading}
        />
      </div>
    </div>
  );
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
