import { describe, expect, it } from "vitest";
import {
  computeAggregate,
  mergeAggregatePayloads,
} from "../../../../../features/metrics/aggregates/compute";
import type { DashboardAggregate } from "../../../../../features/metrics/aggregates/types";
import type { MetricEvent } from "../../../../../features/metrics/types";

function event(patch: Partial<MetricEvent>): MetricEvent {
  return {
    id: patch.id ?? crypto.randomUUID(),
    timestamp: patch.timestamp ?? "2026-05-23T12:00:00.000Z",
    localDate: patch.localDate ?? "2026-05-23",
    tzOffsetMin: patch.tzOffsetMin ?? 0,
    deviceId: patch.deviceId ?? "device-1",
    eventType: patch.eventType ?? "writing.typed",
    workId: patch.workId ?? "book-1",
    payload: patch.payload ?? { words: 10, chars: 50, chapterId: "chapter-1" },
    schemaVersion: patch.schemaVersion ?? 1,
  };
}

describe("computeAggregate()", () => {
  it("buckets heatmap counts by local_date rather than UTC timestamp", () => {
    const payload = computeAggregate("heatmap:2026", [
      event({
        timestamp: "2026-05-24T02:30:00.000Z",
        localDate: "2026-05-23",
        eventType: "writing.typed",
        payload: { words: 12, chars: 60, chapterId: "chapter-1" },
      }),
    ]);

    expect(payload).toEqual({
      days: [{ date: "2026-05-23", words: 12, events: 1 }],
    });
  });

  it("computes streaks and written-day counts from typed local days", () => {
    const payload = computeAggregate(
      "streak:current",
      [
        event({ localDate: "2026-05-20", payload: { words: 50, chars: 250, chapterId: "chapter-1" } }),
        event({ localDate: "2026-05-21", payload: { words: 25, chars: 125, chapterId: "chapter-1" } }),
        event({ localDate: "2026-05-22", payload: { words: 80, chars: 400, chapterId: "chapter-1" } }),
      ],
      { today: "2026-05-23", dailyWordThreshold: 50 },
    );

    expect(payload).toMatchObject({
      currentStreak: 1,
      longestStreak: 1,
      daysThisWeek: 3,
      daysThisMonth: 3,
    });
  });

  it("computes net words, edit ratio, WPM, active time, time of day, and per-work time", () => {
    const payload = computeAggregate("dashboard:last30d", [
      event({
        eventType: "writing.typed",
        workId: "book-1",
        payload: { words: 120, chars: 600, chapterId: "chapter-1" },
      }),
      event({
        eventType: "writing.deleted",
        workId: "book-1",
        payload: { words: 20, chars: 100, chapterId: "chapter-1" },
      }),
      event({
        eventType: "writing.pasted",
        workId: "book-2",
        timestamp: "2026-05-23T21:00:00.000Z",
        payload: { words: 40, chars: 200, chapterId: "chapter-2" },
      }),
      event({
        eventType: "session.ended",
        workId: "book-1",
        payload: {
          sessionId: "session-1",
          durationSec: 900,
          activeSec: 600,
          deepestStreakSec: 420,
        },
      }),
      event({
        eventType: "session.active",
        workId: "book-1",
        payload: { sessionId: "session-1", activeSec: 600 },
      }),
    ]) as DashboardAggregate;

    expect(payload).toMatchObject({
      typedWords: 120,
      deletedWords: 20,
      pastedWords: 40,
      netWords: 100,
      editRatio: 0.17,
      activeSec: 600,
      deepestSessionSec: 420,
      wpm: 10,
      timeByWork: [{ workId: "book-1", activeSec: 600 }],
    });
    expect(payload.timeOfDay.find((bucket) => bucket.hour === 12)?.words).toBe(100);
    expect(payload.timeOfDay.find((bucket) => bucket.hour === 21)?.words).toBe(40);
  });

  it("merges chunked heatmap and dashboard payloads", () => {
    expect(
      mergeAggregatePayloads("heatmap:2026", [
        { days: [{ date: "2026-05-23", words: 10, events: 1 }] },
        { days: [{ date: "2026-05-23", words: 5, events: 2 }] },
      ]),
    ).toEqual({
      days: [{ date: "2026-05-23", words: 15, events: 3 }],
    });

    const merged = mergeAggregatePayloads("dashboard:last30d", [
      {
        typedWords: 100,
        deletedWords: 20,
        pastedWords: 0,
        netWords: 80,
        editRatio: 0.2,
        activeSec: 300,
        deepestSessionSec: 120,
        wpm: 16,
        timeOfDay: [{ hour: 10, words: 80 }],
        timeByWork: [{ workId: "book-1", activeSec: 300 }],
      },
      {
        typedWords: 50,
        deletedWords: 0,
        pastedWords: 10,
        netWords: 50,
        editRatio: 0,
        activeSec: 300,
        deepestSessionSec: 180,
        wpm: 10,
        timeOfDay: [{ hour: 10, words: 50 }],
        timeByWork: [{ workId: "book-1", activeSec: 300 }],
      },
    ]) as DashboardAggregate;

    expect(merged).toMatchObject({
      typedWords: 150,
      deletedWords: 20,
      pastedWords: 10,
      netWords: 130,
      editRatio: 0.13,
      activeSec: 600,
      deepestSessionSec: 180,
      wpm: 13,
      timeOfDay: [{ hour: 10, words: 130 }],
      timeByWork: [{ workId: "book-1", activeSec: 600 }],
    });
  });

  it("returns empty aggregate payloads for empty chunk sets", () => {
    expect(mergeAggregatePayloads("dashboard:last30d", [])).toMatchObject({
      netWords: 0,
      activeSec: 0,
      timeOfDay: [],
      timeByWork: [],
    });
  });
});
