import { beforeEach, describe, expect, it } from "vitest";
import type { DatabaseAdapter } from "../../../../lib/platform/types";
import { createTestDatabase } from "../../../support/db-test-context";
import { ensureMetricsSchema, listEvents } from "../../../../features/metrics/events-repo";
import type { MetricEvent } from "../../../../features/metrics/types";
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
