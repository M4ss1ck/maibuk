export const LONG_TASK_MS: number;
export const MEMORY_GROWTH_LIMIT: number;
export const NOISE: {
  timePercent: number;
  timeFloorMs: number;
  heapPercent: number;
  heapFloorBytes: number;
};

export interface LongTaskEntry {
  startMs: number;
  durationMs: number;
  attribution?: { containerType?: string }[];
}

export interface BenchWindow {
  startMs: number;
  endMs: number;
}

export interface ReaderBenchReport {
  version?: number;
  idle?: {
    disabled?: { startupMs: number[]; booksMs?: number[]; heapBytes: number[] } | null;
    enabled?: { startupMs: number[]; booksMs?: number[]; heapBytes: number[] } | null;
  };
  /** The control visit: Reader disabled, an in-app visit to Settings and back (same sampling). */
  control?: { baselineHeapBytes: number; afterLeaveHeapBytes: number } | null;
  document?: {
    iframes?: { title: string | null; ariaHidden: string | null; sandbox: string | null }[];
    baselineHeapBytes: number;
    afterLeaveHeapBytes: number;
    actions: BenchWindow[];
    longTasks: LongTaskEntry[];
    firstPageMs?: { pdf?: number; epub?: number };
    turnMs?: { pdf?: number[]; epub?: number[] };
  } | null;
  typing?: {
    before?: { ok: boolean; p95Ms: number; refreshIntervalMs?: number } | null;
    after?: { ok: boolean; p95Ms: number; refreshIntervalMs?: number } | null;
  } | null;
}

export interface ReaderBenchGate {
  id: string;
  label: string;
  value: number;
  limit: number;
  ok: boolean;
  detail: string;
}

export function median(values: number[]): number;
export function nearestRank(values: number[], p: number): number;
export function readerGrowthBytes(
  reader: { baselineHeapBytes: number; afterLeaveHeapBytes: number },
  control: { baselineHeapBytes: number; afterLeaveHeapBytes: number }
): number;
export function isReaderIframe(frame: { title: string | null; ariaHidden: string | null }): boolean;
export function attributeLongTasks(
  tasks: LongTaskEntry[],
  windows: BenchWindow[],
  iframesAreReaders: boolean
): (LongTaskEntry & { reader: boolean; reason: string })[];
export function checkReaderBench(report: ReaderBenchReport): {
  gates: ReaderBenchGate[];
  trace: { label: string; value: number }[];
  unmeasured: string[];
  ok: boolean;
};
export function printReaderBench(
  result: ReturnType<typeof checkReaderBench>,
  heading?: string
): number;
