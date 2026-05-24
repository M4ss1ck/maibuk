import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseAdapter } from "../../../../lib/platform/types";
import { createTestDatabase } from "../../../support/db-test-context";
import {
  ensureMetricsSchema,
  insertEvents,
  upsertCache,
} from "../../../../features/metrics/events-repo";
import {
  serializeMetricsBatch,
  applyMetricsBatch,
} from "../../../../features/metrics/metrics-sync";
import type { MetricEvent } from "../../../../features/metrics/types";

const { mockGetDatabase } = vi.hoisted(() => ({ mockGetDatabase: vi.fn() }));
vi.mock("../../../../lib/db", () => ({ getDatabase: mockGetDatabase }));

let testDb: DatabaseAdapter;

function buildEvent(patch: Partial<MetricEvent> = {}): MetricEvent {
  return {
    id: patch.id ?? crypto.randomUUID(),
    timestamp: patch.timestamp ?? "2026-05-23T12:00:00.000Z",
    localDate: patch.localDate ?? "2026-05-23",
    tzOffsetMin: patch.tzOffsetMin ?? 180,
    deviceId: patch.deviceId ?? "device-a",
    eventType: patch.eventType ?? "writing.typed",
    workId: patch.workId ?? "book-1",
    payload: patch.payload ?? { words: 3, chars: 15, chapterId: "chapter-1" },
    schemaVersion: patch.schemaVersion ?? 1,
  };
}

describe("metrics sync", () => {
  beforeEach(async () => {
    testDb = await createTestDatabase();
    mockGetDatabase.mockResolvedValue(testDb);
    await ensureMetricsSchema(testDb);
  });

  describe("serializeMetricsBatch()", () => {
    it("serializes all events and tombstones into a JSON blob", async () => {
      await insertEvents(testDb, [
        buildEvent({ id: "event-1", eventType: "writing.typed" }),
        buildEvent({
          id: "event-2",
          eventType: "session.active",
          payload: { sessionId: "s1", activeSec: 30 },
        }),
      ]);

      await testDb.execute(
        `INSERT INTO metrics_event_tombstones (id, deleted_at, device_id, reason)
         VALUES (?, ?, ?, ?)`,
        ["tomb-1", "2026-05-23T12:30:00.000Z", "device-a", "category-opt-out"],
      );

      const json = await serializeMetricsBatch();
      const blob = JSON.parse(json);

      expect(blob.events).toHaveLength(2);
      expect(blob.events.map((e: MetricEvent) => e.id).sort()).toEqual(["event-1", "event-2"]);
      expect(blob.tombstones).toHaveLength(1);
      expect(blob.tombstones[0]).toMatchObject({
        id: "tomb-1",
        reason: "category-opt-out",
      });
      expect(blob.updatedAt).toBeGreaterThan(0);
    });

    it("returns an empty blob when no events or tombstones exist", async () => {
      const json = await serializeMetricsBatch();
      const blob = JSON.parse(json);

      expect(blob.events).toEqual([]);
      expect(blob.tombstones).toEqual([]);
      expect(blob.updatedAt).toBeGreaterThan(0);
    });
  });

  describe("applyMetricsBatch()", () => {
    it("inserts events from the batch", async () => {
      const events = [
        buildEvent({ id: "remote-1", deviceId: "device-b" }),
        buildEvent({ id: "remote-2", deviceId: "device-b", eventType: "writing.deleted" }),
      ];

      await applyMetricsBatch({ events, tombstones: [], updatedAt: 1000 });

      const rows = await testDb.select<{ id: string }[]>(
        "SELECT id FROM metrics_events ORDER BY id",
      );
      expect(rows).toEqual([{ id: "remote-1" }, { id: "remote-2" }]);
    });

    it("merges both sides: remote events + local events coexist", async () => {
      await insertEvents(testDb, [
        buildEvent({ id: "local-1", deviceId: "device-a" }),
      ]);

      const remoteEvents = [
        buildEvent({ id: "remote-1", deviceId: "device-b" }),
      ];

      await applyMetricsBatch({ events: remoteEvents, tombstones: [], updatedAt: 1000 });

      const rows = await testDb.select<{ id: string }[]>(
        "SELECT id FROM metrics_events ORDER BY id",
      );
      expect(rows.map((r) => r.id).sort()).toEqual(["local-1", "remote-1"]);
    });

    it("skips remote events when a matching local tombstone exists (anti-resurrection)", async () => {
      await testDb.execute(
        `INSERT INTO metrics_event_tombstones (id, deleted_at, device_id, reason)
         VALUES (?, ?, ?, ?)`,
        ["killed-1", "2026-05-23T12:30:00.000Z", "device-a", "category-opt-out"],
      );

      const remoteEvents = [
        buildEvent({ id: "killed-1", deviceId: "device-b" }),
        buildEvent({ id: "alive-1", deviceId: "device-b" }),
      ];

      await applyMetricsBatch({ events: remoteEvents, tombstones: [], updatedAt: 1000 });

      const rows = await testDb.select<{ id: string }[]>(
        "SELECT id FROM metrics_events ORDER BY id",
      );
      expect(rows).toEqual([{ id: "alive-1" }]);
    });

    it("applies remote tombstones, deleting matching local events (tombstone-wins, direction-agnostic)", async () => {
      await insertEvents(testDb, [
        buildEvent({ id: "doomed-1", deviceId: "device-a" }),
        buildEvent({ id: "survivor-1", deviceId: "device-a" }),
      ]);

      const remoteTombstones = [
        { id: "doomed-1", deleted_at: "2026-05-23T13:00:00.000Z", device_id: "device-b", reason: "category-opt-out" },
      ];

      await applyMetricsBatch({
        events: [],
        tombstones: remoteTombstones,
        updatedAt: 1000,
      });

      const events = await testDb.select<{ id: string }[]>(
        "SELECT id FROM metrics_events ORDER BY id",
      );
      const tombstones = await testDb.select<{ id: string }[]>(
        "SELECT id FROM metrics_event_tombstones",
      );

      expect(events).toEqual([{ id: "survivor-1" }]);
      expect(tombstones).toEqual([{ id: "doomed-1" }]);
    });

    it("does not insert duplicate events (INSERT OR IGNORE via insertIfNotTombstoned -> insertEvents)", async () => {
      await insertEvents(testDb, [
        buildEvent({ id: "dup-1", deviceId: "device-a" }),
      ]);

      await applyMetricsBatch({
        events: [buildEvent({ id: "dup-1", deviceId: "device-b" })],
        tombstones: [],
        updatedAt: 1000,
      });

      const rows = await testDb.select<{ id: string, device_id: string }[]>(
        "SELECT id, device_id FROM metrics_events WHERE id = ?",
        ["dup-1"],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].device_id).toBe("device-a");
    });

    it("handles tombstone + event arriving in either order (batch = tombstone already handled before event)", async () => {
      const tombstone = { id: "late-kill-1", deleted_at: "2026-05-23T14:00:00.000Z", device_id: "device-b", reason: "category-opt-out" };
      const event = buildEvent({ id: "late-kill-1", deviceId: "device-b" });

      // Simulate: tombstone arrives first, then event in same batch
      // applyMetricsBatch processes tombstones before events
      await applyMetricsBatch({
        events: [event],
        tombstones: [tombstone],
        updatedAt: 2000,
      });

      const events = await testDb.select<{ id: string }[]>(
        "SELECT id FROM metrics_events WHERE id = ?",
        ["late-kill-1"],
      );
      const tombstones = await testDb.select<{ id: string }[]>(
        "SELECT id FROM metrics_event_tombstones WHERE id = ?",
        ["late-kill-1"],
      );

      expect(events).toEqual([]);
      expect(tombstones).toHaveLength(1);
    });

    it("invalidates all aggregate caches after applying a non-empty batch", async () => {
      await upsertCache(testDb, {
        cacheKey: "heatmap:2026",
        aggregateVersion: 1,
        sourceHighWatermark: "2026-05-23T12:00:00.000Z",
        windowStart: "2026-01-01T00:00:00.000Z",
        computedAt: "2026-05-23T12:01:00.000Z",
        payload: { days: [] },
      });

      await applyMetricsBatch({
        events: [buildEvent({ id: "remote-1", deviceId: "device-b" })],
        tombstones: [],
        updatedAt: 1000,
      });

      const cacheRows = await testDb.select<{ cache_key: string }[]>(
        "SELECT cache_key FROM metrics_cache",
      );
      expect(cacheRows).toEqual([]);
    });

    it("does not invalidate caches when the batch is empty", async () => {
      await upsertCache(testDb, {
        cacheKey: "heatmap:2026",
        aggregateVersion: 1,
        sourceHighWatermark: "2026-05-23T12:00:00.000Z",
        windowStart: "2026-01-01T00:00:00.000Z",
        computedAt: "2026-05-23T12:01:00.000Z",
        payload: { days: [] },
      });

      await applyMetricsBatch({ events: [], tombstones: [], updatedAt: 1000 });

      const cacheRows = await testDb.select<{ cache_key: string }[]>(
        "SELECT cache_key FROM metrics_cache",
      );
      expect(cacheRows).toEqual([{ cache_key: "heatmap:2026" }]);
    });

    it("inserts non-duplicate tombstones (INSERT OR IGNORE)", async () => {
      await testDb.execute(
        `INSERT INTO metrics_event_tombstones (id, deleted_at, device_id, reason)
         VALUES (?, ?, ?, ?)`,
        ["existing-tomb", "2026-05-23T12:00:00.000Z", "device-a", "category-opt-out"],
      );

      await applyMetricsBatch({
        events: [],
        tombstones: [
          { id: "existing-tomb", deleted_at: "2026-05-23T13:00:00.000Z", device_id: "device-b", reason: "category-opt-out" },
          { id: "new-tomb", deleted_at: "2026-05-23T14:00:00.000Z", device_id: "device-b", reason: "category-opt-out" },
        ],
        updatedAt: 2000,
      });

      const rows = await testDb.select<{ id: string }[]>(
        "SELECT id FROM metrics_event_tombstones ORDER BY id",
      );
      expect(rows).toEqual([{ id: "existing-tomb" }, { id: "new-tomb" }]);
    });
  });
});
