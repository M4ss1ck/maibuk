import { describe, expect, it } from "vitest";
import { createLineStats } from "@/features/dictation/stats";

describe("createLineStats()", () => {
  it("reports the median engine latency of recent lines", () => {
    // Capacity 3 keeps 300, 200, 50: the oldest line (100) has left the ring.
    const stats = createLineStats(3);
    for (const ms of [100, 300, 200, 50]) stats.record(ms);
    expect(stats.summary()).toEqual({ lines: 4, medianLatencyMs: 200 });
  });

  it("stays bounded however many lines are recorded", () => {
    const stats = createLineStats(5);
    for (let i = 0; i < 1000; i++) stats.record(i < 995 ? 10_000 : 1);
    expect(stats.summary()).toEqual({ lines: 1000, medianLatencyMs: 1 });
  });

  it("counts lines without a latency but leaves the median alone", () => {
    const stats = createLineStats();
    stats.record(undefined);
    expect(stats.summary()).toEqual({ lines: 1, medianLatencyMs: null });
    stats.record(120);
    stats.record(undefined);
    expect(stats.summary()).toEqual({ lines: 3, medianLatencyMs: 120 });
  });
});
