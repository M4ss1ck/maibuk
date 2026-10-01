// Types for the plain-JavaScript fetch script, so `tsc` can type-check its
// tests without enabling `allowJs` project-wide.
export interface PocketbaseAsset {
  file: string;
  sha256: string;
}

export const POCKETBASE_VERSION: string;
export const POCKETBASE_ASSETS: Record<string, PocketbaseAsset>;
export const MAIBUK_SYNC_COMMIT: string;
export const MIGRATIONS: Record<string, string>;
export const SYNC_SERVER_DIR: string;

export function pocketbaseAsset(
  platform: string,
  arch: string
): PocketbaseAsset & { url: string };
export function syncServerPaths(
  root: string,
  platform?: string
): { binary: string; migrationsDir: string };
export function sha256(bytes: Uint8Array): string;
export function verifyDigest(label: string, bytes: Uint8Array, expected: string): void;
export function fetchSyncServer(root: string): Promise<{ binary: string; migrationsDir: string }>;
