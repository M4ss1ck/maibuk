// Types for the plain-JavaScript preview server control, so `tsc` can
// type-check its tests without enabling `allowJs` project-wide.
export const PREVIEW_RUNS_DIR: string;
export const OWNER_PID: string;
export const PREVIEW_PID: string;

export interface ProcessProbe {
  isAlive: (pid: number) => boolean;
  runs: (pid: number, pattern: RegExp) => boolean;
  kill: (pid: number, signal: string) => void;
}

export const processProbe: ProcessProbe;

export function freePort(): Promise<number>;
export function isAlive(pid: number): boolean;
export function runs(pid: number, pattern: RegExp): boolean;
export function readPid(file: string): number | null;
export function sweepRunDirs(
  base: string,
  options?: { onStale?: (dir: string, probe: ProcessProbe) => void; probe?: ProcessProbe }
): number;
export function sweepStalePreviews(root: string, probe?: ProcessProbe): number;
export function createRunDir(root: string, runsDir: string): string;

export interface Preview {
  url: string;
  stop: () => Promise<void>;
  stopSync: () => void;
}

export function startPreview(root: string, runDir: string): Promise<Preview>;

export interface Teardown {
  track: (child: { kill: (signal: string) => void }) => void;
}

export function ownTeardown(stopSync: () => void): Teardown;
export function runPlaywright(options: {
  root: string;
  label: string;
  config: string;
  args: string[];
  env: Record<string, string | undefined>;
  teardown: Teardown;
}): Promise<number>;
