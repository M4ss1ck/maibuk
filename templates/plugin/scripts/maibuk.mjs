// The external Plugin repo's build bootstrap (issue #455). A Plugin author runs
// `node scripts/maibuk.mjs <cmd>` (through the package.json scripts) from the
// Plugin folder; this module resolves the Maibuk checkout the repo points at
// and launches the checkout's tooling CLI for one command. It is plain Node ESM
// with no dependencies, so it runs before `pnpm install`, and it launches the
// CLI with `process.execPath` and an argument array, never a shell, so a path
// with spaces works on every platform.
//
// Checkout resolution is the single source of truth, shared with `setup.mjs`:
// the `--maibuk <path>` flag wins over `MAIBUK_CHECKOUT`, which wins over
// `maibuk.local.json` (machine-specific, GITIGNORED). A relative path in that
// file resolves against the Plugin root. A checkout is valid when
// `<path>/package.json` names `maibuk`, `<path>/scripts/plugin/cli.ts` and
// `<path>/src/plugin-sdk/index.ts` exist, and the launcher this module spawns
// (`<path>/node_modules/tsx/dist/cli.mjs`) exists, so an incomplete install is
// refused with a message instead of a raw `MODULE_NOT_FOUND`.
// Every refusal names the source used, the path tried, what is missing, and the
// command that fixes it.

import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** The file an external Plugin repo writes its checkout path to. */
export const LOCAL_CONFIG_FILE = "maibuk.local.json";

/** The key {@link LOCAL_CONFIG_FILE} holds the checkout path under. */
export const LOCAL_CONFIG_KEY = "maibukCheckout";

/** The command that writes {@link LOCAL_CONFIG_FILE} for the author. */
const SETUP_COMMAND = "node scripts/setup.mjs --maibuk <path/to/maibuk>";

/**
 * The checkout-relative entry the bootstrap spawns with `process.execPath`. A
 * checkout can have a `node_modules` folder that exists but is incomplete (for
 * example, only `.pnpm` after an interrupted install); requiring this exact
 * file turns the raw `MODULE_NOT_FOUND` that follows into the same actionable
 * message as a missing folder.
 */
const TSX_LAUNCHER = "node_modules/tsx/dist/cli.mjs";

/** The usage block printed for a bad or missing command line. */
const USAGE =
  "Usage: node scripts/maibuk.mjs <setup|check|build|test|validate|package> [plugin-path] [--maibuk <path>]";

/** A refused checkout, or a call that named no source at all (#455). */
export class MaibukCheckoutError extends Error {
  constructor(message) {
    super(message);
    this.name = "MaibukCheckoutError";
  }
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** The structural requirements a Maibuk checkout folder itself must satisfy. */
function structuralProblems(root) {
  const problems = [];
  const packagePath = join(root, "package.json");
  if (!existsSync(packagePath)) {
    problems.push("package.json is missing");
  } else {
    try {
      const parsed = JSON.parse(readFileSync(packagePath, "utf8"));
      if (parsed.name !== "maibuk") problems.push('package.json does not name "maibuk"');
    } catch {
      problems.push("package.json is not valid JSON");
    }
  }
  if (!existsSync(join(root, "scripts/plugin/cli.ts"))) {
    problems.push("scripts/plugin/cli.ts is missing");
  }
  if (!existsSync(join(root, "src/plugin-sdk/index.ts"))) {
    problems.push("src/plugin-sdk/index.ts is missing");
  }
  return problems;
}

/**
 * What a structurally valid checkout is missing to run: its `node_modules`
 * folder, or the exact launcher this module spawns inside it (which a
 * half-finished install leaves out). `undefined` when a run has everything it
 * needs.
 */
function dependencyProblem(root) {
  if (!isDirectory(join(root, "node_modules"))) {
    return "node_modules is missing; dependencies are not installed";
  }
  if (!existsSync(join(root, TSX_LAUNCHER))) {
    return `${TSX_LAUNCHER} is missing; dependencies are not installed`;
  }
  return undefined;
}

/**
 * The `Fix:` line for a `source` that did not name a Maibuk checkout: a path
 * that is not a folder, or one missing the package name, the CLI, or the SDK
 * entry. The line names only the fix for *that* source, so an author who passed
 * `--maibuk` is never sent to `setup.mjs` and one whose `maibuk.local.json`
 * points at the wrong checkout is sent back to `setup.mjs`.
 */
function sourceFix(source) {
  if (source === "--maibuk") {
    return "Fix: pass the path of a Maibuk checkout to --maibuk.";
  }
  if (source === "MAIBUK_CHECKOUT") {
    return `Fix: correct or unset MAIBUK_CHECKOUT, or run ${SETUP_COMMAND}.`;
  }
  return `Fix: ${SETUP_COMMAND}.`;
}

/** The `Fix:` line when the checkout is valid and only its dependencies are missing. */
function installFix(root) {
  return `Fix: run "pnpm install" in ${root}.`;
}

/** Returns the path when it is a runnable checkout, otherwise throws with the detail. */
function assertUsableCheckout(path, source) {
  if (!isDirectory(path)) {
    throw new MaibukCheckoutError(
      `The Maibuk checkout named by ${source} is not a folder: ${path}\n${sourceFix(source)}`
    );
  }
  const structural = structuralProblems(path);
  if (structural.length > 0) {
    throw new MaibukCheckoutError(
      [
        `The Maibuk checkout named by ${source} is not a Maibuk checkout: ${path}`,
        ...structural.map((entry) => `  - ${entry}`),
        sourceFix(source),
      ].join("\n")
    );
  }
  const dependency = dependencyProblem(path);
  if (dependency !== undefined) {
    throw new MaibukCheckoutError(
      [
        `The Maibuk checkout named by ${source} is not ready to run: ${path}`,
        `  - ${dependency}`,
        installFix(path),
      ].join("\n")
    );
  }
  return path;
}

function noSourceMessage(pluginRoot) {
  return [
    `No Maibuk checkout was given for the Plugin repo at ${pluginRoot}.`,
    `Pass --maibuk <path>, set MAIBUK_CHECKOUT, or write { "${LOCAL_CONFIG_KEY}": "/path/to/maibuk" } to ${join(
      pluginRoot,
      LOCAL_CONFIG_FILE
    )}.`,
    `Fix: ${SETUP_COMMAND}`,
  ].join("\n");
}

/**
 * Resolves the Maibuk checkout for the Plugin repo at `input.pluginRoot`. The
 * `--maibuk` flag wins over `MAIBUK_CHECKOUT`, which wins over
 * `maibuk.local.json`; a relative path in that file resolves against the Plugin
 * root. Throws {@link MaibukCheckoutError} when the chosen path is not a valid
 * checkout, or when no source named one at all.
 */
export function resolveMaibukCheckout(input) {
  const { flag, env, pluginRoot } = input;

  if (flag !== undefined && flag !== "") {
    const path = isAbsolute(flag) ? flag : resolve(flag);
    return { path: assertUsableCheckout(path, "--maibuk") };
  }

  if (env !== undefined && env !== "") {
    const path = isAbsolute(env) ? env : resolve(env);
    return { path: assertUsableCheckout(path, "MAIBUK_CHECKOUT") };
  }

  const localFile = join(pluginRoot, LOCAL_CONFIG_FILE);
  if (existsSync(localFile)) {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(localFile, "utf8"));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new MaibukCheckoutError(
        `${localFile} is not valid JSON: ${detail}\nFix: write { "${LOCAL_CONFIG_KEY}": "/path/to/maibuk" } into it.`
      );
    }
    const value = parsed?.[LOCAL_CONFIG_KEY];
    if (typeof value === "string" && value !== "") {
      const path = isAbsolute(value) ? value : resolve(pluginRoot, value);
      return { path: assertUsableCheckout(path, LOCAL_CONFIG_FILE) };
    }
  }

  throw new MaibukCheckoutError(noSourceMessage(pluginRoot));
}

/**
 * Launches the checkout's tooling CLI for `command` over `pluginRoot`, running
 * `process.execPath <checkout>/node_modules/tsx/dist/cli.mjs
 * <checkout>/scripts/plugin/cli.ts <command> <pluginRoot>` with the working
 * directory inside the checkout, so the CLI's `@/` imports resolve exactly as
 * Maibuk's own scripts do. Returns the child's exit code.
 */
export function runCli(command, pluginRoot, flag) {
  const { path: checkout } = resolveMaibukCheckout({
    flag,
    env: process.env.MAIBUK_CHECKOUT,
    pluginRoot,
  });
  const tsx = join(checkout, TSX_LAUNCHER);
  const cli = join(checkout, "scripts", "plugin", "cli.ts");
  return new Promise((settle) => {
    const child = spawn(process.execPath, [tsx, cli, command, pluginRoot], {
      cwd: checkout,
      stdio: "inherit",
      env: process.env,
    });
    child.on("error", (error) => {
      console.error(`Could not launch the tooling CLI: ${error.message}`);
      settle(1);
    });
    child.on("close", (code) => settle(code ?? 1));
  });
}

/** One command line: a command, an optional Plugin path, and `--maibuk <path>`. */
function parseArgs(argv) {
  let flag;
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--maibuk") {
      flag = argv[i + 1];
      i += 1;
    } else if (arg.startsWith("--maibuk=")) {
      flag = arg.slice("--maibuk=".length);
    } else {
      rest.push(arg);
    }
  }
  return { command: rest[0], pluginPath: rest[1], flag };
}

/** Runs one command line; `setup` delegates to `setup.mjs`. Returns the exit code. */
export async function main(argv = process.argv.slice(2)) {
  const { command, pluginPath, flag } = parseArgs(argv);
  if (command === undefined) {
    console.error(USAGE);
    return 2;
  }
  if (command === "setup") {
    const { main: setup } = await import("./setup.mjs");
    return setup(argv);
  }
  const pluginRoot = resolve(
    pluginPath !== undefined && pluginPath !== "" ? pluginPath : process.cwd()
  );
  try {
    return await runCli(command, pluginRoot, flag);
  } catch (error) {
    if (error instanceof MaibukCheckoutError) {
      console.error(error.message);
      return 1;
    }
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
