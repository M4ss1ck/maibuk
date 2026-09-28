// Types for the plain-JavaScript fetch script, so `tsc` can type-check importers
// (the pin-table and test-asset tests) without enabling `allowJs` project-wide.
export interface DictationRuntime {
  name: string;
  url: string;
  sha256: string;
  stripComponents: number;
}

export interface DictationCatalogChecksum {
  algo: string;
  value: string;
}

export interface DictationCatalogFile {
  name: string;
  url: string;
  bytes: number;
  checksum: DictationCatalogChecksum;
}

export interface DictationCatalogEntry {
  id: string;
  files: DictationCatalogFile[];
  [key: string]: unknown;
}

export interface Crc32c {
  update(bytes: Uint8Array): void;
  /** Base64 of the 4 big-endian bytes, the catalog's format. */
  digestBase64(): string;
}

export interface FetchTestAssetsOptions {
  fetchImpl?: typeof fetch;
  run?: (file: string, args: string[], options?: unknown) => unknown;
}

export const RUNTIMES: DictationRuntime[];

export function runtimesFor(argv: string[]): DictationRuntime[];

export function createCrc32c(): Crc32c;

export function crc32cBase64(bytes: Uint8Array): string;

export function fetchTestAssets(root: string, options?: FetchTestAssetsOptions): Promise<void>;
