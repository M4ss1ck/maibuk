// @vitest-environment node
// Checkout resolution for an external Plugin repo (issue #455). The logic lives
// in the template's `scripts/maibuk.mjs` (the single source both the CLI launch
// and `setup.mjs` share): the flag wins over the env var which wins over
// `maibuk.local.json`; a relative path there resolves against the Plugin root.
// Every refusal names its source, the path tried, and what is missing; the
// `Fix:` line depends on the failure kind (a wrong path names the source, a
// valid checkout whose deps are missing asks for `pnpm install`); a path with
// spaces works.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  LOCAL_CONFIG_FILE,
  MaibukCheckoutError,
  resolveMaibukCheckout,
} from "../../../../../templates/plugin/scripts/maibuk.mjs";

const roots: string[] = [];

function tempDir(prefix = "maibuk plugin root "): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

/** Fills a folder with everything a valid Maibuk checkout needs, creating it first. */
function fillCheckout(root: string): string {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "package.json"), `${JSON.stringify({ name: "maibuk" })}\n`);
  mkdirSync(join(root, "scripts/plugin"), { recursive: true });
  writeFileSync(join(root, "scripts/plugin/cli.ts"), "export {};\n");
  mkdirSync(join(root, "src/plugin-sdk"), { recursive: true });
  writeFileSync(join(root, "src/plugin-sdk/index.ts"), "export {};\n");
  mkdirSync(join(root, "node_modules"), { recursive: true });
  mkdirSync(join(root, "node_modules/tsx/dist"), { recursive: true });
  writeFileSync(join(root, "node_modules/tsx/dist/cli.mjs"), "export {};\n");
  return root;
}

/** A valid Maibuk checkout folder whose path contains spaces. */
function makeCheckout(): string {
  return fillCheckout(tempDir("maibuk checkout "));
}

/** A structurally valid checkout (name, CLI, SDK entry) whose deps are not installed. */
function checkoutWithoutDeps(prefix: string): string {
  const root = tempDir(prefix);
  writeFileSync(join(root, "package.json"), `${JSON.stringify({ name: "maibuk" })}\n`);
  mkdirSync(join(root, "scripts/plugin"), { recursive: true });
  writeFileSync(join(root, "scripts/plugin/cli.ts"), "export {};\n");
  mkdirSync(join(root, "src/plugin-sdk"), { recursive: true });
  writeFileSync(join(root, "src/plugin-sdk/index.ts"), "export {};\n");
  return root;
}

/** The exact `Fix:` line each source prints when it did not name a Maibuk checkout. */
const STRUCTURAL_FIX = {
  flag: "Fix: pass the path of a Maibuk checkout to --maibuk.",
  env: "Fix: correct or unset MAIBUK_CHECKOUT, or run node scripts/setup.mjs --maibuk <path/to/maibuk>.",
  local: "Fix: node scripts/setup.mjs --maibuk <path/to/maibuk>.",
} as const;

/** The message `resolveMaibukCheckout` throws for `run`, asserting the error type. */
function refusal(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (!(error instanceof MaibukCheckoutError)) throw error;
    return error.message;
  }
  throw new Error("expected resolveMaibukCheckout to throw");
}

/** Calls the resolver the way each of the three sources would. */
function viaSource(
  source: "flag" | "env" | "local",
  checkout: string,
  pluginRoot: string
): () => unknown {
  if (source === "flag") return () => resolveMaibukCheckout({ flag: checkout, pluginRoot });
  if (source === "env") return () => resolveMaibukCheckout({ env: checkout, pluginRoot });
  writeFileSync(
    join(pluginRoot, LOCAL_CONFIG_FILE),
    `${JSON.stringify({ maibukCheckout: checkout })}\n`
  );
  return () => resolveMaibukCheckout({ pluginRoot });
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("resolveMaibukCheckout()", () => {
  it("resolves the path from the --maibuk flag, spaces and all", () => {
    const checkout = makeCheckout();
    const pluginRoot = tempDir();

    expect(resolveMaibukCheckout({ flag: checkout, pluginRoot })).toEqual({ path: checkout });
  });

  it("resolves the path from MAIBUK_CHECKOUT when no flag is given", () => {
    const checkout = makeCheckout();
    const pluginRoot = tempDir();

    expect(resolveMaibukCheckout({ env: checkout, pluginRoot })).toEqual({ path: checkout });
  });

  it("resolves a relative maibuk.local.json path against the Plugin root", () => {
    const pluginRoot = tempDir();
    const checkout = fillCheckout(join(pluginRoot, "a checkout with spaces"));
    writeFileSync(
      join(pluginRoot, LOCAL_CONFIG_FILE),
      `${JSON.stringify({ maibukCheckout: "a checkout with spaces" })}\n`
    );

    expect(resolveMaibukCheckout({ pluginRoot })).toEqual({ path: checkout });
  });

  it("prefers the flag, then the env var, then maibuk.local.json", () => {
    const pluginRoot = tempDir();
    const fromFlag = makeCheckout();
    const fromEnv = makeCheckout();
    const fromFile = fillCheckout(join(pluginRoot, "from-file"));
    writeFileSync(
      join(pluginRoot, LOCAL_CONFIG_FILE),
      `${JSON.stringify({ maibukCheckout: "from-file" })}\n`
    );

    expect(resolveMaibukCheckout({ flag: fromFlag, env: fromEnv, pluginRoot }).path).toBe(fromFlag);
    expect(resolveMaibukCheckout({ env: fromEnv, pluginRoot }).path).toBe(fromEnv);
    expect(resolveMaibukCheckout({ pluginRoot }).path).toBe(fromFile);
  });

  it("ignores an empty flag and falls through to the env var", () => {
    const checkout = makeCheckout();
    const pluginRoot = tempDir();

    expect(resolveMaibukCheckout({ flag: "", env: checkout, pluginRoot }).path).toBe(checkout);
  });

  it("names the source, the path, what is missing, and the flag's fix", () => {
    const pluginRoot = tempDir();
    const broken = tempDir("maibuk broken checkout ");

    let error: unknown;
    try {
      resolveMaibukCheckout({ flag: broken, pluginRoot });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(MaibukCheckoutError);
    const message = (error as Error).message;
    expect(message).toContain("--maibuk");
    expect(message).toContain(broken);
    expect(message).toContain("package.json");
    expect(message).toContain("scripts/plugin/cli.ts");
    expect(message).toContain("src/plugin-sdk/index.ts");
    expect(message).toContain(STRUCTURAL_FIX.flag);
    expect(message).not.toMatch(/pnpm install/);
  });

  for (const source of ["flag", "env", "local"] as const) {
    it(`(a) a path that is not a folder: the ${source} source's own fix, no install`, () => {
      const pluginRoot = tempDir();
      const missingPath = join(tempDir("maibuk not a folder "), "no such checkout");
      const message = refusal(viaSource(source, missingPath, pluginRoot));

      expect(message).toContain(missingPath);
      expect(message).toContain(STRUCTURAL_FIX[source]);
      expect(message).not.toMatch(/pnpm install/);
    });

    it(`(a) a folder that is not a Maibuk checkout: the ${source} source's own fix, no install`, () => {
      const pluginRoot = tempDir();
      const notCheckout = tempDir("maibuk not a checkout ");
      const message = refusal(viaSource(source, notCheckout, pluginRoot));

      expect(message).toContain(notCheckout);
      expect(message).toContain("package.json");
      expect(message).toContain(STRUCTURAL_FIX[source]);
      expect(message).not.toMatch(/pnpm install/);
    });

    it(`(b) a valid checkout with missing dependencies: only the install fix (${source})`, () => {
      const pluginRoot = tempDir();
      const checkout = checkoutWithoutDeps(`maibuk no deps ${source} `);
      const message = refusal(viaSource(source, checkout, pluginRoot));

      expect(message).toContain("node_modules is missing; dependencies are not installed");
      expect(message).toContain(`Fix: run "pnpm install" in ${checkout}.`);
      // The bullet says what is missing; `pnpm install` appears once, in the Fix line.
      expect(message.match(/pnpm install/g)).toHaveLength(1);
    });
  }

  it("(b) an incomplete node_modules (only .pnpm): names the launcher and the install fix", () => {
    const pluginRoot = tempDir();
    // A checkout is otherwise complete, but its `node_modules` holds only the
    // store folder: the launcher the bootstrap spawns is absent, which used to
    // reach node as a raw MODULE_NOT_FOUND stack trace.
    const checkout = checkoutWithoutDeps("maibuk partial modules ");
    mkdirSync(join(checkout, "node_modules/.pnpm"), { recursive: true });

    const message = refusal(() => resolveMaibukCheckout({ flag: checkout, pluginRoot }));

    expect(message).toContain("--maibuk");
    expect(message).toContain(checkout);
    expect(message).toContain("node_modules/tsx/dist/cli.mjs");
    expect(message).toMatch(/dependencies are not installed/);
    expect(message).toContain(`Fix: run "pnpm install" in ${checkout}.`);
    expect(message.match(/pnpm install/g)).toHaveLength(1);
  });

  it("rejects a folder whose package.json does not name maibuk", () => {
    const pluginRoot = tempDir();
    const checkout = makeCheckout();
    writeFileSync(join(checkout, "package.json"), `${JSON.stringify({ name: "not-maibuk" })}\n`);

    expect(() => resolveMaibukCheckout({ flag: checkout, pluginRoot })).toThrow(
      /does not name "maibuk"/
    );
  });

  it("has its own message when no source is given at all", () => {
    const pluginRoot = tempDir("maibuk plugin root ");

    let error: unknown;
    try {
      resolveMaibukCheckout({ pluginRoot });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(MaibukCheckoutError);
    const message = (error as Error).message;
    expect(message).toMatch(/--maibuk/);
    expect(message).toMatch(/MAIBUK_CHECKOUT/);
    expect(message).toContain(LOCAL_CONFIG_FILE);
    expect(message).toMatch(/scripts\/setup\.mjs --maibuk/);
  });

  it("refuses a maibuk.local.json that is not valid JSON", () => {
    const pluginRoot = tempDir();
    writeFileSync(join(pluginRoot, LOCAL_CONFIG_FILE), "{ not json");

    expect(() => resolveMaibukCheckout({ pluginRoot })).toThrow(MaibukCheckoutError);
    expect(() => resolveMaibukCheckout({ pluginRoot })).toThrow(
      /maibuk\.local\.json is not valid JSON/
    );
  });
});
