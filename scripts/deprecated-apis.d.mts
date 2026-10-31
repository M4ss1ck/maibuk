// Types for the plain-JavaScript deprecation gate, so `tsc` can type-check its
// test without enabling `allowJs` project-wide.
export function isGatedFile(file: string): boolean;
export function deprecationProblems(input: {
  root: string;
  files: string[];
  diagnostics: { fileName?: string; pos: number; text: string; reportsDeprecated?: boolean }[];
  readSource: (path: string) => string;
}): string[];
