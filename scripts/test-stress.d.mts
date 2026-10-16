// Types for the plain-JavaScript stress lane, so `tsc` can type-check its test
// without enabling `allowJs` project-wide.
export interface StressOptions {
  rounds: number;
  hogs: number;
  vitestArgs: string[];
}

export function parseStressArgs(argv: string[], cores?: number): StressOptions;
export function failedTests(output: string): string[];
