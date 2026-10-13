// `pnpm conformance:plugins` arguments (#447, D5). Pure, so the runner's
// options are tested without starting a collector, building, or launching
// anything.

/** The platforms the lane can measure; `all` means every available one. */
export type PluginConformancePlatform = "linux" | "android" | "all";

/** The options the `conformance:plugins` runner runs on. */
export interface PluginConformanceOptions {
  /** Which engine to measure; `all` tries every available one. */
  platform: PluginConformancePlatform;
  /** Merge each platform that passed every check into the committed results. */
  record: boolean;
  /** Reuse the last build instead of rebuilding. */
  skipBuild: boolean;
  /** Directory each platform's `.json` is written under. */
  out: string;
  /** How long to wait for `/done`, in minutes. */
  timeoutMinutes: number;
  /** Print the usage and exit without measuring. */
  help: boolean;
}

export const PLUGIN_CONFORMANCE_USAGE = `usage: pnpm conformance:plugins [options]
  --platform <linux|android|all>  which engine to measure (default: all available)
  --record                        merge a platform that passed every check into
                                  docs/research/plugins-conformance.results.json
  --skip-build                    reuse the last build instead of rebuilding
  --out <dir>                     where each platform's JSON is written (default .bench)
  --timeout <minutes>             wait for /done before giving up (default 10)
  --help                          print this and exit`;

/** A bad invocation: the runner prints the usage and exits 2. */
export class PluginConformanceUsageError extends Error {
  constructor(message: string) {
    super(`${message}\n${PLUGIN_CONFORMANCE_USAGE}`);
    this.name = "PluginConformanceUsageError";
  }
}

const PLATFORMS: readonly PluginConformancePlatform[] = ["linux", "android", "all"];

export function parsePluginConformanceArgs(argv: string[]): PluginConformanceOptions {
  const args = argv.filter((arg) => arg !== "--");
  const options: PluginConformanceOptions = {
    platform: "all",
    record: false,
    skipBuild: false,
    out: ".bench",
    timeoutMinutes: 10,
    help: false,
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const [flag, inline] = arg.includes("=") ? arg.split(/=(.*)/s, 2) : [arg, undefined];
    const value = (): string => {
      const v = inline ?? args[++i];
      if (v === undefined || v.startsWith("--")) {
        throw new PluginConformanceUsageError(`${flag} needs a value`);
      }
      return v;
    };
    switch (flag) {
      case "--platform": {
        const v = value();
        if (!PLATFORMS.includes(v as PluginConformancePlatform)) {
          throw new PluginConformanceUsageError(`unknown platform "${v}"`);
        }
        options.platform = v as PluginConformancePlatform;
        break;
      }
      case "--record":
        options.record = true;
        break;
      case "--skip-build":
        options.skipBuild = true;
        break;
      case "--out":
        options.out = value();
        break;
      case "--timeout": {
        const minutes = Number(value());
        if (!Number.isInteger(minutes) || minutes < 1) {
          throw new PluginConformanceUsageError("--timeout must be an integer ≥ 1");
        }
        options.timeoutMinutes = minutes;
        break;
      }
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        throw new PluginConformanceUsageError(`unknown option "${arg}"`);
    }
  }
  return options;
}

/** The platforms to run for an option: one, or both for `all`. */
export function platformsFor(platform: PluginConformancePlatform): ("linux" | "android")[] {
  return platform === "all" ? ["linux", "android"] : [platform];
}
