import { useTranslation } from "react-i18next";
import type { StreakAggregate } from "@/features/metrics/aggregates/types";

interface StreakCardProps {
  aggregate: StreakAggregate | null;
  isLoading: boolean;
}

export function StreakCard({ aggregate, isLoading }: StreakCardProps) {
  const { t } = useTranslation();
  const items = [
    ["metrics.currentStreak", aggregate?.currentStreak ?? 0],
    ["metrics.longestStreak", aggregate?.longestStreak ?? 0],
    ["metrics.daysThisWeek", aggregate?.daysThisWeek ?? 0],
    ["metrics.daysThisMonth", aggregate?.daysThisMonth ?? 0],
  ] as const;

  return (
    <section className="grid gap-3 @sm:grid-cols-2 @4xl:grid-cols-4">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">{t(label)}</p>
          <p className="mt-2 text-3xl font-semibold tabular-nums">
            {isLoading ? "..." : value.toLocaleString()}
          </p>
        </div>
      ))}
    </section>
  );
}
