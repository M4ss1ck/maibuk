import { useTranslation } from "react-i18next";
import type { DashboardAggregate } from "@/features/metrics/aggregates/types";

interface WpmChartProps {
  aggregate: DashboardAggregate | null;
  isLoading: boolean;
}

type WpmMetricKey =
  | "metrics.wpm"
  | "metrics.netWords"
  | "metrics.editRatio"
  | "metrics.deepestSession";

export function WpmChart({ aggregate, isLoading }: WpmChartProps) {
  const { t } = useTranslation();
  const rows: { key: WpmMetricKey; value: number }[] = [
    { key: "metrics.wpm", value: aggregate?.wpm ?? 0 },
    { key: "metrics.netWords", value: aggregate?.netWords ?? 0 },
    { key: "metrics.editRatio", value: Math.round((aggregate?.editRatio ?? 0) * 100) },
    { key: "metrics.deepestSession", value: Math.round((aggregate?.deepestSessionSec ?? 0) / 60) },
  ];

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="text-lg font-semibold">{t("metrics.wpm")}</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.key}>
            <p className="text-sm text-muted-foreground">{t(row.key)}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {isLoading ? "..." : row.value.toLocaleString()}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
