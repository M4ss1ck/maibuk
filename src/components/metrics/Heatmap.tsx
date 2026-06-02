import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { HeatmapAggregate } from "../../features/metrics/aggregates/types";

interface HeatmapProps {
  aggregate: HeatmapAggregate | null;
  isLoading: boolean;
}

export function Heatmap({ aggregate, isLoading }: HeatmapProps) {
  const { t } = useTranslation();
  const days = useMemo(() => buildDays(new Date().getFullYear(), aggregate), [aggregate]);
  const maxWords = Math.max(1, ...days.map((day) => day.words));

  return (
    <section>
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-lg font-semibold">{t("metrics.heatmap")}</h2>
        {isLoading && (
          <span className="text-sm text-muted-foreground">
            {t("metrics.loadingEvents")}
          </span>
        )}
      </div>
      <div className="overflow-x-auto">
        <div
          className="grid grid-flow-col grid-rows-7 gap-1 min-w-[760px]"
          role="img"
          aria-label={t("metrics.heatmap")}
        >
          {days.map((day) => (
            <div
              key={day.date}
              title={`${day.date}: ${day.words.toLocaleString()} ${t("common.words")}`}
              className={`aspect-square rounded-sm ${getIntensityClass(day.words, maxWords)}`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function buildDays(year: number, aggregate: HeatmapAggregate | null) {
  const byDate = new Map(
    (aggregate?.days ?? []).map((day) => [day.date, day] as const),
  );
  const result: { date: string; words: number; events: number }[] = [];
  const cursor = new Date(year, 0, 1);
  while (cursor.getFullYear() === year) {
    const date = formatLocalDate(cursor);
    result.push(byDate.get(date) ?? { date, words: 0, events: 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

function getIntensityClass(words: number, maxWords: number): string {
  if (words <= 0) return "bg-muted";
  const ratio = words / maxWords;
  if (ratio > 0.75) return "bg-primary";
  if (ratio > 0.5) return "bg-primary/75";
  if (ratio > 0.25) return "bg-primary/50";
  return "bg-primary/25";
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
