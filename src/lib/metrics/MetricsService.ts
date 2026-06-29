import { getDatabase } from "@/lib/db";
import type { DatabaseAdapter } from "@/lib/platform/types";
import { getOrCreateDeviceId } from "@/features/metrics/device-id";
import {
  getCacheEntry,
  getDailyWritingHighWatermark,
  getSourceHighWatermark,
  getWindowLowerBound,
  insertEventsRespectingTombstones,
  listDailyWritingTotals,
  listEventsForAggregate,
  upsertCache,
} from "@/features/metrics/events-repo";
import { isMetricsDevDisabled } from "@/features/metrics/settings";
import { useMetricsStore } from "@/features/metrics/store";
import { SessionTracker } from "@/features/metrics/session-tracker";
import { useSettingsStore } from "@/features/settings/store";
import type { MetricEvent } from "@/features/metrics/types";
import {
  METRICS_AGGREGATE_PAGE_SIZE,
  METRICS_AGGREGATE_VERSION,
  type AggregateKey,
  type AggregateParams,
  type AggregatePayload,
} from "@/features/metrics/aggregates/types";
import { mergeAggregatePayloads } from "@/features/metrics/aggregates/compute";
import type { WorkerRequest, WorkerResponse } from "@/lib/metrics/types";

type PendingRequest = {
  resolve: (value: WorkerResponse) => void;
  reject: (error: Error) => void;
};

interface MetricsServiceOptions {
  createWorker?: () => Worker;
  getDatabase?: () => Promise<DatabaseAdapter>;
  getDeviceId?: () => string;
}

export class MetricsService {
  private worker: Worker | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, PendingRequest>();
  private readyPromise: Promise<void> | null = null;
  private beforeUnloadHandler: (() => void) | null = null;
  private visibilityHandler: (() => void) | null = null;
  private sessionTracker: SessionTracker | null = null;
  private sessionWorkId: string | null = null;
  private lastActiveAt: number | null = null;

  constructor(private options: Required<MetricsServiceOptions>) {}

  async init(): Promise<void> {
    if (this.isDisabled()) return;
    if (this.readyPromise && this.worker) return this.readyPromise;

    this.worker = this.options.createWorker();
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      void this.handleMessage(event.data);
    };

    const id = ++this.requestId;
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve: (message) => {
          if (message.type === "ready") {
            useMetricsStore.getState().setWorkerReady(true);
            resolve();
            return;
          }
          reject(new Error("Metrics worker did not become ready"));
        },
        reject,
      });
    });

    this.send({ type: "init", id, deviceId: this.options.getDeviceId() });
    this.installBeforeUnloadFlush();
    return this.readyPromise;
  }

  recordEvents(events: MetricEvent[]): void {
    if (events.length === 0 || this.isDisabled()) return;
    const filtered = this.filterDisabledCategories(events);
    if (filtered.length === 0) return;

    if (!this.worker) {
      void this.init();
    }

    this.send({ type: "recordEvents", events: filtered });
  }

  markActive(workId: string | null, now: Date = new Date()): void {
    if (this.isDisabled()) return;
    if (!useSettingsStore.getState().metrics.enabled.time) return;

    const nowMs = now.getTime();
    const idleThresholdSec = useSettingsStore.getState().metrics.idleThresholdSec;

    if (!this.sessionTracker) {
      this.sessionTracker = this.createSessionTracker(workId);
    }

    const workChanged = this.sessionWorkId !== workId;
    const idledOut =
      this.lastActiveAt !== null && nowMs - this.lastActiveAt > idleThresholdSec * 1000;

    if (workChanged || idledOut) {
      this.endSessionInternal(new Date(this.lastActiveAt ?? nowMs));
      this.sessionTracker = this.createSessionTracker(workId);
    }

    this.sessionTracker.markActive(now);
    this.sessionWorkId = workId;
    this.lastActiveAt = nowMs;
  }

  endSession(now: Date = new Date()): void {
    this.endSessionInternal(now);
  }

  private endSessionInternal(now: Date): void {
    if (!this.sessionTracker) return;
    this.sessionTracker.end(now);
    this.sessionTracker = null;
    this.sessionWorkId = null;
    this.lastActiveAt = null;
  }

  private createSessionTracker(workId: string | null): SessionTracker {
    return new SessionTracker({
      workId,
      deviceId: this.options.getDeviceId(),
      idleThresholdSec: useSettingsStore.getState().metrics.idleThresholdSec,
      recordEvents: (events) => this.recordEvents(events),
    });
  }

  async flushNow(): Promise<void> {
    if (this.isDisabled() || !this.worker) return;
    await this.readyPromise;

    const id = ++this.requestId;
    const responsePromise = this.waitForResponse(id);
    this.send({ type: "flushNow", id });
    const response = await responsePromise;
    if (response.type === "flushReady" && response.events.length > 0) {
      const db = await this.options.getDatabase();
      // Route through tombstone-aware insert so the tombstone-wins invariant
      // is enforced direction-agnostically, not only on sync pulls.
      await insertEventsRespectingTombstones(db, response.events);
      useMetricsStore.getState().setLastFlushedAt(new Date().toISOString());
    }
  }

  private filterDisabledCategories(events: MetricEvent[]): MetricEvent[] {
    const { enabled } = useSettingsStore.getState().metrics;
    return events.filter((event) => {
      if (event.eventType.startsWith("writing.")) return enabled.writing;
      if (event.eventType.startsWith("session.")) return enabled.time;
      return true;
    });
  }

  async getAggregate(key: AggregateKey, params: AggregateParams = {}): Promise<AggregatePayload> {
    if (this.isDisabled()) {
      return mergeAggregatePayloads(key, [], params);
    }

    await this.init();
    const db = await this.options.getDatabase();

    if (key === "streak:current") {
      return this.computeStreakAggregate(db, params);
    }

    const sourceHighWatermark = await getSourceHighWatermark(db, key);
    const windowStart = getWindowLowerBound(key);
    const cached = await getCacheEntry(db, key);
    if (
      cached &&
      cached.aggregateVersion === METRICS_AGGREGATE_VERSION &&
      cached.sourceHighWatermark >= sourceHighWatermark &&
      cached.windowStart === windowStart
    ) {
      return cached.payload as AggregatePayload;
    }

    const payloads: AggregatePayload[] = [];
    for (let offset = 0; ; offset += METRICS_AGGREGATE_PAGE_SIZE) {
      const rows = await listEventsForAggregate(db, key, {
        limit: METRICS_AGGREGATE_PAGE_SIZE,
        offset,
      });
      if (rows.length === 0) break;
      payloads.push(await this.computeAggregateChunk(key, rows, params));
      if (rows.length < METRICS_AGGREGATE_PAGE_SIZE) break;
    }

    const payload = mergeAggregatePayloads(key, payloads, params);
    await upsertCache(db, {
      cacheKey: key,
      aggregateVersion: METRICS_AGGREGATE_VERSION,
      sourceHighWatermark,
      windowStart,
      computedAt: new Date().toISOString(),
      payload,
    });
    return payload;
  }

  private async computeStreakAggregate(
    db: DatabaseAdapter,
    params: AggregateParams
  ): Promise<AggregatePayload> {
    const sourceHighWatermark = await getDailyWritingHighWatermark(db);
    const today = params.today ?? formatLocalDateUTC(new Date());
    // Encode today into windowStart so the cache invalidates at the local-day
    // boundary — `currentStreak` and `daysThisWeek/Month` change with the date
    // even when no new events arrive.
    const windowStart = today;

    const cached = await getCacheEntry(db, "streak:current");
    if (
      cached &&
      cached.aggregateVersion === METRICS_AGGREGATE_VERSION &&
      cached.sourceHighWatermark >= sourceHighWatermark &&
      cached.windowStart === windowStart
    ) {
      return cached.payload as AggregatePayload;
    }

    const dayTotals = await listDailyWritingTotals(db);

    if (!this.worker) await this.init();
    await this.readyPromise;

    const id = ++this.requestId;
    const responsePromise = this.waitForResponse(id);
    this.send({ type: "computeStreakFromDays", id, dayTotals, params });
    const response = await responsePromise;
    if (response.type !== "streakComputed") {
      throw new Error("Metrics worker did not return a streak payload");
    }

    await upsertCache(db, {
      cacheKey: "streak:current",
      aggregateVersion: METRICS_AGGREGATE_VERSION,
      sourceHighWatermark,
      windowStart,
      computedAt: new Date().toISOString(),
      payload: response.payload,
    });
    return response.payload;
  }

  shutdown(): void {
    this.endSessionInternal(new Date());
    if (this.worker) {
      this.send({ type: "shutdown" });
      this.worker.terminate();
      this.worker = null;
    }
    this.pendingRequests.clear();
    this.readyPromise = null;
    useMetricsStore.getState().setWorkerReady(false);
    if (this.beforeUnloadHandler) {
      window.removeEventListener("beforeunload", this.beforeUnloadHandler);
      this.beforeUnloadHandler = null;
    }
    if (this.visibilityHandler) {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
      this.visibilityHandler = null;
    }
  }

  private async handleMessage(message: WorkerResponse): Promise<void> {
    if (message.type === "needFlush") {
      await this.flushNow();
      return;
    }

    if (message.type === "error") {
      useMetricsStore.getState().setError(message.message);
    }

    if ("id" in message && typeof message.id === "number") {
      const pending = this.pendingRequests.get(message.id);
      if (!pending) return;
      this.pendingRequests.delete(message.id);
      if (message.type === "error") {
        pending.reject(new Error(message.message));
      } else {
        pending.resolve(message);
      }
    }
  }

  private waitForResponse(id: number): Promise<WorkerResponse> {
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
    });
  }

  private async computeAggregateChunk(
    key: AggregateKey,
    rows: MetricEvent[],
    params: AggregateParams
  ): Promise<AggregatePayload> {
    if (!this.worker) await this.init();
    await this.readyPromise;

    const id = ++this.requestId;
    const responsePromise = this.waitForResponse(id);
    this.send({ type: "computeAggregate", id, key, rows, params });
    const response = await responsePromise;
    if (response.type === "computed") return response.payload;
    throw new Error("Metrics worker did not compute aggregate");
  }

  private send(message: WorkerRequest): void {
    this.worker?.postMessage(message);
  }

  private isDisabled(): boolean {
    return isMetricsDevDisabled();
  }

  private installBeforeUnloadFlush(): void {
    if (typeof window === "undefined") return;
    if (!this.beforeUnloadHandler) {
      this.beforeUnloadHandler = () => {
        this.endSessionInternal(new Date());
        void this.flushNow();
      };
      window.addEventListener("beforeunload", this.beforeUnloadHandler);
    }
    if (!this.visibilityHandler && typeof document !== "undefined") {
      this.visibilityHandler = () => {
        if (document.visibilityState === "hidden") {
          this.endSessionInternal(new Date());
          void this.flushNow();
        }
      };
      document.addEventListener("visibilitychange", this.visibilityHandler);
    }
  }
}

function formatLocalDateUTC(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function createMetricsService(options: MetricsServiceOptions = {}): MetricsService {
  return new MetricsService({
    createWorker:
      options.createWorker ??
      (() =>
        new Worker(new URL("./metrics.worker.ts", import.meta.url), {
          type: "module",
        })),
    getDatabase: options.getDatabase ?? getDatabase,
    getDeviceId: options.getDeviceId ?? getOrCreateDeviceId,
  });
}

export const metricsService = createMetricsService();
