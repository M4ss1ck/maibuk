import { useTranslation } from "react-i18next";
import type { DashboardAggregate } from "../../features/metrics/aggregates/types";

interface TimeOfDayProps {
  aggregate: DashboardAggregate | null;
  isLoading: boolean;
}

export function TimeOfDay({ aggregate, isLoading }: TimeOfDayProps) {
  const { t } = useTranslation();
  const buckets = aggregate?.timeOfDay ?? [];
  const maxWords = Math.max(1, ...buckets.map((bucket) => Math.abs(bucket.words)));

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="text-lg font-semibold">{t("metrics.timeOfDay")}</h2>
      {isLoading ? (
        <p className="mt-4 text-sm text-muted-foreground">{t("metrics.loadingEvents")}</p>
      ) : buckets.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">{t("metrics.noActivity")}</p>
      ) : (
        <div className="mt-4 space-y-2">
          {buckets.map((bucket) => (
            <div
              key={bucket.hour}
              className="grid grid-cols-[3rem_1fr_4rem] items-center gap-3 text-sm"
            >
              <span className="tabular-nums text-muted-foreground">
                {String(bucket.hour).padStart(2, "0")}:00
              </span>
              <div className="h-2 rounded-full bg-muted">
                <div
                  className="h-2 rounded-full bg-primary"
                  style={{ width: `${Math.max(4, (Math.abs(bucket.words) / maxWords) * 100)}%` }}
                />
              </div>
              <span className="text-right tabular-nums">{bucket.words.toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
