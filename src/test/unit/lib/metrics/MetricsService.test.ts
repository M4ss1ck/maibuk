import { beforeEach, describe, expect, it } from "vitest";
import type { DatabaseAdapter } from "../../../../lib/platform/types";
import { createTestDatabase } from "../../../support/db-test-context";
import {
  ensureMetricsSchema,
  insertEvents,
  listEvents,
  upsertCache,
} from "../../../../features/metrics/events-repo";
import type { MetricEvent } from "../../../../features/metrics/types";
import { computeAggregate } from "../../../../features/metrics/aggregates/compute";
import { createMetricsService } from "../../../../lib/metrics/MetricsService";
import type { WorkerRequest, WorkerResponse } from "../../../../lib/metrics/types";

class MockWorker {
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
  posted: WorkerRequest[] = [];
  terminated = false;

  postMessage(message: WorkerRequest) {
    this.posted.push(message);
    if (message.type === "init") {
      this.emit({ type: "ready", id: message.id });
    }
    if (message.type === "flushNow") {
      const recorded = this.posted
        .filter((posted): posted is Extract<WorkerRequest, { type: "recordEvents" }> => posted.type === "recordEvents")
        .flatMap((posted) => posted.events);
      this.emit({ type: "flushReady", id: message.id, events: recorded });
    }
    if (message.type === "computeAggregate") {
      this.emit({
        type: "computed",
        id: message.id,
        key: message.key,
        payload: computeAggregate(message.key, message.rows, message.params),
        sourceHighWatermark: message.rows[message.rows.length - 1]?.timestamp ?? "",
      });
    }
  }

  terminate() {
    this.terminated = true;
  }

  emit(message: WorkerResponse) {
    this.onmessage?.({ data: message } as MessageEvent<WorkerResponse>);
  }
}

let testDb: DatabaseAdapter;

function buildEvent(): MetricEvent {
  return {
    id: "event-1",
    timestamp: "2026-05-23T12:00:00.000Z",
    localDate: "2026-05-23",
    tzOffsetMin: 180,
    deviceId: "device-1",
    eventType: "writing.typed",
    workId: "book-1",
    payload: { words: 2, chars: 10, chapterId: "chapter-1" },
    schemaVersion: 1,
  };
}

describe("MetricsService", () => {
  beforeEach(async () => {
    testDb = await createTestDatabase();
    await ensureMetricsSchema(testDb);
  });

  it("initializes with an id-correlated ready response", async () => {
    const worker = new MockWorker();
    const service = createMetricsService({
      createWorker: () => worker as unknown as Worker,
      getDatabase: async () => testDb,
      getDeviceId: () => "device-1",
    });

    await service.init();

    expect(worker.posted[0]).toEqual({ type: "init", id: 1, deviceId: "device-1" });
  });

  it("round-trips buffered worker events into SQLite on flush", async () => {
    const worker = new MockWorker();
    const service = createMetricsService({
      createWorker: () => worker as unknown as Worker,
      getDatabase: async () => testDb,
      getDeviceId: () => "device-1",
    });

    await service.init();
    service.recordEvents([buildEvent()]);
    await service.flushNow();

    expect(await listEvents(testDb)).toHaveLength(1);
    expect(worker.posted.map((message) => message.type)).toEqual([
      "init",
      "recordEvents",
      "flushNow",
    ]);
  });

  it("does not lose first events when flush is requested before init settles", async () => {
    const worker = new MockWorker();
    const service = createMetricsService({
      createWorker: () => worker as unknown as Worker,
      getDatabase: async () => testDb,
      getDeviceId: () => "device-1",
    });

    service.recordEvents([buildEvent()]);
    await service.flushNow();

    expect(await listEvents(testDb)).toHaveLength(1);
  });

  it("does not start or write events when disabled by the dev flag", async () => {
    localStorage.setItem("maibuk.metrics.disabled", "true");
    const worker = new MockWorker();
    const service = createMetricsService({
      createWorker: () => worker as unknown as Worker,
      getDatabase: async () => testDb,
      getDeviceId: () => "device-1",
    });

    await service.init();
    service.recordEvents([buildEvent()]);
    await service.flushNow();

    expect(worker.posted).toEqual([]);
    expect(await listEvents(testDb)).toEqual([]);
    localStorage.removeItem("maibuk.metrics.disabled");
  });

  it("computes aggregate chunks through the worker and writes a cache row", async () => {
    await insertEvents(testDb, [
      buildEvent(),
      { ...buildEvent(), id: "event-2", timestamp: "2026-05-23T12:01:00.000Z" },
    ]);
    const worker = new MockWorker();
    const service = createMetricsService({
      createWorker: () => worker as unknown as Worker,
      getDatabase: async () => testDb,
      getDeviceId: () => "device-1",
    });

    const payload = await service.getAggregate("heatmap:2026");
    const computeMessages = worker.posted.filter(
      (message): message is Extract<WorkerRequest, { type: "computeAggregate" }> =>
        message.type === "computeAggregate",
    );
    const cacheRows = await testDb.select<{ cache_key: string }[]>(
      "SELECT cache_key FROM metrics_cache",
    );

    expect(payload).toEqual({
      days: [{ date: "2026-05-23", words: 4, events: 2 }],
    });
    expect(computeMessages).toHaveLength(1);
    expect(computeMessages[0].rows.length).toBeLessThanOrEqual(10_000);
    expect(cacheRows).toEqual([{ cache_key: "heatmap:2026" }]);
  });

  it("returns warm aggregates from cache without recomputing", async () => {
    await upsertCache(testDb, {
      cacheKey: "heatmap:2026",
      aggregateVersion: 1,
      sourceHighWatermark: "2026-12-31T23:59:59.000Z",
      computedAt: "2026-05-23T12:00:00.000Z",
      payload: { days: [{ date: "2026-05-23", words: 99, events: 1 }] },
    });
    const worker = new MockWorker();
    const service = createMetricsService({
      createWorker: () => worker as unknown as Worker,
      getDatabase: async () => testDb,
      getDeviceId: () => "device-1",
    });

    const payload = await service.getAggregate("heatmap:2026");

    expect(payload).toEqual({
      days: [{ date: "2026-05-23", words: 99, events: 1 }],
    });
    expect(worker.posted.some((message) => message.type === "computeAggregate")).toBe(false);
  });

  it("terminates the worker on shutdown", async () => {
    const worker = new MockWorker();
    const service = createMetricsService({
      createWorker: () => worker as unknown as Worker,
      getDatabase: async () => testDb,
      getDeviceId: () => "device-1",
    });

    await service.init();
    service.shutdown();

    expect(worker.terminated).toBe(true);
  });
});
