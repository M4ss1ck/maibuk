// Types for the plain-JavaScript sync server control, so `tsc` can type-check
// its tests without enabling `allowJs` project-wide.
export const RUNS_DIR: string;

export interface SyncServer {
  url: string;
  superuser: { email: string; password: string };
  runDir: string;
  pid: number;
  stop: () => Promise<void>;
  stopSync: () => void;
}

export function sweepStaleRuns(root: string): number;
export function startSyncServer(root: string): Promise<SyncServer>;
