// Types for the plain-JavaScript vendor script, so `tsc` can type-check its
// tests without enabling `allowJs` project-wide.
export const PDFJS_VERSION: string;
export const FOLIATE_COMMIT: string;
export const PDFJS_TARBALL_SHA256: string;
export const FOLIATE_FILES: Record<string, string>;
export const READER_ENGINE_FLOOR: { chrome: string; android: string };
export const PDFJS_RECENT_APIS: ReadonlyArray<readonly [RegExp, readonly string[]]>;
export const VENDOR_DIR: string;
export const FOLIATE_BUNDLE: string;
export const POLYFILL_ENTRY: string;
export const POLYFILL_BUNDLE: string;

export function pdfjsPolyfillModules(sources: readonly string[]): string[];
export function polyfillEntrySource(modules: readonly string[]): string;
