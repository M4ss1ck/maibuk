// Types for the plain-JavaScript fetch script, so `tsc` can type-check importers
// (the pin-table test) without enabling `allowJs` project-wide.
export interface DictationRuntime {
  name: string;
  url: string;
  sha256: string;
  stripComponents: number;
}

export const RUNTIMES: DictationRuntime[];
