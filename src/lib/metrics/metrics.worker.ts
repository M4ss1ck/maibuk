import type { WorkerRequest, WorkerResponse } from "./types";
import type { MetricEvent } from "../../features/metrics/types";
import { computeAggregate } from "../../features/metrics/aggregates/compute";

let buffer: MetricEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function respond(message: WorkerResponse) {
  self.postMessage(message);
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    if (buffer.length > 0) {
      respond({ type: "needFlush" });
    }
  }, 30_000);
}

function drain(): MetricEvent[] {
  const events = buffer;
  buffer = [];
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  return events;
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;

  switch (msg.type) {
    case "init":
      respond({ type: "ready", id: msg.id });
      break;
    case "recordEvents":
      buffer.push(...msg.events);
      scheduleFlush();
      break;
    case "flushNow":
      respond({ type: "flushReady", id: msg.id, events: drain() });
      break;
    case "computeAggregate":
      respond({
        type: "computed",
        id: msg.id,
        key: msg.key,
        payload: computeAggregate(msg.key, msg.rows, msg.params),
        sourceHighWatermark: getHighWatermark(msg.rows),
      });
      break;
    case "shutdown":
      drain();
      break;
  }
};

function getHighWatermark(rows: MetricEvent[]): string {
  return rows.reduce(
    (max, row) => (row.timestamp > max ? row.timestamp : max),
    "",
  );
}
