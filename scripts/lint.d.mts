// Types for the plain-JavaScript lint entry point, so `tsc` can type-check its
// test without enabling `allowJs` project-wide.
export function lintFindings(stdout: string): number;
