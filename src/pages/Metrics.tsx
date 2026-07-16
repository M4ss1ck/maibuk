import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Heatmap, PerWorkList, StreakCard, TimeOfDay, WpmChart } from "@/components/metrics";
import { getSnapshotMetrics } from "@/features/metrics/events-repo";
import { useSettingsStore } from "@/features/settings/store";
import { getDatabase } from "@/lib/db";
import { metricsService } from "@/lib/metrics/MetricsService";
import type {
  DashboardAggregate,
  HeatmapAggregate,
  SnapshotMetrics,
  StreakAggregate,
} from "@/features/metrics/aggregates/types";

export function Metrics() {
  const { t } = useTranslation();
  const threshold = useSettingsStore((state) => state.metrics.streakDailyWordThreshold);
  const enabled = useSettingsStore((state) => state.metrics.enabled);
  const [snapshot, setSnapshot] = useState<SnapshotMetrics | null>(null);
  const [heatmap, setHeatmap] = useState<HeatmapAggregate | null>(null);
  const [streak, setStreak] = useState<StreakAggregate | null>(null);
  const [dashboard, setDashboard] = useState<DashboardAggregate | null>(null);
  const [eventsLoading, setEventsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void getDatabase()
      .then(getSnapshotMetrics)
      .then((value) => {
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

    if (!enabled.writing && !enabled.time && !enabled.engagement) {
      setHeatmap(null);
      setStreak(null);
      setDashboard(null);
      setEventsLoading(false);
      return () => {
        cancelled = true;
      };
    }

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
  }, [enabled.engagement, enabled.time, enabled.writing, threshold]);

  const allCategoriesDisabled = !enabled.writing && !enabled.time && !enabled.engagement;
  const displayedTotalWords = enabled.writing ? (snapshot?.totalWords ?? 0) : 0;
  const displayedSnapshot = enabled.writing ? snapshot : { totalWords: 0, perWork: [] };

  return (
    <div className="h-full overflow-auto bg-background">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 p-6 md:p-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 data-route-heading className="text-3xl font-semibold tracking-normal">
              {t("metrics.title")}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("metrics.subtitle")}</p>
          </div>
          <div className="rounded-lg border border-border bg-card px-4 py-3 text-right">
            <p className="text-sm text-muted-foreground">{t("metrics.totalWords")}</p>
            <p className="text-3xl font-semibold tabular-nums">
              {displayedTotalWords.toLocaleString()}
            </p>
          </div>
        </header>

        {allCategoriesDisabled ? (
          <section className="rounded-lg border border-border bg-card p-6">
            <p className="text-sm text-muted-foreground">{t("metrics.disabledEmpty")}</p>
          </section>
        ) : (
          <>
            {enabled.writing && (
              <>
                <StreakCard aggregate={streak} isLoading={eventsLoading} />

                <Heatmap aggregate={heatmap} isLoading={eventsLoading} />
              </>
            )}

            <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
              {enabled.engagement ? (
                <WpmChart aggregate={dashboard} isLoading={eventsLoading} />
              ) : (
                <section className="rounded-lg border border-border bg-card p-4">
                  <h2 className="text-lg font-semibold">{t("metrics.wpm")}</h2>
                  <p className="mt-4 text-sm text-muted-foreground">
                    {t("metrics.engagementDisabled")}
                  </p>
                </section>
              )}
              {enabled.time && <TimeOfDay aggregate={dashboard} isLoading={eventsLoading} />}
            </div>

            <PerWorkList
              snapshot={displayedSnapshot}
              dashboard={enabled.time ? dashboard : null}
              isLoading={eventsLoading}
            />
          </>
        )}
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
