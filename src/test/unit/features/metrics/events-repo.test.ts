import { beforeEach, describe, expect, it } from "vitest";
import type { DatabaseAdapter } from "../../../../lib/platform/types";
import { createTestDatabase } from "../../../support/db-test-context";
import {
  ensureMetricsSchema,
  insertEvents,
  insertIfNotTombstoned,
  listEvents,
  purgeEventsByPrefix,
  upsertCache,
  invalidateCache,
} from "../../../../features/metrics/events-repo";
import type { MetricEvent } from "../../../../features/metrics/types";

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
      buildEvent({ id: "event-2", eventType: "writing.deleted", payload: { words: 1, chars: 5, chapterId: null } }),
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
      [event.id, "2026-05-23T12:30:00.000Z", "device-1", "category-opt-out"],
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
      computedAt: "2026-05-23T12:01:00.000Z",
      payload: { words: 3 },
    });

    const purged = await purgeEventsByPrefix(
      testDb,
      "writing.",
      "device-1",
      "2026-05-23T12:30:00.000Z",
    );
    await invalidateCache(testDb, ["writing:"]);

    const events = await listEvents(testDb);
    const tombstones = await testDb.select<{ id: string }[]>(
      "SELECT id FROM metrics_event_tombstones",
    );
    const cacheRows = await testDb.select<{ cache_key: string }[]>(
      "SELECT cache_key FROM metrics_cache",
    );

    expect(purged).toBe(1);
    expect(events.map((event) => event.id)).toEqual(["session-1"]);
    expect(tombstones).toEqual([{ id: "typed-1" }]);
    expect(cacheRows).toEqual([]);
  });
});
