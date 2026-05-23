import type { MetricEvent } from "../../features/metrics/types";
import type {
  AggregateKey,
  AggregateParams,
  AggregatePayload,
} from "../../features/metrics/aggregates/types";

export type WorkerRequest =
  | { type: "init"; id: number; deviceId: string }
  | { type: "recordEvents"; events: MetricEvent[] }
  | { type: "flushNow"; id: number }
  | {
      type: "computeAggregate";
      id: number;
      key: AggregateKey;
      rows: MetricEvent[];
      params: AggregateParams;
    }
  | { type: "shutdown" };

export type WorkerResponse =
  | { type: "ready"; id: number }
  | { type: "flushReady"; id: number; events: MetricEvent[] }
  | {
      type: "computed";
      id: number;
      key: AggregateKey;
      payload: AggregatePayload;
      sourceHighWatermark: string;
    }
  | { type: "needFlush" }
  | { type: "error"; id?: number; message: string };
