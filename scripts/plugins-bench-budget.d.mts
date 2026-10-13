// Types for the plain-JavaScript Plugins bench budget check (issue #448), so
// `tsc` can type-check its test without enabling `allowJs` project-wide.
export interface PluginsBenchReport {
  engine: "chromium" | "webkit";
  /** Reasons the runner could not measure; any entry forces exit code 2. */
  unmeasured?: string[];
  /** Launch timings in ms, one sample per reload. */
  launch: { baseline: number[]; installed20: number[]; persistent3: number[] };
  /** Plugin id -> ms samples. */
  startToReady: Record<string, number[]>;
  /** Command-to-effect ms samples. */
  commandToEffect: number[];
  /** Remote UI echo ms samples (typing pace, 1,000 rows). */
  remoteUiEcho: number[];
  /** Remote UI burst ms samples. */
  remoteUiBurst: number[];
}

export interface BudgetRow {
  name: string;
  value: number | null;
  budget: number;
  unit: "ms";
  pass: boolean | null;
}

export interface BudgetResult {
  rows: BudgetRow[];
  exitCode: 0 | 1 | 2;
}

export const BUDGETS: {
  readonly launchDeltaFraction: number;
  readonly launchDeltaFloorMs: number;
  readonly startToReadyP95Ms: number;
  readonly commandToEffectP95Ms: number;
  readonly remoteUiEchoP95Ms: number;
  readonly remoteUiBurstP95Ms: number;
};

export function percentile(samples: readonly number[], p: number): number | null;
export function median(samples: readonly number[]): number | null;
export function checkBudgets(report: PluginsBenchReport): BudgetResult;
export function printBudgetReport(result: BudgetResult, heading?: string): 0 | 1 | 2;
