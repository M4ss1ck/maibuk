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
  syncMetricsRows,
  applyLegacyBlobAndMarkPushed,
} from "../../../../features/metrics/metrics-sync";
import type { MetricEvent } from "../../../../features/metrics/types";

const {
  mockGetDatabase,
  mockPullEvents,
  mockPullTombstones,
  mockPushEvent,
  mockPushTombstone,
  mockEncrypt,
  mockDecrypt,
} = vi.hoisted(() => ({
  mockGetDatabase: vi.fn(),
  mockPullEvents: vi.fn(),
  mockPullTombstones: vi.fn(),
  mockPushEvent: vi.fn(),
  mockPushTombstone: vi.fn(),
  mockEncrypt: vi.fn(),
  mockDecrypt: vi.fn(),
}));
vi.mock("../../../../lib/db", () => ({ getDatabase: mockGetDatabase }));
vi.mock("../../../../features/sync/client", () => ({
  pullMetricsEventRowsSince: mockPullEvents,
  pullMetricsTombstoneRowsSince: mockPullTombstones,
  pushMetricsEventRow: mockPushEvent,
  pushMetricsTombstoneRow: mockPushTombstone,
}));
vi.mock("../../../../features/sync/crypto", () => ({
  encrypt: mockEncrypt,
  decrypt: mockDecrypt,
}));

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

  describe("syncMetricsRows()", () => {
    const EVENT_WATERMARK_KEY = "maibuk.metrics.lastEventPullAt";
    const TOMBSTONE_WATERMARK_KEY = "maibuk.metrics.lastTombstonePullAt";

    beforeEach(() => {
      localStorage.removeItem(EVENT_WATERMARK_KEY);
      localStorage.removeItem(TOMBSTONE_WATERMARK_KEY);
      mockPullEvents.mockResolvedValue([]);
      mockPullTombstones.mockResolvedValue([]);
      mockPushEvent.mockResolvedValue(undefined);
      mockPushTombstone.mockResolvedValue(undefined);
      // Fake crypto: encrypt produces JSON bytes, decrypt returns JSON string.
      mockEncrypt.mockImplementation(async (plaintext: string) =>
        new TextEncoder().encode(plaintext),
      );
      mockDecrypt.mockImplementation(async (data: Uint8Array) =>
        new TextDecoder().decode(data),
      );
    });

    it("pushes locally-only events and marks them pushed", async () => {
      await insertEvents(testDb, [
        buildEvent({ id: "local-1" }),
        buildEvent({ id: "local-2" }),
      ]);

      await syncMetricsRows("pass");

      expect(mockPushEvent).toHaveBeenCalledTimes(2);
      expect(mockPushEvent.mock.calls[0][0]).toMatchObject({ id: "local-1" });
      // Verify they're no longer in the unpushed queue.
      const stillUnpushed = await testDb.select<{ id: string }[]>(
        "SELECT id FROM metrics_events WHERE pushed_at IS NULL",
      );
      expect(stillUnpushed).toEqual([]);
    });

    it("pulls remote events, decrypts them, and stores them as pushed", async () => {
      const encrypted = await mockEncrypt(
        JSON.stringify({ words: 7, chars: 35, chapterId: "c-1" }),
        "pass",
      );
      mockPullEvents.mockResolvedValue([
        {
          id: "remote-1",
          device_id: "device-b",
          timestamp: "2026-05-23T13:00:00.000Z",
          local_date: "2026-05-23",
          tz_offset_min: 0,
          event_type: "writing.typed",
          work_id: "book-2",
          schema_version: 1,
          encrypted_payload: uint8ToBase64(encrypted as Uint8Array),
          updated: "2026-05-23T13:00:00.123Z",
        },
      ]);

      await syncMetricsRows("pass");

      const rows = await testDb.select<{ id: string; pushed_at: string | null }[]>(
        "SELECT id, pushed_at FROM metrics_events",
      );
      expect(rows).toEqual([{ id: "remote-1", pushed_at: "2026-05-23T13:00:00.123Z" }]);
      expect(localStorage.getItem(EVENT_WATERMARK_KEY)).toBe(
        "2026-05-23T13:00:00.123Z",
      );
    });

    it("applies a remote tombstone before pulled events so the event is dropped", async () => {
      const encrypted = await mockEncrypt(
        JSON.stringify({ words: 1, chars: 5, chapterId: null }),
        "pass",
      );
      mockPullTombstones.mockResolvedValue([
        {
          id: "doomed-1",
          device_id: "device-b",
          deleted_at: "2026-05-23T12:30:00.000Z",
          reason: "category-opt-out",
          updated: "2026-05-23T12:30:00.500Z",
        },
      ]);
      mockPullEvents.mockResolvedValue([
        {
          id: "doomed-1",
          device_id: "device-b",
          timestamp: "2026-05-23T12:00:00.000Z",
          local_date: "2026-05-23",
          tz_offset_min: 0,
          event_type: "writing.typed",
          work_id: null,
          schema_version: 1,
          encrypted_payload: uint8ToBase64(encrypted as Uint8Array),
          updated: "2026-05-23T12:30:00.600Z",
        },
      ]);

      await syncMetricsRows("pass");

      const events = await testDb.select<{ id: string }[]>(
        "SELECT id FROM metrics_events",
      );
      const tombstones = await testDb.select<{ id: string }[]>(
        "SELECT id FROM metrics_event_tombstones",
      );
      expect(events).toEqual([]);
      expect(tombstones).toEqual([{ id: "doomed-1" }]);
    });

    it("invalidates aggregate caches after applying remote rows", async () => {
      await upsertCache(testDb, {
        cacheKey: "heatmap:2026",
        aggregateVersion: 1,
        sourceHighWatermark: "2026-05-23T12:00:00.000Z",
        windowStart: "2026-01-01T00:00:00.000Z",
        computedAt: "2026-05-23T12:01:00.000Z",
        payload: { days: [] },
      });
      mockPullTombstones.mockResolvedValue([
        {
          id: "t-1",
          device_id: "device-b",
          deleted_at: "2026-05-23T12:30:00.000Z",
          reason: "category-opt-out",
          updated: "2026-05-23T12:30:00.000Z",
        },
      ]);

      await syncMetricsRows("pass");

      const cacheRows = await testDb.select<{ cache_key: string }[]>(
        "SELECT cache_key FROM metrics_cache",
      );
      expect(cacheRows).toEqual([]);
    });

    it("skips rows whose ciphertext cannot be decrypted", async () => {
      mockDecrypt.mockRejectedValueOnce(new Error("bad key"));
      mockPullEvents.mockResolvedValue([
        {
          id: "garbled",
          device_id: "device-b",
          timestamp: "2026-05-23T13:00:00.000Z",
          local_date: "2026-05-23",
          tz_offset_min: 0,
          event_type: "writing.typed",
          work_id: null,
          schema_version: 1,
          encrypted_payload: "AAAA",
          updated: "2026-05-23T13:00:00.123Z",
        },
      ]);

      await syncMetricsRows("wrong-passphrase");

      const rows = await testDb.select<{ id: string }[]>(
        "SELECT id FROM metrics_events",
      );
      expect(rows).toEqual([]);
      // Watermark still advances so we don't keep retrying the same row each
      // sync — the next push from the right device will resurface it.
      expect(localStorage.getItem(EVENT_WATERMARK_KEY)).toBe(
        "2026-05-23T13:00:00.123Z",
      );
    });
  });

  describe("applyLegacyBlobAndMarkPushed()", () => {
    it("imports legacy blob rows and marks all locals as pushed", async () => {
      await insertEvents(testDb, [buildEvent({ id: "local-1" })]);

      await applyLegacyBlobAndMarkPushed({
        events: [buildEvent({ id: "blob-1", deviceId: "device-b" })],
        tombstones: [
          {
            id: "blob-tomb-1",
            deleted_at: "2026-05-23T13:00:00.000Z",
            device_id: "device-b",
            reason: "category-opt-out",
          },
        ],
        updatedAt: 1000,
      });

      // Locals + blob rows present, none of them remain in the unpushed queue.
      const unpushedEvents = await testDb.select<{ id: string }[]>(
        "SELECT id FROM metrics_events WHERE pushed_at IS NULL",
      );
      const unpushedTombstones = await testDb.select<{ id: string }[]>(
        "SELECT id FROM metrics_event_tombstones WHERE pushed_at IS NULL",
      );
      expect(unpushedEvents).toEqual([]);
      expect(unpushedTombstones).toEqual([]);

      const eventIds = await testDb.select<{ id: string }[]>(
        "SELECT id FROM metrics_events ORDER BY id",
      );
      expect(eventIds.map((row) => row.id)).toEqual(["blob-1", "local-1"]);
    });
  });
});

function uint8ToBase64(data: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < data.byteLength; i++) binary += String.fromCharCode(data[i]);
  return btoa(binary);
}
