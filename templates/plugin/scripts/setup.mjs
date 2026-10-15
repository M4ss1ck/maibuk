// The external Plugin repo's one-time setup (issue #455). It writes
// `maibuk.local.json` with the absolute Maibuk checkout path, generates the
// editor's TypeScript configs through the checkout's `configs` command, and
// links the Plugin authoring skill when the checkout carries it. Run it once
// after copying the template:
//
//   node scripts/setup.mjs --maibuk /path/to/maibuk
//
// It is plain Node ESM, so it runs before any dependency is installed. The
// checkout resolution and the CLI launch live in `maibuk.mjs`, the single
// source of truth both scripts share.

import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  LOCAL_CONFIG_FILE,
  LOCAL_CONFIG_KEY,
  MaibukCheckoutError,
  resolveMaibukCheckout,
  runCli,
} from "./maibuk.mjs";

/** The checkout-relative folder the Plugin authoring skill arrives in (#457). */
const SKILL_PATH = "skills/maibuk-plugin";

/** The link paths the skill is linked to, as the repo's skill loaders expect. */
const SKILL_LINKS = [".agents/skills/maibuk-plugin", ".claude/skills/maibuk-plugin"];

/** The `--maibuk <path>` value, or undefined. */
function maibukArg(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--maibuk") return argv[i + 1];
    if (arg.startsWith("--maibuk=")) return arg.slice("--maibuk=".length);
  }
  return undefined;
}

/**
 * Links the Plugin authoring skill from the checkout into this repo when the
 * checkout carries it. #457 ships that skill; until then this is a clearly
 * marked placeholder that prints one line and does nothing. Replace the
 * existence check and the message when the skill lands.
 */
function linkSkill(checkout) {
  const source = join(checkout, SKILL_PATH, "SKILL.md");
  if (!existsSync(source)) {
    console.log(
      "The Maibuk Plugin authoring skill is not in this checkout yet (issue #457); nothing to link."
    );
    return;
  }
  for (const link of SKILL_LINKS) {
    const target = resolve(link);
    mkdirSync(dirname(target), { recursive: true });
    rmSync(target, { recursive: true, force: true });
    symlinkSync(join(checkout, SKILL_PATH), target, "dir");
    console.log(`linked ${link} -> ${join(checkout, SKILL_PATH)}`);
  }
}

/**
 * Writes `maibuk.local.json`, generates the editor configs, and links the skill
 * when the checkout has it. Returns the exit code.
 */
export async function main(argv = process.argv.slice(2)) {
  const pluginRoot = process.cwd();
  let checkout;
  try {
    checkout = resolveMaibukCheckout({
      flag: maibukArg(argv),
      env: process.env.MAIBUK_CHECKOUT,
      pluginRoot,
    });
  } catch (error) {
    if (error instanceof MaibukCheckoutError) {
      console.error(error.message);
      return 1;
    }
    throw error;
  }

  writeFileSync(
    join(pluginRoot, LOCAL_CONFIG_FILE),
    `${JSON.stringify({ [LOCAL_CONFIG_KEY]: checkout.path }, null, 2)}\n`
  );
  console.log(`wrote ${LOCAL_CONFIG_FILE} -> ${checkout.path}`);

  const code = await runCli("configs", pluginRoot, checkout.path);
  if (code !== 0) return code;

  linkSkill(checkout.path);
  console.log("setup complete");
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
