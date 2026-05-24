import type { MetricEvent } from "../../features/metrics/types";
import type {
  AggregateKey,
  AggregateParams,
  AggregatePayload,
  StreakAggregate,
} from "../../features/metrics/aggregates/types";
import type { DayWordTotal } from "../../features/metrics/events-repo";

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
  | {
      type: "computeStreakFromDays";
      id: number;
      dayTotals: DayWordTotal[];
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
  | {
      type: "streakComputed";
      id: number;
      payload: StreakAggregate;
    }
  | { type: "needFlush" }
  | { type: "error"; id?: number; message: string };
