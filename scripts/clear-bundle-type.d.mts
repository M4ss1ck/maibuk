// Types for the plain-JavaScript bundle-type script, so `tsc` can type-check its
// tests without enabling `allowJs` project-wide.
export function clearBundleType(buffer: Buffer): { changed: boolean; was: string };
