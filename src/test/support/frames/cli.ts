// `pnpm bench:frames` arguments (issue #372). Pure, so the runner's options
// are tested without launching anything.

import { FRAME_SCENARIOS, FRAME_SOURCES, type FrameSource, scenariosFor } from "@/test/support/frames/scenarios";

export const FRAME_BENCH_USAGE = `usage: pnpm bench:frames [options]
  --source <chromium|probe|android>  where frames come from (default chromium)
  --scenario <id[,id...]>            run only these scenarios (repeatable)
  --repeat <n>                       repetitions per scenario (default: each scenario's own)
  --cpu-throttle <n>                 Chromium CPU slowdown, e.g. 4 for a mid-range phone
  --engine <webkit|chromium>         the probe source's engine (default webkit)
  --headless                         new headless mode instead of a headed window
  --reuse-build                      skip the web build (as E2E_REUSE_BUILD=1)
  --out <file>                       report path (default .bench/frames-<source>.json)
  --raw                              also save each run's raw trace, framestats, or probe dump under .bench/frames-raw/
  --list                             print the scenarios and exit
scenarios: ${FRAME_SCENARIOS.map((s) => s.id).join(", ")}`;

export interface FrameBenchOptions {
  source: FrameSource;
  scenarios: string[];
  repeat: number | null;
  cpuThrottling: number;
  engine: "webkit" | "chromium";
  headless: boolean;
  reuseBuild: boolean;
  out: string;
  raw: boolean;
  list: boolean;
}

export class FrameBenchUsageError extends Error {
  constructor(message: string) {
    super(`${message}\n${FRAME_BENCH_USAGE}`);
    this.name = "FrameBenchUsageError";
  }
}

export function parseFrameBenchArgs(argv: string[]): FrameBenchOptions {
  const args = argv.filter((arg) => arg !== "--");
  const options: Omit<FrameBenchOptions, "scenarios" | "out"> & {
    only: string[];
    out: string | null;
  } = {
    source: "chromium",
    only: [],
    repeat: null,
    cpuThrottling: 1,
    engine: "webkit",
    headless: false,
    reuseBuild: false,
    out: null,
    raw: false,
    list: false,
  };
  let engineSet = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const [flag, inline] = arg.includes("=") ? arg.split(/=(.*)/s, 2) : [arg, undefined];
    const value = () => {
      const v = inline ?? args[++i];
      if (v === undefined || v.startsWith("--"))
        throw new FrameBenchUsageError(`${flag} needs a value`);
      return v;
    };
    const count = (name: string, min: number) => {
      const v = Number(value());
      if (!Number.isInteger(v) || v < min)
        throw new FrameBenchUsageError(`${name} must be an integer ≥ ${min}`);
      return v;
    };
    switch (flag) {
      case "--source": {
        const v = value();
        if (!FRAME_SOURCES.includes(v as FrameSource)) {
          throw new FrameBenchUsageError(`unknown source "${v}"`);
        }
        options.source = v as FrameSource;
        break;
      }
      case "--scenario":
        options.only.push(...value().split(",").filter(Boolean));
        break;
      case "--repeat":
        options.repeat = count("--repeat", 1);
        break;
      case "--cpu-throttle":
        options.cpuThrottling = count("--cpu-throttle", 1);
        break;
      case "--engine": {
        const v = value();
        if (v !== "webkit" && v !== "chromium")
          throw new FrameBenchUsageError(`unknown engine "${v}"`);
        options.engine = v;
        engineSet = true;
        break;
      }
      case "--headless":
        options.headless = true;
        break;
      case "--reuse-build":
        options.reuseBuild = true;
        break;
      case "--out":
        options.out = value();
        break;
      case "--raw":
        options.raw = true;
        break;
      case "--list":
        options.list = true;
        break;
      default:
        throw new FrameBenchUsageError(`unknown option "${arg}"`);
    }
  }
  if (engineSet && options.source !== "probe") {
    throw new FrameBenchUsageError("--engine applies to --source probe only");
  }
  if (options.cpuThrottling > 1 && options.source !== "chromium") {
    throw new FrameBenchUsageError("--cpu-throttle applies to --source chromium only");
  }
  if (options.headless && options.source === "android") {
    throw new FrameBenchUsageError("--headless does not apply to --source android");
  }
  let scenarios: string[];
  try {
    scenarios = scenariosFor(options.source, options.only).map((s) => s.id);
  } catch (error) {
    throw new FrameBenchUsageError((error as Error).message);
  }
  const skipped = options.only.filter((id) => !scenarios.includes(id));
  if (skipped.length > 0) {
    const reasons = skipped.map(
      (id) => `${id}: ${FRAME_SCENARIOS.find((s) => s.id === id)?.skip?.[options.source]}`
    );
    throw new FrameBenchUsageError(`not measured on ${options.source}: ${reasons.join("; ")}`);
  }
  const { only: _only, out, ...rest } = options;
  return { ...rest, scenarios, out: out ?? `.bench/frames-${options.source}.json` };
}
