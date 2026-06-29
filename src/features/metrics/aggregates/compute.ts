import type { DailyAggregateMetricPayload, MetricEvent, WritingMetricPayload } from "../types";
import type { DayWordTotal } from "../events-repo";
import type {
  AggregateKey,
  AggregateParams,
  AggregatePayload,
  DashboardAggregate,
  HeatmapAggregate,
  StreakAggregate,
  TimeOfDayBucket,
  WorkTimeBucket,
} from "./types";

export function computeAggregate(
  key: AggregateKey,
  rows: MetricEvent[],
  params: AggregateParams = {}
): AggregatePayload {
  if (key.startsWith("heatmap:")) {
    return computeHeatmap(rows);
  }
  if (key === "streak:current") {
    // Legacy path retained for callers that still pass raw events (tests, etc.)
    return computeStreak(rows, params);
  }
  return computeDashboard(rows);
}

export function computeStreakFromDayTotals(
  dayTotals: DayWordTotal[],
  params: AggregateParams = {}
): StreakAggregate {
  const threshold = params.dailyWordThreshold ?? 50;
  const today = params.today ?? formatLocalDate(new Date());
  const byDate = new Map(dayTotals.map((row) => [row.date, row.words]));
  return computeStreakFromMap(byDate, threshold, today);
}

export function mergeAggregatePayloads(
  key: AggregateKey,
  payloads: AggregatePayload[],
  params: AggregateParams = {}
): AggregatePayload {
  if (payloads.length === 0) {
    return computeAggregate(key, [], params);
  }
  if (payloads.length === 1) return payloads[0];

  if (key.startsWith("heatmap:")) {
    const byDate = new Map<string, { words: number; events: number }>();
    for (const payload of payloads as HeatmapAggregate[]) {
      for (const day of payload.days) {
        const current = byDate.get(day.date) ?? { words: 0, events: 0 };
        current.words += day.words;
        current.events += day.events;
        byDate.set(day.date, current);
      }
    }
    return {
      days: Array.from(byDate.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, value]) => ({ date, ...value })),
    };
  }

  if (key === "streak:current") {
    // Streak is computed in one shot from day-aggregated SQL, never paginated.
    // If pagination is ever applied here it would produce wrong results because
    // streak math is not linear across chunk boundaries.
    return payloads[0];
  }

  return finalizeDashboard(
    (payloads as DashboardAggregate[]).reduce((acc, payload) => {
      acc.typedWords += payload.typedWords;
      acc.deletedWords += payload.deletedWords;
      acc.pastedWords += payload.pastedWords;
      acc.activeSec += payload.activeSec;
      acc.deepestSessionSec = Math.max(acc.deepestSessionSec, payload.deepestSessionSec);
      for (const bucket of payload.timeOfDay) {
        acc.timeOfDay.set(bucket.hour, (acc.timeOfDay.get(bucket.hour) ?? 0) + bucket.words);
      }
      for (const bucket of payload.timeByWork) {
        acc.timeByWork.set(
          bucket.workId,
          (acc.timeByWork.get(bucket.workId) ?? 0) + bucket.activeSec
        );
      }
      return acc;
    }, emptyDashboardAccumulator())
  );
}

function computeHeatmap(rows: MetricEvent[]): HeatmapAggregate {
  // Heatmap shows writing-day *intensity*, not net delta. Deletions don't
  // subtract from a day's intensity — a heavy-edit day that types 5,000 words
  // and deletes 3,000 is still a productive day for the heatmap. Only typed +
  // pasted words contribute.
  const byDate = new Map<string, { words: number; events: number }>();
  for (const row of rows) {
    if (row.eventType === "aggregate.daily") {
      const payload = getDailyAggregatePayload(row);
      if (!payload) continue;
      const current = byDate.get(payload.date) ?? { words: 0, events: 0 };
      current.words += payload.typedWords + payload.pastedWords;
      current.events += payload.rawEvents;
      byDate.set(payload.date, current);
      continue;
    }
    if (row.eventType !== "writing.typed" && row.eventType !== "writing.pasted") continue;
    const words = getWords(row);
    if (words <= 0) continue;
    const current = byDate.get(row.localDate) ?? { words: 0, events: 0 };
    current.words += words;
    current.events += 1;
    byDate.set(row.localDate, current);
  }
  return {
    days: Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => ({ date, ...value })),
  };
}

function computeStreak(rows: MetricEvent[], params: AggregateParams): StreakAggregate {
  const threshold = params.dailyWordThreshold ?? 50;
  const today = params.today ?? formatLocalDate(new Date());
  const byDate = new Map<string, number>();

  for (const row of rows) {
    if (row.eventType === "aggregate.daily") {
      const payload = getDailyAggregatePayload(row);
      if (payload) {
        byDate.set(payload.date, (byDate.get(payload.date) ?? 0) + payload.typedWords);
      }
      continue;
    }
    if (row.eventType !== "writing.typed") continue;
    byDate.set(row.localDate, (byDate.get(row.localDate) ?? 0) + getWords(row));
  }

  return computeStreakFromMap(byDate, threshold, today);
}

function computeStreakFromMap(
  byDate: Map<string, number>,
  threshold: number,
  today: string
): StreakAggregate {
  const qualifying = new Set(
    Array.from(byDate.entries())
      .filter(([, words]) => words >= threshold)
      .map(([date]) => date)
  );

  const sorted = Array.from(qualifying).sort();
  let longestStreak = 0;
  let run = 0;
  let previous: string | null = null;
  for (const date of sorted) {
    run = previous && daysBetween(previous, date) === 1 ? run + 1 : 1;
    longestStreak = Math.max(longestStreak, run);
    previous = date;
  }

  let currentStreak = 0;
  for (let cursor = addDays(today, -1); qualifying.has(cursor); cursor = addDays(cursor, -1)) {
    currentStreak += 1;
  }
  if (qualifying.has(today)) currentStreak += 1;

  return {
    currentStreak,
    longestStreak,
    daysThisWeek: countDatesSince(Array.from(byDate.keys()), addDays(today, -6), today),
    daysThisMonth: countSameMonth(Array.from(byDate.keys()), today),
  };
}

function computeDashboard(rows: MetricEvent[]): DashboardAggregate {
  const acc = emptyDashboardAccumulator();

  for (const row of rows) {
    switch (row.eventType) {
      case "aggregate.daily": {
        const payload = getDailyAggregatePayload(row);
        if (!payload) break;
        acc.typedWords += payload.typedWords;
        acc.deletedWords += payload.deletedWords;
        acc.pastedWords += payload.pastedWords;
        acc.activeSec += payload.activeSec;
        acc.deepestSessionSec = Math.max(acc.deepestSessionSec, payload.deepestSessionSec);
        for (const bucket of payload.timeOfDay) {
          acc.timeOfDay.set(bucket.hour, (acc.timeOfDay.get(bucket.hour) ?? 0) + bucket.words);
        }
        for (const bucket of payload.timeByWork) {
          acc.timeByWork.set(
            bucket.workId,
            (acc.timeByWork.get(bucket.workId) ?? 0) + bucket.activeSec
          );
        }
        break;
      }
      case "writing.typed": {
        const words = getWords(row);
        acc.typedWords += words;
        addHourWords(acc.timeOfDay, row, words);
        break;
      }
      case "writing.deleted": {
        const words = getWords(row);
        acc.deletedWords += words;
        addHourWords(acc.timeOfDay, row, -words);
        break;
      }
      case "writing.pasted": {
        const words = getWords(row);
        acc.pastedWords += words;
        addHourWords(acc.timeOfDay, row, words);
        break;
      }
      case "session.active": {
        const activeSec = getNumber(row.payload, "activeSec");
        acc.activeSec += activeSec;
        if (row.workId) {
          acc.timeByWork.set(row.workId, (acc.timeByWork.get(row.workId) ?? 0) + activeSec);
        }
        break;
      }
      case "session.ended":
        acc.deepestSessionSec = Math.max(
          acc.deepestSessionSec,
          getNumber(row.payload, "deepestStreakSec")
        );
        break;
      case "session.started":
      case "ai.inserted":
      case "ai.edited":
        break;
    }
  }

  return finalizeDashboard(acc);
}

function emptyDashboardAccumulator() {
  return {
    typedWords: 0,
    deletedWords: 0,
    pastedWords: 0,
    activeSec: 0,
    deepestSessionSec: 0,
    timeOfDay: new Map<number, number>(),
    timeByWork: new Map<string, number>(),
  };
}

function finalizeDashboard(acc: ReturnType<typeof emptyDashboardAccumulator>): DashboardAggregate {
  const netWords = acc.typedWords - acc.deletedWords;
  const activeMinutes = acc.activeSec / 60;
  const timeOfDay: TimeOfDayBucket[] = Array.from(acc.timeOfDay.entries())
    .sort(([a], [b]) => a - b)
    .map(([hour, words]) => ({ hour, words }));
  const timeByWork: WorkTimeBucket[] = Array.from(acc.timeByWork.entries())
    .sort(([, a], [, b]) => b - a)
    .map(([workId, activeSec]) => ({ workId, activeSec }));

  return {
    typedWords: acc.typedWords,
    deletedWords: acc.deletedWords,
    pastedWords: acc.pastedWords,
    netWords,
    editRatio: acc.typedWords > 0 ? roundTwo(acc.deletedWords / acc.typedWords) : 0,
    activeSec: acc.activeSec,
    deepestSessionSec: acc.deepestSessionSec,
    wpm: activeMinutes > 0 ? roundTwo(netWords / activeMinutes) : 0,
    timeOfDay,
    timeByWork,
  };
}

function getWords(event: MetricEvent): number {
  return getNumber(event.payload, "words");
}

function getDailyAggregatePayload(event: MetricEvent): DailyAggregateMetricPayload | null {
  const payload = event.payload as Partial<DailyAggregateMetricPayload>;
  if (payload.bucket !== "daily-v1") return null;
  return {
    bucket: "daily-v1",
    date: typeof payload.date === "string" ? payload.date : event.localDate,
    rawEvents: getFiniteNumber(payload.rawEvents),
    typedWords: getFiniteNumber(payload.typedWords),
    deletedWords: getFiniteNumber(payload.deletedWords),
    pastedWords: getFiniteNumber(payload.pastedWords),
    activeSec: getFiniteNumber(payload.activeSec),
    deepestSessionSec: getFiniteNumber(payload.deepestSessionSec),
    timeOfDay: Array.isArray(payload.timeOfDay)
      ? payload.timeOfDay
          .filter(
            (bucket) =>
              Number.isInteger(bucket.hour) &&
              typeof bucket.words === "number" &&
              Number.isFinite(bucket.words)
          )
          .map((bucket) => ({ hour: bucket.hour, words: bucket.words }))
      : [],
    timeByWork: Array.isArray(payload.timeByWork)
      ? payload.timeByWork
          .filter(
            (bucket) =>
              typeof bucket.workId === "string" &&
              typeof bucket.activeSec === "number" &&
              Number.isFinite(bucket.activeSec)
          )
          .map((bucket) => ({
            workId: bucket.workId,
            activeSec: bucket.activeSec,
          }))
      : [],
  };
}

function getNumber(payload: MetricEvent["payload"], key: string): number {
  const value = (payload as WritingMetricPayload & Record<string, unknown>)[key];
  return getFiniteNumber(value);
}

function getFiniteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function addHourWords(target: Map<number, number>, row: MetricEvent, words: number) {
  const localTime = new Date(new Date(row.timestamp).getTime() + row.tzOffsetMin * 60_000);
  const hour = localTime.getUTCHours();
  target.set(hour, (target.get(hour) ?? 0) + words);
}

function roundTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00`);
  value.setDate(value.getDate() + days);
  return formatLocalDate(value);
}

function daysBetween(a: string, b: string): number {
  const start = new Date(`${a}T00:00:00`).getTime();
  const end = new Date(`${b}T00:00:00`).getTime();
  return Math.round((end - start) / 86_400_000);
}

function countDatesSince(dates: string[], start: string, end: string): number {
  return dates.filter((date) => date >= start && date <= end).length;
}

function countSameMonth(dates: string[], today: string): number {
  const month = today.slice(0, 7);
  return dates.filter((date) => date.startsWith(month)).length;
}
