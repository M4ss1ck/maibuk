// The pure half of the Plugins bench runner (issue #448, unit 4a): argument
// parsing, the worst-exit-code combination, and assembling a PluginsBenchReport
// from the per-measurement JSON the bench specs wrote. No I/O here, so the
// runner's decisions are unit-tested without launching a browser.

import type { PluginsBenchReport } from "../../scripts/plugins-bench-budget.mjs";

/**
 * A lane the runner can measure. `chromium` runs the bench specs; `webkitgtk`
 * is reserved for unit 4b and, until then, records an `unmeasured` report.
 */
export type PluginsBenchEngine = "chromium" | "webkitgtk";

/** Every lane, in the order the default run measures them. */
export const PLUGINS_BENCH_ENGINES: readonly PluginsBenchEngine[] = ["chromium", "webkitgtk"];

export const PLUGINS_BENCH_USAGE = `usage: pnpm bench:plugins [options]
  --engine <chromium|webkitgtk>  lane to run, repeatable (default: both, chromium first)
  --samples <n>                  samples per measurement (default 20)
  --reuse-build                  skip the web build (as E2E_REUSE_BUILD=1)
  --headless                     run the browser headless`;

export class PluginsBenchUsageError extends Error {
  constructor(message: string) {
    super(`${message}\n${PLUGINS_BENCH_USAGE}`);
    this.name = "PluginsBenchUsageError";
  }
}

export interface PluginsBenchOptions {
  /** The lanes to run, in order. */
  engines: PluginsBenchEngine[];
  /** Samples per measurement. */
  samples: number;
  /** Skip the web build, serving the last one. */
  reuseBuild: boolean;
  /** Run headless instead of in a window. */
  headless: boolean;
}

function isEngine(value: string): value is PluginsBenchEngine {
  return (PLUGINS_BENCH_ENGINES as readonly string[]).includes(value);
}

/** Parses `pnpm bench:plugins` arguments. Pure, so the runner's options are tested. */
export function parsePluginsBenchArgs(argv: string[]): PluginsBenchOptions {
  const args = argv.filter((arg) => arg !== "--");
  const options: PluginsBenchOptions = {
    engines: [],
    samples: 20,
    reuseBuild: false,
    headless: false,
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const [flag, inline] = arg.includes("=") ? arg.split(/=(.*)/s, 2) : [arg, undefined];
    const value = (): string => {
      const v = inline ?? args[++i];
      if (v === undefined || v.startsWith("--")) {
        throw new PluginsBenchUsageError(`${flag} needs a value`);
      }
      return v;
    };
    switch (flag) {
      case "--engine":
        for (const name of value().split(",").filter(Boolean)) {
          if (!isEngine(name)) {
            throw new PluginsBenchUsageError(`unknown engine "${name}"`);
          }
          if (!options.engines.includes(name)) options.engines.push(name);
        }
        break;
      case "--samples": {
        const samples = Number(value());
        if (!Number.isInteger(samples) || samples < 1) {
          throw new PluginsBenchUsageError("--samples must be an integer >= 1");
        }
        options.samples = samples;
        break;
      }
      case "--reuse-build":
        options.reuseBuild = true;
        break;
      case "--headless":
        options.headless = true;
        break;
      default:
        throw new PluginsBenchUsageError(`unknown option "${arg}"`);
    }
  }
  if (options.engines.length === 0) options.engines = [...PLUGINS_BENCH_ENGINES];
  return options;
}

/** The file names the bench specs write; the runner assembles the report from them. */
export const MEASUREMENT_FILES = {
  launchBaseline: "launch-baseline",
  launchInstalled20: "launch-installed20",
  launchPersistent3: "launch-persistent3",
  startToReady: "startToReady",
  commandToEffect: "commandToEffect",
  remoteUiEcho: "remoteUiEcho",
  remoteUiBurst: "remoteUiBurst",
} as const;

/** One measurement the bench specs wrote: its base name (no `.json`) and its text. */
export interface MeasurementFile {
  name: string;
  text: string;
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "number");
}

function isNumberArrayMap(value: unknown): value is Record<string, number[]> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every(isNumberArray);
}

/**
 * Assembles a PluginsBenchReport from the per-measurement files the specs
 * wrote. A missing file, invalid JSON, or a value of the wrong shape becomes an
 * `unmeasured` reason, so an incomplete run never reads as a pass or a miss.
 *
 * The report's `engine` field is the report's own vocabulary (`chromium` or
 * `webkit`); `webkitgtk` is the lane name, and unit 4b maps it to `webkit` too.
 */
export function assembleReport(
  engine: PluginsBenchEngine,
  files: readonly MeasurementFile[]
): PluginsBenchReport {
  const byName = new Map(files.map((file) => [file.name, file.text]));
  const unmeasured: string[] = [];
  const read = (name: string): unknown => {
    const text = byName.get(name);
    if (text === undefined) {
      unmeasured.push(`${name}: no measurement was written`);
      return undefined;
    }
    try {
      return JSON.parse(text);
    } catch {
      unmeasured.push(`${name}: invalid JSON`);
      return undefined;
    }
  };
  const numbers = (name: string): number[] => {
    const value = read(name);
    if (value === undefined) return [];
    if (!isNumberArray(value)) {
      unmeasured.push(`${name}: expected an array of numbers`);
      return [];
    }
    return value;
  };
  const idMap = (name: string): Record<string, number[]> => {
    const value = read(name);
    if (value === undefined) return {};
    if (!isNumberArrayMap(value)) {
      unmeasured.push(`${name}: expected an object of number arrays`);
      return {};
    }
    return value;
  };

  const report: PluginsBenchReport = {
    engine: engine === "webkitgtk" ? "webkit" : "chromium",
    launch: {
      baseline: numbers(MEASUREMENT_FILES.launchBaseline),
      installed20: numbers(MEASUREMENT_FILES.launchInstalled20),
      persistent3: numbers(MEASUREMENT_FILES.launchPersistent3),
    },
    startToReady: idMap(MEASUREMENT_FILES.startToReady),
    commandToEffect: numbers(MEASUREMENT_FILES.commandToEffect),
    remoteUiEcho: numbers(MEASUREMENT_FILES.remoteUiEcho),
    remoteUiBurst: numbers(MEASUREMENT_FILES.remoteUiBurst),
  };
  if (unmeasured.length > 0) report.unmeasured = unmeasured;
  return report;
}

/**
 * A report that could not measure anything, for a lane the runner did not run
 * (the `webkitgtk` lane today, or a harness failure). Every required sample
 * array is empty and `unmeasured` is non-empty, so the budget check exits 2.
 */
export function unmeasuredReport(
  engine: PluginsBenchEngine,
  reasons: readonly string[]
): PluginsBenchReport {
  return {
    engine: engine === "webkitgtk" ? "webkit" : "chromium",
    unmeasured: [...reasons],
    launch: { baseline: [], installed20: [], persistent3: [] },
    startToReady: {},
    commandToEffect: [],
    remoteUiEcho: [],
    remoteUiBurst: [],
  };
}

/**
 * The worst exit code across lanes: 2 (could not measure) beats 1 (a budget
 * missed) beats 0. An empty list is 0.
 */
export function combineExitCodes(codes: readonly number[]): 0 | 1 | 2 {
  let worst: 0 | 1 | 2 = 0;
  for (const code of codes) {
    if (code >= 2) worst = 2;
    else if (code === 1 && worst === 0) worst = 1;
  }
  return worst;
}
