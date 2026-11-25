/**
 * The Reader Frame's test seam (#941). The Frame reads
 * `globalThis.__readerTestHooks` once, when it starts; the Frame tests set it
 * before they evaluate the built bundle, and production never defines it.
 *
 * A Frame module may not import Worker-side code (`entry.ts` header), so these
 * typings are the Frame's own. The injected imports stay opaque: the Frame
 * hands their result to the code that consumes it, never reads into it here.
 */

/** The seam the tests use to inject stubs and layout; production never defines it. */
export interface ReaderTestHooks {
  positionDebounceMs?: number;
  loadTimeoutMs?: number;
  importPdfjs?: (displaySource: string) => unknown;
  importFoliate?: (source: string) => unknown;
  importPurify?: (source: string) => unknown;
  viewportWidth?: number;
  viewportHeight?: number;
  measureFlow?: (geometry: {
    columns: HTMLElement;
    pageWidth: number;
    sectionIndex: number;
  }) => number;
  now?: () => number;
  onSearchSlice?: () => void;
  onReady?: (cleanup: () => void) => void;
}

/** The hooks this Frame was started with, or null in production. */
export const hooks =
  (globalThis as { __readerTestHooks?: ReaderTestHooks | null }).__readerTestHooks || null;

/** How long the Frame waits before reporting where the author is. */
export const positionDebounceMs =
  hooks && typeof hooks.positionDebounceMs === "number" ? hooks.positionDebounceMs : 1000;
