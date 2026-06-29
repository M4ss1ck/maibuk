import { useTranslation } from "react-i18next";
import type { DashboardAggregate, SnapshotMetrics } from "@/features/metrics/aggregates/types";

interface PerWorkListProps {
  snapshot: SnapshotMetrics | null;
  dashboard?: DashboardAggregate | null;
  isLoading?: boolean;
}

export function PerWorkList({ snapshot, dashboard, isLoading = false }: PerWorkListProps) {
  const { t } = useTranslation();
  const activeByWork = new Map(
    (dashboard?.timeByWork ?? []).map((item) => [item.workId, item.activeSec])
  );

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">{t("metrics.perWork")}</h2>
        {isLoading && (
          <span className="text-sm text-muted-foreground">{t("metrics.loadingEvents")}</span>
        )}
      </div>
      <div className="mt-4 divide-y divide-border">
        {(snapshot?.perWork ?? []).map((work) => (
          <div
            key={work.workId}
            className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
          >
            <div className="min-w-0">
              <p className="truncate font-medium">{work.title}</p>
              <p className="text-sm text-muted-foreground">
                {t("metrics.wordsCount", {
                  count: work.wordCount,
                  formattedCount: work.wordCount.toLocaleString(),
                })}
              </p>
            </div>
            <p className="shrink-0 text-sm tabular-nums text-muted-foreground">
              {formatMinutes(activeByWork.get(work.workId) ?? 0)}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function formatMinutes(seconds: number): string {
  return `${Math.round(seconds / 60).toLocaleString()}m`;
}
