import { getDatabase } from "../db";
import type { DatabaseAdapter } from "../platform/types";
import { getOrCreateDeviceId } from "../../features/metrics/device-id";
import { insertEvents } from "../../features/metrics/events-repo";
import { isMetricsDevDisabled } from "../../features/metrics/settings";
import { useMetricsStore } from "../../features/metrics/store";
import type { MetricEvent } from "../../features/metrics/types";
import type { WorkerRequest, WorkerResponse } from "./types";

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

    if (!this.worker) {
      void this.init();
    }

    this.send({ type: "recordEvents", events });
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
      await insertEvents(db, response.events);
      useMetricsStore.getState().setLastFlushedAt(new Date().toISOString());
    }
  }

  shutdown(): void {
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

  private send(message: WorkerRequest): void {
    this.worker?.postMessage(message);
  }

  private isDisabled(): boolean {
    return isMetricsDevDisabled();
  }

  private installBeforeUnloadFlush(): void {
    if (this.beforeUnloadHandler || typeof window === "undefined") return;
    this.beforeUnloadHandler = () => {
      void this.flushNow();
    };
    window.addEventListener("beforeunload", this.beforeUnloadHandler);
  }
}

export function createMetricsService(
  options: MetricsServiceOptions = {},
): MetricsService {
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
