// Types for the plain-JavaScript conformance gate, so `tsc` can type-check its
// test without enabling `allowJs` project-wide.
export const GATE_RESULTS_PATH: string;
export const CARGO_LOCK_PATH: string;
export const GATED_PACKAGES: readonly string[];

export interface CargoLockVersions {
  tauri: string | null;
  wry: string | null;
}

export interface ConformanceResults {
  stack?: {
    tauri?: string;
    wry?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface ConformanceGateResult {
  ok: boolean;
  problems: string[];
}

export function readCargoLockVersions(text: string): CargoLockVersions;

export function checkConformanceGate(
  cargoLockText: string,
  resultsJson: ConformanceResults | null
): ConformanceGateResult;
