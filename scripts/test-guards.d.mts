// Types for the plain-JavaScript guard lane, so `tsc` can type-check its test
// without enabling `allowJs` project-wide.
export function readsRepoFiles(source: string): boolean;
export function guardTests(root: string): string[];
