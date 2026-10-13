// The conformance lane's shared runner types (#447, D5): the platform names the
// support module uses, and the handle a launched app returns to the runner.

import type { ConformancePlatformName } from "@/test/support/plugin-conformance/report";

/** One engine the lane drives. */
export type ConformanceEngineName = ConformancePlatformName;

/** A launched app the runner can watch and stop. */
export interface RunningApp {
  /** False once the app's process is gone. */
  isAlive(): Promise<boolean>;
  /** Stops the app and releases whatever it started. */
  stop(): Promise<void>;
}

/** Where a run keeps its logs and its generated Tauri config. */
export interface RunDir {
  /** `e2e/.output/conformance/<started>/`, git-ignored. */
  dir: string;
  /** The `tauri build --config` override written for the Linux build. */
  configPath: string;
}
