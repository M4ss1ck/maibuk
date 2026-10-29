// The Reader performance gates (issue #653) judge a saved report, so their
// rules are pinned here: iframe attribution counts only when every iframe in
// the page is Reader's, a long task counts only inside a Reader action, the
// start-up and heap deltas use the Plugins bench's noise rule, and a missing
// measurement is "unmeasured", never a pass or a fail. The bench itself is
// `pnpm bench:reader`, which is never part of the test suite.
import { describe, expect, it } from "vitest";
import {
  LONG_TASK_MS,
  MEMORY_GROWTH_LIMIT,
  type ReaderBenchReport,
  attributeLongTasks,
  checkReaderBench,
  isReaderIframe,
  median,
  nearestRank,
} from "../../../scripts/reader-bench-budget.mjs";

const MIB = 1024 * 1024;
const READING = { title: "Reading", ariaHidden: null, sandbox: "allow-scripts" };
const HOST_SANDBOX = { title: null, ariaHidden: "true", sandbox: "allow-scripts" };

type Frame = { title: string | null; ariaHidden: string | null; sandbox: string | null };
type Typing = NonNullable<ReaderBenchReport["typing"]>;

function report(
  overrides: {
    disabledStartup?: number[];
    enabledStartup?: number[];
    disabledHeap?: number[];
    enabledHeap?: number[];
    iframes?: Frame[];
    longTasks?: {
      startMs: number;
      durationMs: number;
      attribution?: { containerType?: string }[];
    }[];
    actions?: { startMs: number; endMs: number }[];
    baseline?: number;
    afterLeave?: number;
    control?: { baseline: number; afterLeave: number } | null;
    typing?: Typing;
    omitDocument?: boolean;
  } = {}
): ReaderBenchReport {
  return {
    idle: {
      disabled: {
        startupMs: overrides.disabledStartup ?? [500, 502, 498],
        heapBytes: overrides.disabledHeap ?? [20 * MIB, 20 * MIB, 20 * MIB],
      },
      enabled: {
        startupMs: overrides.enabledStartup ?? [501, 503, 499],
        heapBytes: overrides.enabledHeap ?? [20 * MIB, 20 * MIB, 20 * MIB],
      },
    },
    control:
      overrides.control === undefined
        ? { baselineHeapBytes: 19 * MIB, afterLeaveHeapBytes: 21 * MIB }
        : overrides.control === null
          ? null
          : {
              baselineHeapBytes: overrides.control.baseline,
              afterLeaveHeapBytes: overrides.control.afterLeave,
            },
    document: overrides.omitDocument
      ? null
      : {
          iframes: overrides.iframes ?? [READING, HOST_SANDBOX],
          baselineHeapBytes: overrides.baseline ?? 20 * MIB,
          afterLeaveHeapBytes: overrides.afterLeave ?? 21 * MIB,
          actions: overrides.actions ?? [{ startMs: 1000, endMs: 2000 }],
          longTasks: overrides.longTasks ?? [],
          firstPageMs: { pdf: 900, epub: 150 },
          turnMs: { pdf: [10, 12, 14], epub: [15, 16, 17] },
        },
    typing: overrides.typing ?? {
      before: { ok: false, p95Ms: 16.7, refreshIntervalMs: 16.7 },
      after: { ok: false, p95Ms: 16.7, refreshIntervalMs: 16.7 },
    },
  };
}

describe("reader bench budget", () => {
  it("recognises the Reading Frame and the hidden sandbox host as Reader's iframes", () => {
    expect(isReaderIframe(READING)).toBe(true);
    expect(isReaderIframe(HOST_SANDBOX)).toBe(true);
    expect(isReaderIframe({ title: "Ads", ariaHidden: null })).toBe(false);
  });

  it("uses the median for the idle deltas and nearest-rank for the trace p95", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(nearestRank([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95)).toBe(10);
    expect(nearestRank([1, 2, 3, 4], 0.5)).toBe(2);
  });

  it("passes when every gate holds", () => {
    const result = checkReaderBench(report());
    expect(result.unmeasured).toEqual([]);
    expect(result.gates.map((gate) => gate.id)).toEqual([
      "idle-startup",
      "idle-heap",
      "no-jank",
      "memory-vs-control",
      "editor-typing",
    ]);
    expect(result.gates.filter((gate) => !gate.ok)).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("fails start-up when the enabled median is past the noise threshold", () => {
    // 500 ms baseline: threshold max(5% = 25 ms, 20 ms) = 25 ms; a 40 ms delta fails.
    const result = checkReaderBench(report({ enabledStartup: [540, 541, 539] }));
    expect(result.gates.find((gate) => gate.id === "idle-startup")?.ok).toBe(false);
    expect(result.ok).toBe(false);
  });

  it("accepts a start-up delta inside the noise threshold", () => {
    const result = checkReaderBench(report({ enabledStartup: [515, 516, 514] }));
    expect(result.gates.find((gate) => gate.id === "idle-startup")?.ok).toBe(true);
  });

  it("fails the heap gate past 1 MiB or 5%, whichever is larger", () => {
    const result = checkReaderBench(report({ enabledHeap: [22 * MIB, 22 * MIB, 22 * MIB] }));
    expect(result.gates.find((gate) => gate.id === "idle-heap")?.ok).toBe(false);
  });

  it("passes the memory gate when Reader's growth over the control is within 10% of its baseline", () => {
    // Reader: 20 -> 23 MiB (+3). Control: 19 -> 21.5 MiB (+2.5). Reader-attributable
    // growth = 3 - 2.5 = 0.5 MiB = 2.5% of Reader's 20 MiB baseline.
    const result = checkReaderBench(
      report({ baseline: 20 * MIB, afterLeave: 23 * MIB, control: { baseline: 19 * MIB, afterLeave: 21.5 * MIB } })
    );
    const row = result.gates.find((gate) => gate.id === "memory-vs-control");
    expect(MEMORY_GROWTH_LIMIT).toBe(0.1);
    expect(row?.ok).toBe(true);
    expect(row?.value).toBeCloseTo(2.5, 6);
    expect(row?.limit).toBe(10);
  });

  it("fails the memory gate when Reader grows more than 10% of its baseline beyond the control", () => {
    // Reader: 20 -> 23.5 MiB (+3.5). Control: 20 -> 21 MiB (+1). Growth = 2.5 MiB = 12.5%.
    const result = checkReaderBench(
      report({ baseline: 20 * MIB, afterLeave: 23.5 * MIB, control: { baseline: 20 * MIB, afterLeave: 21 * MIB } })
    );
    const row = result.gates.find((gate) => gate.id === "memory-vs-control");
    expect(row?.ok).toBe(false);
    expect(row?.value).toBeCloseTo(12.5, 6);
    expect(result.ok).toBe(false);
  });

  it("passes at exactly 10% of the baseline", () => {
    // Reader: 20 -> 22 MiB (+2). Control: 20 -> 20 MiB. Growth = 2 MiB = exactly 10%.
    const result = checkReaderBench(
      report({ baseline: 20 * MIB, afterLeave: 22 * MIB, control: { baseline: 20 * MIB, afterLeave: 20 * MIB } })
    );
    const row = result.gates.find((gate) => gate.id === "memory-vs-control");
    expect(row?.value).toBeCloseTo(10, 6);
    expect(row?.ok).toBe(true);
  });

  it("clamps the growth at zero when the control grows more than Reader", () => {
    // Reader: 20 -> 21 MiB (+1). Control: 20 -> 23 MiB (+3). Raw difference -2 MiB, clamped to 0.
    const result = checkReaderBench(
      report({ baseline: 20 * MIB, afterLeave: 21 * MIB, control: { baseline: 20 * MIB, afterLeave: 23 * MIB } })
    );
    const row = result.gates.find((gate) => gate.id === "memory-vs-control");
    expect(row?.value).toBe(0);
    expect(row?.ok).toBe(true);
  });

  it("reports both raw ratios beside the gate", () => {
    // Reader 19.04 -> 23.46 MiB (1.23x); control 19.04 -> 21.32 MiB (1.12x).
    const result = checkReaderBench(
      report({
        baseline: 19.04 * MIB,
        afterLeave: 23.46 * MIB,
        control: { baseline: 19.04 * MIB, afterLeave: 21.32 * MIB },
      })
    );
    const row = result.gates.find((gate) => gate.id === "memory-vs-control");
    expect(row?.detail).toContain("reader 1.23x");
    expect(row?.detail).toContain("control 1.12x");
    expect(result.trace.map((entry) => entry.label)).toContain("control heap ratio after leave (x)");
  });

  it("marks the run unmeasured when the control visit is missing", () => {
    const result = checkReaderBench(report({ control: null }));
    expect(result.unmeasured).toContain("the control visit is missing");
    expect(result.ok).toBe(false);
  });

  it("counts an iframe-attributed long task as Reader's only when every iframe is Reader's", () => {
    const task = { startMs: 5000, durationMs: 80, attribution: [{ containerType: "iframe" }] };
    const onlyReader = attributeLongTasks([task], [], true);
    expect(onlyReader[0].reader).toBe(true);
    const foreign = attributeLongTasks([task], [], false);
    expect(foreign[0].reader).toBe(false);
    expect(foreign[0].reason).toBe("other iframe");
  });

  it("fails the jank gate on a host long task that overlaps a Reader action", () => {
    const result = checkReaderBench(
      report({
        longTasks: [{ startMs: 1200, durationMs: 60, attribution: [{ containerType: "window" }] }],
      })
    );
    const jank = result.gates.find((gate) => gate.id === "no-jank");
    expect(jank?.ok).toBe(false);
    expect(jank?.detail).toContain("host during a reader action");
  });

  it("ignores a host long task outside every Reader action", () => {
    const result = checkReaderBench(
      report({
        longTasks: [{ startMs: 100, durationMs: 300, attribution: [{ containerType: "window" }] }],
      })
    );
    expect(result.gates.find((gate) => gate.id === "no-jank")?.ok).toBe(true);
    expect(LONG_TASK_MS).toBe(50);
  });

  it("marks the run unmeasured when the page has a foreign iframe", () => {
    const foreignFrame = { title: "Other Plugin", ariaHidden: null, sandbox: "allow-scripts" };
    const result = checkReaderBench(report({ iframes: [READING, HOST_SANDBOX, foreignFrame] }));
    expect(result.unmeasured.join(" ")).toContain("not Reader's");
    expect(result.ok).toBe(false);
  });

  it("marks the run unmeasured when the document run is missing", () => {
    const result = checkReaderBench(report({ omitDocument: true }));
    expect(result.unmeasured).toContain("the document run is missing");
    expect(result.ok).toBe(false);
  });

  it("gates typing on the after-minus-before p95, one vsync allowed", () => {
    const within = checkReaderBench(
      report({
        typing: {
          before: { ok: true, p95Ms: 11, refreshIntervalMs: 16.7 },
          after: { ok: true, p95Ms: 27, refreshIntervalMs: 16.7 },
        },
      })
    );
    expect(within.gates.find((gate) => gate.id === "editor-typing")?.ok).toBe(true);
    const past = checkReaderBench(
      report({
        typing: {
          before: { ok: true, p95Ms: 11, refreshIntervalMs: 16.7 },
          after: { ok: true, p95Ms: 40, refreshIntervalMs: 16.7 },
        },
      })
    );
    expect(past.gates.find((gate) => gate.id === "editor-typing")?.ok).toBe(false);
  });

  it("marks typing unmeasured when the before or after run is missing", () => {
    const result = checkReaderBench(report({ typing: { before: null, after: null } }));
    expect(result.unmeasured).toContain("the editor typing run before or after reading is missing");
  });
});
