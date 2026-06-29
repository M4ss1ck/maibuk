import { beforeEach, describe, expect, it } from "vitest";
import type { DatabaseAdapter } from "@/lib/platform/types";
import { createTestDatabase } from "@/test/support/db-test-context";
import {
  ensureMetricsSchema,
  compactUnpushedRawMetricEvents,
  MAX_SOURCE_EVENTS_PER_SEGMENT,
  getSnapshotMetrics,
  getCategoryMeasuringSince,
  listDailyWritingTotals,
  getSourceHighWatermark,
  insertEvents,
  insertIfNotTombstoned,
  listEventsForAggregate,
  listEvents,
  purgeEventsByPrefix,
  upsertCache,
  invalidateCache,
} from "@/features/metrics/events-repo";
import type { MetricEvent } from "@/features/metrics/types";

let testDb: DatabaseAdapter;

function buildEvent(patch: Partial<MetricEvent> = {}): MetricEvent {
  return {
    id: patch.id ?? crypto.randomUUID(),
    timestamp: patch.timestamp ?? "2026-05-23T12:00:00.000Z",
    localDate: patch.localDate ?? "2026-05-23",
    tzOffsetMin: patch.tzOffsetMin ?? 180,
    deviceId: patch.deviceId ?? "device-1",
    eventType: patch.eventType ?? "writing.typed",
    workId: patch.workId ?? "book-1",
    payload: patch.payload ?? { words: 3, chars: 15, chapterId: "chapter-1" },
    schemaVersion: patch.schemaVersion ?? 1,
  };
}

describe("metrics events repository", () => {
  beforeEach(async () => {
    testDb = await createTestDatabase();
    await ensureMetricsSchema(testDb);
  });

  it("inserts and lists events without prose in the payload", async () => {
    await insertEvents(testDb, [
      buildEvent({ id: "event-1", payload: { words: 2, chars: 10, chapterId: "chapter-1" } }),
      buildEvent({
        id: "event-2",
        eventType: "writing.deleted",
        payload: { words: 1, chars: 5, chapterId: null },
      }),
    ]);

    const rows = await listEvents(testDb);

    expect(rows).toHaveLength(2);
    expect(rows[0].payload).toEqual({ words: 2, chars: 10, chapterId: "chapter-1" });
    expect(JSON.stringify(rows)).not.toContain("alpha beta");
  });

  it("does not insert an event when its tombstone already exists", async () => {
    const event = buildEvent({ id: "deleted-event" });
    await purgeEventsByPrefix(testDb, "writing.", "device-1", "2026-05-23T12:30:00.000Z");
    await testDb.execute(
      `INSERT INTO metrics_event_tombstones (id, deleted_at, device_id, reason)
       VALUES (?, ?, ?, ?)`,
      [event.id, "2026-05-23T12:30:00.000Z", "device-1", "category-opt-out"]
    );

    const inserted = await insertIfNotTombstoned(testDb, event);

    expect(inserted).toBe(false);
    expect(await listEvents(testDb)).toEqual([]);
  });

  it("purges events by prefix, writes tombstones, and invalidates matching cache rows", async () => {
    await insertEvents(testDb, [
      buildEvent({ id: "typed-1", eventType: "writing.typed" }),
      buildEvent({ id: "session-1", eventType: "session.active" }),
    ]);
    await upsertCache(testDb, {
      cacheKey: "writing:summary",
      aggregateVersion: 1,
      sourceHighWatermark: "2026-05-23T12:00:00.000Z",
      windowStart: "",
      computedAt: "2026-05-23T12:01:00.000Z",
      payload: { words: 3 },
    });

    const purged = await purgeEventsByPrefix(
      testDb,
      "writing.",
      "device-1",
      "2026-05-23T12:30:00.000Z"
    );
    await invalidateCache(testDb, ["writing:"]);

    const events = await listEvents(testDb);
    const tombstones = await testDb.select<{ id: string }[]>(
      "SELECT id FROM metrics_event_tombstones"
    );
    const cacheRows = await testDb.select<{ cache_key: string }[]>(
      "SELECT cache_key FROM metrics_cache"
    );

    expect(purged).toBe(1);
    expect(events.map((event) => event.id)).toEqual(["session-1"]);
    expect(tombstones).toEqual([{ id: "typed-1" }]);
    expect(cacheRows).toEqual([]);
  });

  it("compacts a day's raw events into a single aggregate when under the segment cap", async () => {
    await insertEvents(testDb, [
      buildEvent({
        id: "e-1",
        eventType: "writing.typed",
        payload: { words: 2, chars: 5, chapterId: "c" },
      }),
      buildEvent({
        id: "e-2",
        eventType: "writing.typed",
        payload: { words: 3, chars: 9, chapterId: "c" },
      }),
    ]);

    await compactUnpushedRawMetricEvents(testDb);

    const rows = await listEvents(testDb);
    const aggregates = rows.filter((row) => row.eventType === "aggregate.daily");
    expect(aggregates).toHaveLength(1);
    expect(rows.filter((row) => row.eventType === "writing.typed")).toHaveLength(0);
    expect((aggregates[0].payload as { typedWords: number }).typedWords).toBe(5);
  });

  it("splits a day's raw events into multiple disjoint segments above the cap", async () => {
    const total = MAX_SOURCE_EVENTS_PER_SEGMENT * 2 + 1;
    const events = Array.from({ length: total }, (_, i) =>
      buildEvent({
        id: `e-${String(i).padStart(5, "0")}`,
        timestamp: `2026-05-23T12:00:${String(i % 60).padStart(2, "0")}.000Z`,
        eventType: "writing.typed",
        payload: { words: 1, chars: 1, chapterId: "c" },
      })
    );
    await insertEvents(testDb, events);

    await compactUnpushedRawMetricEvents(testDb);

    const aggregates = (await listEvents(testDb)).filter(
      (row) => row.eventType === "aggregate.daily"
    );
    expect(aggregates).toHaveLength(Math.ceil(total / MAX_SOURCE_EVENTS_PER_SEGMENT));

    // No segment exceeds the cap.
    for (const aggregate of aggregates) {
      const ids = (aggregate.payload as { sourceEventIds: string[] }).sourceEventIds;
      expect(ids.length).toBeLessThanOrEqual(MAX_SOURCE_EVENTS_PER_SEGMENT);
    }

    // Segments partition the day's events: every raw id appears exactly once.
    const allIds = aggregates.flatMap(
      (aggregate) => (aggregate.payload as { sourceEventIds: string[] }).sourceEventIds
    );
    expect(allIds).toHaveLength(total);
    expect(new Set(allIds).size).toBe(total);

    // Word totals are preserved across the split.
    const typedWords = aggregates.reduce(
      (sum, aggregate) => sum + (aggregate.payload as { typedWords: number }).typedWords,
      0
    );
    expect(typedWords).toBe(total);
  });

  it("reads snapshot totals directly from books", async () => {
    await testDb.execute(
      `INSERT INTO books
        (id, title, author_name, word_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ["book-1", "Novel One", "Author", 8000, 1, 2]
    );
    await testDb.execute(
      `INSERT INTO books
        (id, title, author_name, word_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ["book-2", "Draft Two", "Author", 4345, 1, 3]
    );

    const snapshot = await getSnapshotMetrics(testDb);

    expect(snapshot.totalWords).toBe(12345);
    expect(snapshot.perWork).toEqual([
      { workId: "book-2", title: "Draft Two", wordCount: 4345 },
      { workId: "book-1", title: "Novel One", wordCount: 8000 },
    ]);
  });

  it("windows aggregate event rows and returns a matching source watermark", async () => {
    await insertEvents(testDb, [
      buildEvent({ id: "event-1", timestamp: "2026-05-23T12:00:00.000Z" }),
      buildEvent({ id: "event-2", timestamp: "2026-05-23T12:01:00.000Z" }),
      buildEvent({
        id: "aggregate:daily:v1:device-1:2026-05-22",
        eventType: "aggregate.daily",
        localDate: "2026-05-22",
        timestamp: "2026-05-22T23:59:59.000Z",
        payload: {
          bucket: "daily-v1",
          date: "2026-05-22",
          rawEvents: 1,
          typedWords: 20,
          deletedWords: 0,
          pastedWords: 0,
          activeSec: 0,
          deepestSessionSec: 0,
          timeOfDay: [],
          timeByWork: [],
        },
      }),
    ]);

    const firstPage = await listEventsForAggregate(testDb, "heatmap:2026", {
      limit: 1,
      offset: 0,
    });
    const secondPage = await listEventsForAggregate(testDb, "heatmap:2026", {
      limit: 1,
      offset: 1,
    });
    const thirdPage = await listEventsForAggregate(testDb, "heatmap:2026", {
      limit: 1,
      offset: 2,
    });

    expect(firstPage.map((event) => event.id)).toEqual(["aggregate:daily:v1:device-1:2026-05-22"]);
    expect(secondPage.map((event) => event.id)).toEqual(["event-1"]);
    expect(thirdPage.map((event) => event.id)).toEqual(["event-2"]);
    expect(await getSourceHighWatermark(testDb, "heatmap:2026")).toBe("2026-05-23T12:01:00.000Z");
  });

  it("includes compact daily aggregate rows in daily writing totals", async () => {
    await insertEvents(testDb, [
      buildEvent({
        id: "aggregate:daily:v1:device-1:2026-01-01",
        eventType: "aggregate.daily",
        localDate: "2026-01-01",
        timestamp: "2026-01-01T23:59:59.000Z",
        payload: {
          bucket: "daily-v1",
          date: "2026-01-01",
          rawEvents: 2,
          typedWords: 90,
          deletedWords: 5,
          pastedWords: 10,
          activeSec: 0,
          deepestSessionSec: 0,
          timeOfDay: [],
          timeByWork: [],
        },
      }),
      buildEvent({
        id: "raw-typed",
        eventType: "writing.typed",
        localDate: "2026-01-01",
        timestamp: "2026-01-01T12:00:00.000Z",
        payload: { words: 15, chars: 75, chapterId: "chapter-1" },
      }),
    ]);

    expect(await listDailyWritingTotals(testDb)).toEqual([{ date: "2026-01-01", words: 105 }]);
  });

  it("reports measuring-since dates by metrics category", async () => {
    await insertEvents(testDb, [
      buildEvent({
        id: "typed-1",
        eventType: "writing.typed",
        timestamp: "2026-05-23T12:00:00.000Z",
      }),
      buildEvent({
        id: "session-1",
        eventType: "session.active",
        timestamp: "2026-05-24T12:00:00.000Z",
      }),
    ]);

    expect(await getCategoryMeasuringSince(testDb, "writing")).toBe("2026-05-23T12:00:00.000Z");
    expect(await getCategoryMeasuringSince(testDb, "time")).toBe("2026-05-24T12:00:00.000Z");
    expect(await getCategoryMeasuringSince(testDb, "engagement")).toBe("2026-05-23T12:00:00.000Z");
  });
});
