import { describe, expect, it } from "vitest";
import { createLineStats } from "@/features/dictation/stats";

const summary = (
  overrides: Partial<ReturnType<ReturnType<typeof createLineStats>["summary"]>>
) => ({
  lines: 0,
  medianLatencyMs: null as number | null,
  medianInterpreterMs: null as number | null,
  maxInterpreterMs: null as number | null,
  spokenPunctuationCount: 0,
  scratchCount: 0,
  voiceCommandCount: 0,
  ...overrides,
});

describe("createLineStats()", () => {
  it("reports the median engine latency of recent lines", () => {
    // Capacity 3 keeps 300, 200, 50: the oldest line (100) has left the ring.
    const stats = createLineStats(3);
    for (const ms of [100, 300, 200, 50]) stats.record(ms);
    expect(stats.summary()).toEqual(summary({ lines: 4, medianLatencyMs: 200 }));
  });

  it("stays bounded however many lines are recorded", () => {
    const stats = createLineStats(5);
    for (let i = 0; i < 1000; i++) stats.record(i < 995 ? 10_000 : 1);
    expect(stats.summary()).toEqual(summary({ lines: 1000, medianLatencyMs: 1 }));
  });

  it("counts lines without a latency but leaves the median alone", () => {
    const stats = createLineStats();
    stats.record(undefined);
    expect(stats.summary()).toEqual(summary({ lines: 1 }));
    stats.record(120);
    stats.record(undefined);
    expect(stats.summary()).toEqual(summary({ lines: 3, medianLatencyMs: 120 }));
  });

  it("reports the median interpreter delay, upper middle value kept", () => {
    const stats = createLineStats(3);
    // Capacity 3 keeps 300, 200, 50: the oldest line (100) has left the ring.
    for (const ms of [100, 300, 200, 50]) stats.recordInterpreter(ms, 0);
    const { medianInterpreterMs, maxInterpreterMs } = stats.summary();
    expect(medianInterpreterMs).toBe(200);
    expect(maxInterpreterMs).toBe(300);
  });

  it("keeps the interpreter samples bounded however many lines are interpreted", () => {
    const stats = createLineStats(5);
    for (let i = 0; i < 1000; i++) stats.recordInterpreter(i < 995 ? 10_000 : 1, 0);
    const { medianInterpreterMs, maxInterpreterMs } = stats.summary();
    expect(medianInterpreterMs).toBe(1);
    expect(maxInterpreterMs).toBe(1);
  });

  it("sums the spoken punctuation hits across every interpreted line", () => {
    const stats = createLineStats();
    stats.recordInterpreter(8, 0);
    stats.recordInterpreter(9, 2);
    stats.recordInterpreter(7, 1);
    expect(stats.summary().spokenPunctuationCount).toBe(3);
  });

  it("keeps interpreter data apart from the engine latency lines", () => {
    const stats = createLineStats();
    stats.record(120);
    stats.record(60);
    stats.recordInterpreter(8, 1);
    stats.recordInterpreter(9, 2);
    // The interpreter runs per interpreted line; `lines` still counts engine lines.
    expect(stats.summary()).toEqual(
      summary({
        lines: 2,
        medianLatencyMs: 120,
        medianInterpreterMs: 9,
        maxInterpreterMs: 9,
        spokenPunctuationCount: 3,
      })
    );
  });

  it("reports no interpreter timing until a line is interpreted", () => {
    const stats = createLineStats();
    stats.record(120);
    expect(stats.summary()).toEqual(summary({ lines: 1, medianLatencyMs: 120 }));
    stats.recordInterpreter(10, 0);
    expect(stats.summary()).toEqual(
      summary({
        lines: 1,
        medianLatencyMs: 120,
        medianInterpreterMs: 10,
        maxInterpreterMs: 10,
      })
    );
  });

  it("sums scratch uses across every interpreted line", () => {
    const stats = createLineStats();
    stats.recordInterpreter(8, 0, 1);
    stats.recordInterpreter(9, 2, 0);
    stats.recordInterpreter(7, 1, 1);
    const result = stats.summary();
    expect(result.scratchCount).toBe(2);
    expect(result.spokenPunctuationCount).toBe(3);
  });

  it("defaults scratch uses to zero for older callers", () => {
    const stats = createLineStats();
    stats.recordInterpreter(8, 2);
    expect(stats.summary()).toEqual(
      summary({ medianInterpreterMs: 8, maxInterpreterMs: 8, spokenPunctuationCount: 2 })
    );
  });

  it("sums Voice Commands across every interpreted line", () => {
    const stats = createLineStats();
    stats.recordInterpreter(8, 0, 0, 1);
    stats.recordInterpreter(9, 2, 0, 0);
    stats.recordInterpreter(7, 0, 1, 1);
    const result = stats.summary();
    expect(result.voiceCommandCount).toBe(2);
    expect(result.spokenPunctuationCount).toBe(2);
    expect(result.scratchCount).toBe(1);
  });
});
