// Types for the plain-JavaScript budget check, so `tsc` can type-check its test
// without enabling `allowJs` project-wide.
export interface BenchReport {
  files?: {
    groups?: {
      fullName: string;
      benchmarks?: { name: string; mean: number; p99: number; sampleCount: number }[];
    }[];
  }[];
}

export interface BudgetRow {
  name: string;
  prefix: string;
  p99: number;
  mean: number;
  samples: number;
  budget: number;
  ok: boolean;
}

export const BUDGETS_MS: Readonly<Record<string, number>>;

export function checkBudgets(report: BenchReport): {
  rows: BudgetRow[];
  missing: string[];
  ok: boolean;
};

export function printBudgetReport(report: BenchReport, heading?: string): boolean;
