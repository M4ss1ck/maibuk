export interface LineStats {
  record(latencyMs: number | undefined): void;
  summary(): { lines: number; medianLatencyMs: number | null };
}

/**
 * Recent per-line engine latency, shown in Settings → Dictation. Memory only:
 * a Metrics event would sync to the server. With an even count the median is
 * the upper middle value, so it is always a latency that really happened.
 */
export function createLineStats(capacity = 50): LineStats {
  const recent: number[] = [];
  let lines = 0;
  return {
    record(latencyMs) {
      lines += 1;
      if (latencyMs === undefined) return;
      recent.push(latencyMs);
      if (recent.length > capacity) recent.shift();
    },
    summary() {
      if (recent.length === 0) return { lines, medianLatencyMs: null };
      const sorted = [...recent].sort((a, b) => a - b);
      return { lines, medianLatencyMs: sorted[Math.floor(sorted.length / 2)] };
    },
  };
}
