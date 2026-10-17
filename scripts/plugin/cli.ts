/**
 * The `plugin:*` command line (issue #455). `tsx scripts/plugin/cli.ts <command>
 * <plugin-path>` runs one tooling step over an external Plugin, or `check` runs
 * every step in the plan's order and stops at the first failure. Every step
 * reports `{ ok, details }` and never calls `process.exit`; this module owns the
 * process's exit code and the printed lines, so a failing step is testable
 * without a real toolchain: {@link runCheck} takes the steps and the log line,
 * and {@link parseCommand} is the argument parser on its own.
 *
 * The Maibuk checkout is wherever this CLI runs from; the Plugin path resolves
 * against `INIT_CWD` (what pnpm sets to the folder the author typed the command
 * in), falling back to `process.cwd()`, so `pnpm plugin:check ../my-plugin`
 * works.
 */
import { existsSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { writeGeneratedConfigs } from "./config";
import { CHECK_ORDER, pluginSteps, type PluginStepName } from "./steps";

export { CHECK_ORDER } from "./steps";
export type { PluginStepName } from "./steps";

/** What one step found: whether it passed and the lines to print. */
export interface StepResult {
  /** True when the step passed (a skipped step passes). */
  ok: boolean;
  /** True when the step did not apply to this Plugin and ran no check. */
  skipped?: boolean;
  /** One line per problem (or per fact) the step wants to report. */
  details: string[];
}

/** One named step of the check. */
export interface CheckStep {
  /** The step name printed in `PASS`/`FAIL` lines. */
  name: string;
  /** Runs the step; never throws for a step failure, only for a programming error. */
  run(): Promise<StepResult>;
}

/** One step's outcome after {@link runCheck} timed it. */
export interface CheckStepOutcome {
  name: string;
  ok: boolean;
  /** True when the step was skipped for this Plugin. */
  skipped: boolean;
  details: string[];
  /** How long the step took, in milliseconds. */
  ms: number;
}

/** What {@link runCheck} found. */
export interface CheckOutcome {
  /** True when every step passed. */
  ok: boolean;
  /** `0` when every step passed, `1` otherwise. */
  code: number;
  /** Every step that ran, in order, with its timing. */
  steps: CheckStepOutcome[];
}

/** Every command the CLI accepts: the step names, plus `check` and `configs`. */
export const COMMANDS = [...CHECK_ORDER, "check", "configs"] as const;

/** A command name, the whole check, or the config generation `setup` runs. */
export type PluginCommand = PluginStepName | "check" | "configs";

/** A parsed command line. */
export interface ParsedCommand {
  command: PluginCommand;
  /** The Plugin path exactly as written; the caller resolves it. */
  path: string;
}

/** Why a command line could not be parsed. */
export interface ParseError {
  error: string;
}

/** The usage block printed for a bad or missing command line. */
export const USAGE = [
  "Usage: tsx scripts/plugin/cli.ts <command> <plugin-path>",
  "",
  "Commands:",
  "  build      Build the Plugin into <plugin>/dist/<id>/",
  "  validate   Validate manifest.json and locales/",
  "  typecheck  Typecheck with a generated tsconfig",
  "  lint       Lint the Plugin with Maibuk's Biome",
  "  test       Run the Plugin's tests through the test kit",
  "  boundary   Check the Plugin's imports against the boundary",
  "  android    Evaluate the built entry in the Android QuickJS engine (when platforms lists android)",
  "  package   Zip <plugin>/dist/<id>/ into <plugin>/dist/<id>-<version>.zip",
  "  layout     Check the packaged zip's layout",
  "  check      Run every step, stopping at the first failure",
  "  configs    Write <plugin>/.maibuk/ with the generated TypeScript configs",
].join("\n");

/**
 * Parses `<command> <plugin-path>`, returning the command and the Plugin path
 * exactly as written, or a message naming what is missing or unknown.
 */
export function parseCommand(argv: readonly string[]): ParsedCommand | ParseError {
  const [command, target] = argv;
  if (command === undefined || command === "") return { error: "no command was given" };
  if (!(COMMANDS as readonly string[]).includes(command)) {
    return { error: `unknown command "${command}"` };
  }
  if (target === undefined || target === "") {
    return { error: `no Plugin path was given for "${command}"` };
  }
  return { command: command as PluginCommand, path: target };
}

/**
 * Runs `steps` in order, printing `PASS <name> (<ms>ms)`, `SKIP <name>` for a
 * step that did not apply, or `FAIL <name>` plus the failing step's details, and
 * stops at the first failure. Prints one final
 * line and returns exit code `0` only when every step passed.
 */
export async function runCheck(
  steps: readonly CheckStep[],
  log: (line: string) => void = console.log
): Promise<CheckOutcome> {
  const outcomes: CheckStepOutcome[] = [];
  let failed = false;
  for (const step of steps) {
    const started = performance.now();
    let result: StepResult;
    try {
      result = await step.run();
    } catch (error) {
      result = { ok: false, details: [error instanceof Error ? error.message : String(error)] };
    }
    const ms = Math.round(performance.now() - started);
    const skipped = result.skipped === true;
    outcomes.push({ name: step.name, ok: result.ok, skipped, details: result.details, ms });
    if (skipped) {
      log(`SKIP ${step.name}`);
      for (const detail of result.details) log(`  ${detail}`);
    } else if (result.ok) {
      log(`PASS ${step.name} (${ms}ms)`);
    } else {
      log(`FAIL ${step.name}`);
      for (const detail of result.details) log(`  ${detail}`);
      failed = true;
      break;
    }
  }
  if (failed) {
    log(`plugin check failed at ${outcomes[outcomes.length - 1]?.name ?? "?"}`);
  } else {
    log(`plugin check passed (${outcomes.length} step${outcomes.length === 1 ? "" : "s"})`);
  }
  return { ok: !failed, code: failed ? 1 : 0, steps: outcomes };
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Resolves the Plugin path against `INIT_CWD` (what pnpm sets), else the cwd. */
function resolvePluginRoot(path: string): string {
  const base = process.env.INIT_CWD ?? process.cwd();
  return isAbsolute(path) ? path : resolve(base, path);
}

async function main(): Promise<number> {
  const parsed = parseCommand(process.argv.slice(2));
  if ("error" in parsed) {
    console.error(`${parsed.error}\n\n${USAGE}`);
    return 2;
  }
  const pluginRoot = resolvePluginRoot(parsed.path);
  if (!isDirectory(pluginRoot)) {
    console.error(`The Plugin path is not a folder: ${pluginRoot}\n\n${USAGE}`);
    return 2;
  }
  const maibukRoot = resolve(import.meta.dirname, "../..");

  // `configs` only generates the editor's TypeScript configs, so it runs before
  // the manifest check: `setup` runs it right after writing `maibuk.local.json`.
  if (parsed.command === "configs") {
    const { checkConfigPath, pathsConfigPath } = await writeGeneratedConfigs(pluginRoot, maibukRoot);
    console.log(
      `wrote ${relative(pluginRoot, pathsConfigPath)} and ${relative(pluginRoot, checkConfigPath)}`
    );
    return 0;
  }

  if (!existsSync(join(pluginRoot, "manifest.json"))) {
    console.error(
      `No manifest.json in ${pluginRoot}.\n` +
        "A Plugin folder has manifest.json at its root next to its entry (see plugins/README.md), " +
        "and the path must point at the Plugin repo, not its parent."
    );
    return 2;
  }

  const all = pluginSteps(pluginRoot, maibukRoot);
  const steps = parsed.command === "check" ? all : all.filter((s) => s.name === parsed.command);
  const outcome = await runCheck(steps);
  return outcome.code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
