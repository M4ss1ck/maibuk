import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseAdapter } from "../../../../lib/platform/types";
import { createTestDatabase } from "../../../support/db-test-context";
import {
  ensureMetricsSchema,
  insertEvents,
  listEvents,
  upsertCache,
} from "../../../../features/metrics/events-repo";
import type { MetricEvent } from "../../../../features/metrics/types";

const { mockGetDatabase, mockGetOrCreateDeviceId } = vi.hoisted(() => ({
  mockGetDatabase: vi.fn(),
  mockGetOrCreateDeviceId: vi.fn(),
}));

vi.mock("../../../../lib/db", () => ({
  getDatabase: mockGetDatabase,
}));

vi.mock("../../../../features/metrics/device-id", () => ({
  getOrCreateDeviceId: mockGetOrCreateDeviceId,
}));

const { purgeMetricCategory } = await import(
  "../../../../features/metrics/purge"
);

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

describe("purgeMetricCategory()", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    testDb = await createTestDatabase();
    await ensureMetricsSchema(testDb);
    mockGetDatabase.mockResolvedValue(testDb);
    mockGetOrCreateDeviceId.mockReturnValue("device-under-test");
  });

  it("deletes matching events, writes tombstones, and invalidates aggregate caches", async () => {
    await insertEvents(testDb, [
      buildEvent({ id: "typed-1", eventType: "writing.typed" }),
      buildEvent({ id: "deleted-1", eventType: "writing.deleted" }),
      buildEvent({ id: "session-1", eventType: "session.active" }),
    ]);
    await upsertCache(testDb, {
      cacheKey: "heatmap:2026",
      aggregateVersion: 1,
      sourceHighWatermark: "2026-05-23T12:00:00.000Z",
      computedAt: "2026-05-23T12:01:00.000Z",
      payload: { days: [] },
    });
    await upsertCache(testDb, {
      cacheKey: "streak:current",
      aggregateVersion: 1,
      sourceHighWatermark: "2026-05-23T12:00:00.000Z",
      computedAt: "2026-05-23T12:01:00.000Z",
      payload: { currentStreak: 1 },
    });
    await upsertCache(testDb, {
      cacheKey: "dashboard:last30d",
      aggregateVersion: 1,
      sourceHighWatermark: "2026-05-23T12:00:00.000Z",
      computedAt: "2026-05-23T12:01:00.000Z",
      payload: { netWords: 3 },
    });
    await upsertCache(testDb, {
      cacheKey: "unrelated:cache",
      aggregateVersion: 1,
      sourceHighWatermark: "2026-05-23T12:00:00.000Z",
      computedAt: "2026-05-23T12:01:00.000Z",
      payload: {},
    });

    const purged = await purgeMetricCategory("writing.");

    const events = await listEvents(testDb);
    const tombstones = await testDb.select<{ id: string; device_id: string }[]>(
      "SELECT id, device_id FROM metrics_event_tombstones ORDER BY id ASC",
    );
    const cacheRows = await testDb.select<{ cache_key: string }[]>(
      "SELECT cache_key FROM metrics_cache ORDER BY cache_key ASC",
    );

    expect(purged).toBe(2);
    expect(events.map((event) => event.id)).toEqual(["session-1"]);
    expect(tombstones).toEqual([
      { id: "deleted-1", device_id: "device-under-test" },
      { id: "typed-1", device_id: "device-under-test" },
    ]);
    expect(cacheRows).toEqual([{ cache_key: "unrelated:cache" }]);
  });
});
