/**
 * The eight tooling steps `plugin:check` runs over an external Plugin (issue
 * #455): build, validate, typecheck, lint, test, boundary, package, layout. Each
 * is one exported async function returning `{ ok, details }`; none of them calls
 * `process.exit`, and none of them prints, so `runCheck` (scripts/plugin/cli.ts)
 * owns ordering, output, and the exit code. External programs are spawned with
 * argument arrays, never a shell string, so a Plugin path with spaces works.
 *
 * `pluginSteps(pluginRoot, maibukRoot)` returns the steps in the plan's order.
 * The heavy imports (Vite through `buildPlugin`, Vitest through a dynamic
 * `vitest/node`) stay out of the CLI's own module load: a step only pays for the
 * tool it runs.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { parsePluginLocale, parsePluginManifest } from "@/features/plugins/manifest-validate";
import type { PluginManifest } from "@/features/plugins/types";
import { TEST_TIMEOUT_MS } from "@/test/time-budget";
import { buildPlugin } from "../build-plugin";
import type { CheckStep, StepResult } from "./cli";
import { externalAliases, testFallbackResolver, writeGeneratedConfigs } from "./config";
import { checkImportBoundary } from "./import-boundary";
import { checkPackageLayout } from "./layout";
import { packagePlugin } from "./package";

/**
 * The step order `plugin:check` runs: build, validate, typecheck + lint, test,
 * boundary, package, layout. The CLI prints and dispatches by this order, so it
 * lives with the steps that implement it.
 */
export const CHECK_ORDER = [
  "build",
  "validate",
  "typecheck",
  "lint",
  "test",
  "boundary",
  "package",
  "layout",
] as const;

/** The name of one tooling step. */
export type PluginStepName = (typeof CHECK_ORDER)[number];

/** The two roots every step reads. */
export interface PluginStepContext {
  /** The external Plugin repo root (holds `manifest.json`, the entry, tests). */
  pluginRoot: string;
  /** The Maibuk checkout the tooling runs from. */
  maibukRoot: string;
}

/** A finished external program. */
interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** One tool step: `name` plus its factory, in the order {@link CHECK_ORDER} lists. */
type StepFn = (context: PluginStepContext) => Promise<StepResult>;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function manifestPathFile(pluginRoot: string): string {
  return join(pluginRoot, "manifest.json");
}

/** The `id` and `version` a build and package need, or a thrown error naming what is missing. */
function readManifestIds(pluginRoot: string): { id: string; version: string } {
  const path = manifestPathFile(pluginRoot);
  const raw = JSON.parse(readFileSync(path, "utf8")) as { id?: unknown; version?: unknown };
  if (typeof raw.id !== "string" || raw.id === "") throw new Error(`${path} declares no id`);
  if (typeof raw.version !== "string" || raw.version === "") {
    throw new Error(`${path} declares no version`);
  }
  return { id: raw.id, version: raw.version };
}

/** `<plugin>/dist/<id>/`, the built folder the package step zips. */
function builtDir(pluginRoot: string, id: string): string {
  return join(pluginRoot, "dist", id);
}

/** `<plugin>/dist/<id>-<version>.zip`, the file the layout step checks. */
function zipPathFor(pluginRoot: string, id: string, version: string): string {
  return join(pluginRoot, "dist", `${id}-${version}.zip`);
}

/** Runs `bin args...` in `cwd` with the inherited environment, capturing output. */
function run(bin: string, args: readonly string[], cwd: string): Promise<RunResult> {
  return new Promise((settle) => {
    const child = spawn(bin, [...args], { cwd, env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      settle({ code: 1, stdout, stderr: `${stderr}${messageOf(error)}\n` });
    });
    child.on("close", (code) => {
      settle({ code: code ?? 1, stdout, stderr });
    });
  });
}

/** The non-empty output lines of a finished program. */
function outputLines(result: RunResult): string[] {
  return `${result.stdout}\n${result.stderr}`
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== "");
}

/** 1 build: bundle the Plugin with `buildPlugin` and the external aliases. */
export async function buildStep(context: PluginStepContext): Promise<StepResult> {
  const { pluginRoot, maibukRoot } = context;
  try {
    const { id } = readManifestIds(pluginRoot);
    const outDir = builtDir(pluginRoot, id);
    await buildPlugin({
      sourceDir: pluginRoot,
      manifestPath: manifestPathFile(pluginRoot),
      outDir,
      alias: externalAliases(maibukRoot),
    });
    return { ok: true, details: [`built ${id} into ${relative(pluginRoot, outDir) || outDir}`] };
  } catch (error) {
    return { ok: false, details: [messageOf(error)] };
  }
}

/** 2 validate: the host validator on `manifest.json`, then `locales/*.json`. */
export async function validateStep(context: PluginStepContext): Promise<StepResult> {
  const { pluginRoot } = context;
  const text = readFileSync(manifestPathFile(pluginRoot), "utf8");
  const validation = parsePluginManifest(text, { builtIn: false });
  if (!validation.ok) {
    return {
      ok: false,
      details: validation.problems.map((problem) => formatProblem("manifest.json", problem)),
    };
  }
  const manifest: PluginManifest = validation.manifest;
  const details: string[] = [];
  const localesDir = join(pluginRoot, "locales");
  if (existsSync(localesDir)) {
    const files = readdirSync(localesDir)
      .filter((name) => name.endsWith(".json"))
      .sort();
    for (const name of files) {
      const language = name.slice(0, -".json".length);
      const localeText = readFileSync(join(localesDir, name), "utf8");
      const locale = parsePluginLocale(localeText, language, manifest);
      if (!locale.ok) {
        for (const problem of locale.problems)
          details.push(formatProblem(`locales/${name}`, problem));
      }
    }
  }
  if (details.length > 0) return { ok: false, details };
  return { ok: true, details: ["manifest.json and locales/ are valid"] };
}

/** One validator problem as `file: path: message`. */
function formatProblem(file: string, problem: { path: string; message: string }): string {
  return problem.path === ""
    ? `${file}: ${problem.message}`
    : `${file}: ${problem.path}: ${problem.message}`;
}

/** 3a typecheck: write the generated tsconfig and run Maibuk's tsc against it. */
export async function typecheckStep(context: PluginStepContext): Promise<StepResult> {
  const { pluginRoot, maibukRoot } = context;
  const { checkConfigPath } = await writeGeneratedConfigs(pluginRoot, maibukRoot);
  const tsc = join(maibukRoot, "node_modules", ".bin", "tsc");
  const result = await run(tsc, ["-p", checkConfigPath, "--pretty", "false"], pluginRoot);
  if (result.code === 0) return { ok: true, details: ["tsc reported no type errors"] };
  return { ok: false, details: outputLines(result) };
}

/** 3b lint: Maibuk's Biome over the Plugin folder, with its own config when it has one. */
export async function lintStep(context: PluginStepContext): Promise<StepResult> {
  const { pluginRoot, maibukRoot } = context;
  const biome = join(maibukRoot, "node_modules", ".bin", "biome");
  const args = ["check", pluginRoot];
  if (!existsSync(join(pluginRoot, "biome.json"))) {
    args.push("--config-path", join(maibukRoot, "biome.json"));
  }
  const result = await run(biome, args, pluginRoot);
  if (result.code === 0) return { ok: true, details: ["biome reported no problems"] };
  return { ok: false, details: outputLines(result) };
}

/** 4 test: the Plugin's tests through the kit, with jsdom and Maibuk's setup file. */
export async function testStep(context: PluginStepContext): Promise<StepResult> {
  const { pluginRoot, maibukRoot } = context;
  process.env.TEST = "true";
  process.env.VITEST = "true";
  // A Vite `build` (the build step) leaves NODE_ENV=production, which makes the
  // jsdom/client environment externalize Node builtins and breaks the setup file;
  // Vitest needs the test mode here, so it is set outright, not defaulted.
  process.env.NODE_ENV = "test";
  const { createVitest } = await import("vitest/node");
  // Vitest reads the run's `test` options, plugins, and `server.fs.allow` from
  // the *Vite* config, not from its first argument, so they are passed as the
  // Vite overrides here. `test.alias` is what Vitest turns into `resolve.alias`.
  const vitest = await createVitest(
    "test",
    { root: pluginRoot, config: false, watch: false } as never,
    {
      logLevel: "warn",
      plugins: [testFallbackResolver(maibukRoot)],
      server: { fs: { allow: [pluginRoot, maibukRoot] } },
      test: {
        root: pluginRoot,
        environment: "jsdom",
        setupFiles: [join(maibukRoot, "src", "test", "setup.ts")],
        include: ["**/*.test.{ts,tsx}"],
        exclude: ["**/node_modules/**", "**/dist/**", "**/.maibuk/**"],
        alias: externalAliases(maibukRoot),
        // Maibuk's setup file fails a test whose timeout is not the suite's.
        testTimeout: TEST_TIMEOUT_MS,
        hookTimeout: TEST_TIMEOUT_MS,
      },
    } as never
  );
  try {
    const result = await vitest.start();
    const files = result.testModules.length;
    if (files === 0) {
      return { ok: false, details: ["no test files matched **/*.test.{ts,tsx}"] };
    }
    const moduleFailed = result.testModules.some((file) => file.state() === "failed");
    const failed =
      vitest.state.getCountOfFailedTests() > 0 || moduleFailed || result.unhandledErrors.length > 0;
    if (failed) return { ok: false, details: ["one or more Plugin tests failed"] };
    return { ok: true, details: [`${files} test file${files === 1 ? "" : "s"} passed`] };
  } catch (error) {
    return { ok: false, details: [`tests did not run: ${messageOf(error)}`] };
  } finally {
    await vitest.close();
  }
}

/** 5 boundary: the Plugin's imports against the import boundary. */
export async function boundaryStep(context: PluginStepContext): Promise<StepResult> {
  const { pluginRoot, maibukRoot } = context;
  const { violations } = checkImportBoundary(pluginRoot, { maibukRoot });
  if (violations.length === 0) return { ok: true, details: ["no refused imports"] };
  return {
    ok: false,
    details: violations.map(
      (violation) =>
        `${violation.file}:${violation.line} ${violation.specifier} — ${violation.reason}`
    ),
  };
}

/** 6 package: zip the built folder to `<plugin>/dist/<id>-<version>.zip`. */
export async function packageStep(context: PluginStepContext): Promise<StepResult> {
  const { pluginRoot } = context;
  try {
    const { id, version } = readManifestIds(pluginRoot);
    const dir = builtDir(pluginRoot, id);
    if (!existsSync(dir)) {
      return {
        ok: false,
        details: [`${relative(pluginRoot, dir)} is missing; run the build step first`],
      };
    }
    const zipPath = zipPathFor(pluginRoot, id, version);
    const result = await packagePlugin(dir, zipPath);
    return {
      ok: true,
      details: [`packed ${result.files.length} file(s) into ${relative(pluginRoot, zipPath)}`],
    };
  } catch (error) {
    return { ok: false, details: [messageOf(error)] };
  }
}

/** 7 layout: the packaged zip against the layout rules. */
export async function layoutStep(context: PluginStepContext): Promise<StepResult> {
  const { pluginRoot, maibukRoot } = context;
  try {
    const { id, version } = readManifestIds(pluginRoot);
    const zipPath = zipPathFor(pluginRoot, id, version);
    if (!existsSync(zipPath)) {
      return {
        ok: false,
        details: [`${relative(pluginRoot, zipPath)} is missing; run the package step first`],
      };
    }
    const { problems } = checkPackageLayout(zipPath, {
      forbiddenStrings: [maibukRoot, pluginRoot],
    });
    if (problems.length === 0) return { ok: true, details: ["the package layout is valid"] };
    return { ok: false, details: problems };
  } catch (error) {
    return { ok: false, details: [messageOf(error)] };
  }
}

/** Every step factory, keyed by name. */
const STEP_FACTORIES: Record<PluginStepName, StepFn> = {
  build: buildStep,
  validate: validateStep,
  typecheck: typecheckStep,
  lint: lintStep,
  test: testStep,
  boundary: boundaryStep,
  package: packageStep,
  layout: layoutStep,
};

/**
 * The steps in the order `plugin:check` runs them: build, validate, typecheck,
 * lint, test, boundary, package, layout.
 */
export function pluginSteps(pluginRoot: string, maibukRoot: string): CheckStep[] {
  const context: PluginStepContext = { pluginRoot, maibukRoot };
  return CHECK_ORDER.map((name) => ({ name, run: () => STEP_FACTORIES[name](context) }));
}
