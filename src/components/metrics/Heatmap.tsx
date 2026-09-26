import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { GridList, GridListItem } from "react-aria-components/GridList";
import type { HeatmapAggregate } from "@/features/metrics/aggregates/types";
import { Tooltip } from "@/components/ui";

interface HeatmapProps {
  aggregate: HeatmapAggregate | null;
  isLoading: boolean;
}

interface HeatmapDay {
  id: string;
  date: string;
  words: number;
  events: number;
}

interface PlacedDay extends HeatmapDay {
  week: number;
  row: number;
}

export function Heatmap({ aggregate, isLoading }: HeatmapProps) {
  const { t } = useTranslation();
  const days = useMemo(() => buildDays(new Date().getFullYear(), aggregate), [aggregate]);
  const { placed, weeks } = useMemo(() => placeByWeek(days), [days]);
  const maxWords = Math.max(1, ...days.map((day) => day.words));

  return (
    <section>
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-lg font-semibold">{t("metrics.heatmap")}</h2>
        {isLoading && (
          <span className="text-sm text-muted-foreground">{t("metrics.loadingEvents")}</span>
        )}
      </div>
      <div className="overflow-x-auto">
        {/* A React Aria grid: one tab stop, arrow keys between days. Cells are
            laid out week-as-column but ordered by weekday so Up/Down moves
            within a week and Left/Right moves across weeks. */}
        <GridList
          aria-label={t("metrics.heatmap")}
          layout="grid"
          orientation="vertical"
          selectionMode="none"
          items={placed}
          className="grid outline-none"
          style={{
            gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))`,
            gridTemplateRows: "repeat(7, auto)",
            gap: "0.25rem",
            minWidth: 760,
          }}
        >
          {(day) => {
            const label = `${day.date}: ${day.words.toLocaleString()} ${t("common.words")}`;
            return (
              <Tooltip content={label}>
                <GridListItem
                  id={day.id}
                  textValue={label}
                  aria-label={label}
                  style={{ gridColumn: day.week + 1, gridRow: day.row + 1 }}
                  className={`aspect-square rounded-sm outline-none data-focus-visible:ring-2 data-focus-visible:ring-primary data-focus-visible:ring-offset-1 ${getIntensityClass(day.words, maxWords)}`}
                />
              </Tooltip>
            );
          }}
        </GridList>
      </div>
    </section>
  );
}

function buildDays(year: number, aggregate: HeatmapAggregate | null): HeatmapDay[] {
  const byDate = new Map((aggregate?.days ?? []).map((day) => [day.date, day] as const));
  const result: HeatmapDay[] = [];
  const cursor = new Date(year, 0, 1);
  while (cursor.getFullYear() === year) {
    const date = formatLocalDate(cursor);
    const day = byDate.get(date);
    result.push({ id: date, date, words: day?.words ?? 0, events: day?.events ?? 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

/**
 * Splits the year into week-long columns (seven days each, like the visual
 * layout) and emits the cells in weekday-major order. The React Aria keyboard
 * delegate walks items in document order for Left/Right and reads real cell
 * rectangles for Up/Down, so this ordering makes Up/Down land on the next day
 * of the week and Left/Right on the same weekday of the next week.
 */
function placeByWeek(days: HeatmapDay[]): { placed: PlacedDay[]; weeks: number } {
  const weeks = Math.max(1, Math.ceil(days.length / 7));
  const placed: PlacedDay[] = [];
  for (let row = 0; row < 7; row++) {
    for (let week = 0; week < weeks; week++) {
      const day = days[week * 7 + row];
      if (!day) continue;
      placed.push({ ...day, week, row });
    }
  }
  return { placed, weeks };
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
