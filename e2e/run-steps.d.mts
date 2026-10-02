// Types for the plain-JavaScript E2E runner steps, so the TypeScript frame
// runner (e2e/run-frames.ts) can import them.
export const root: string;
export function step(
  label: string,
  command: string,
  commandArgs: string[],
  env?: Record<string, string>
): void;
export function preflight(options: { allowPlanned: boolean }): void;
export function buildWeb(options?: { sourcemap?: boolean }): void;
export function wallClock(started: number): void;
