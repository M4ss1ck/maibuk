/**
 * Resolves the Maibuk checkout an external Plugin repo points at (issue #455).
 * The tooling runs from inside the checkout, so an external repo only needs to
 * name it once: the `--maibuk <path>` flag, the `MAIBUK_CHECKOUT` environment
 * variable, or `maibuk.local.json` in the Plugin root (machine-specific and
 * GITIGNORED). A relative path in that file resolves against the Plugin root.
 *
 * A checkout is valid when `<path>/package.json` names `maibuk`,
 * `<path>/scripts/plugin/cli.ts` and `<path>/src/plugin-sdk/index.ts` exist, and
 * `<path>/node_modules` exists. Every refusal is actionable: it names the source
 * used, the path tried, what is missing, and the command that fixes it.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

/** The file an external Plugin repo writes its checkout path to. */
export const LOCAL_CONFIG_FILE = "maibuk.local.json";

/** The key {@link LOCAL_CONFIG_FILE} holds the checkout path under. */
export const LOCAL_CONFIG_KEY = "maibukCheckout";

/** The command that writes {@link LOCAL_CONFIG_FILE} for the author. */
const SETUP_COMMAND = "node scripts/setup.mjs --maibuk <path/to/maibuk>";

/** A refused checkout, or a call that named no source at all (#455). */
export class MaibukCheckoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MaibukCheckoutError";
  }
}

/** What {@link resolveMaibukCheckout} reads: the three sources, in precedence order. */
export interface ResolveMaibukCheckoutInput {
  /** The `--maibuk <path>` flag value, when given. */
  flag?: string;
  /** The `MAIBUK_CHECKOUT` environment variable value, when given. */
  env?: string;
  /** The external Plugin repo's root, where {@link LOCAL_CONFIG_FILE} lives. */
  pluginRoot: string;
}

/** The usable Maibuk checkout. */
export interface MaibukCheckout {
  /** The absolute checkout path. */
  path: string;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Everything a candidate checkout is missing or has wrong, in reading order. */
function missingRequirements(root: string): string[] {
  const missing: string[] = [];
  const packagePath = join(root, "package.json");
  if (!existsSync(packagePath)) {
    missing.push("package.json is missing");
  } else {
    try {
      const parsed = JSON.parse(readFileSync(packagePath, "utf8")) as { name?: unknown };
      if (parsed.name !== "maibuk") missing.push('package.json does not name "maibuk"');
    } catch {
      missing.push("package.json is not valid JSON");
    }
  }
  if (!existsSync(join(root, "scripts/plugin/cli.ts"))) {
    missing.push("scripts/plugin/cli.ts is missing");
  }
  if (!existsSync(join(root, "src/plugin-sdk/index.ts"))) {
    missing.push("src/plugin-sdk/index.ts is missing");
  }
  if (!isDirectory(join(root, "node_modules"))) {
    missing.push(`node_modules is missing; run "pnpm install" in ${root}`);
  }
  return missing;
}

/** Returns the path when it is a usable checkout, otherwise throws with the detail. */
function assertUsableCheckout(path: string, source: string): string {
  if (!isDirectory(path)) {
    throw new MaibukCheckoutError(
      `The Maibuk checkout named by ${source} is not a folder: ${path}\nFix: ${SETUP_COMMAND}`
    );
  }
  const missing = missingRequirements(path);
  if (missing.length > 0) {
    throw new MaibukCheckoutError(
      [
        `The Maibuk checkout named by ${source} is not usable: ${path}`,
        ...missing.map((entry) => `  - ${entry}`),
        `Fix: ${SETUP_COMMAND}, or run "pnpm install" in the checkout.`,
      ].join("\n")
    );
  }
  return path;
}

function noSourceMessage(pluginRoot: string): string {
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
export function resolveMaibukCheckout(input: ResolveMaibukCheckoutInput): MaibukCheckout {
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
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(localFile, "utf8"));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new MaibukCheckoutError(
        `${localFile} is not valid JSON: ${detail}\nFix: write { "${LOCAL_CONFIG_KEY}": "/path/to/maibuk" } into it.`
      );
    }
    const value = (parsed as Record<string, unknown> | null)?.[LOCAL_CONFIG_KEY];
    if (typeof value === "string" && value !== "") {
      const path = isAbsolute(value) ? value : resolve(pluginRoot, value);
      return { path: assertUsableCheckout(path, LOCAL_CONFIG_FILE) };
    }
  }

  throw new MaibukCheckoutError(noSourceMessage(pluginRoot));
}
