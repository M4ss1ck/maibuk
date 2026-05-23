import type { MetricEvent } from "../../features/metrics/types";

export type WorkerRequest =
  | { type: "init"; id: number; deviceId: string }
  | { type: "recordEvents"; events: MetricEvent[] }
  | { type: "flushNow"; id: number }
  | {
      type: "computeAggregate";
      id: number;
      key: string;
      rows: MetricEvent[];
      params: Record<string, unknown>;
    }
  | { type: "shutdown" };

export type WorkerResponse =
  | { type: "ready"; id: number }
  | { type: "flushReady"; id: number; events: MetricEvent[] }
  | {
      type: "computed";
      id: number;
      key: string;
      payload: unknown;
      sourceHighWatermark: string;
    }
  | { type: "needFlush" }
  | { type: "error"; id?: number; message: string };
