// Types for the plain-JavaScript Plugins bench budget check (issue #448), so
// `tsc` can type-check its test without enabling `allowJs` project-wide.
export interface PluginsBenchReport {
  engine: "chromium" | "webkit";
  /** Reasons the runner could not measure; any entry forces exit code 2. */
  unmeasured?: string[];
  /**
   * The native build profile the WebKitGTK lane measured (`"debug"` or
   * `"release"`), and the WebKitGTK lane's own note that its samples come from
   * synthetic in-app events (no Playwright). Absent for the Chromium lane.
   */
  build?: string;
  note?: string;
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
  /**
   * Echoes highlight rows (#451), measured on the Chromium lane only: the host
   * share of one highlight update (`echoHighlightUpdate`), Echoes' own Worker
   * recompute (`echoWorkerRecompute`), and the keystroke-to-decoration refresh
   * latency (`echoRefreshLatency`). Absent on the WebKitGTK lane.
   */
  echoHighlightUpdate?: number[];
  echoWorkerRecompute?: number[];
  echoRefreshLatency?: number[];
  /**
   * Whether the echo/burst measurement never saw the full typed text echoed
   * within its timeout (a lost burst). A lost text is a budget miss (exit 1),
   * not "cannot measure": the samples gathered before the loss still count.
   * Absent means the text was kept.
   */
  remoteUiEchoTextLost?: boolean;
  remoteUiBurstTextLost?: boolean;
}

export interface BudgetRow {
  name: string;
  value: number | null;
  budget: number;
  unit: "ms" | "bool";
  pass: boolean | null;
}

export interface BudgetResult {
  rows: BudgetRow[];
  exitCode: 0 | 1 | 2;
  /** Why the report cannot be measured; empty unless exitCode is 2. */
  reasons: string[];
}

export const BUDGETS: {
  readonly launchDeltaFraction: number;
  readonly launchDeltaFloorMs: number;
  readonly startToReadyP95Ms: number;
  readonly commandToEffectP95Ms: number;
  readonly remoteUiEchoP95Ms: number;
  readonly remoteUiBurstP95Ms: number;
  readonly echoHighlightUpdateP95Ms: number;
  readonly echoWorkerRecomputeP95Ms: number;
  readonly echoRefreshLatencyP95Ms: number;
};

export function percentile(samples: readonly number[], p: number): number | null;
export function median(samples: readonly number[]): number | null;
export function checkBudgets(report: PluginsBenchReport): BudgetResult;
export function printBudgetReport(result: BudgetResult, heading?: string): 0 | 1 | 2;
