// @vitest-environment node
// Checkout resolution for an external Plugin repo (issue #455). The logic lives
// in the template's `scripts/maibuk.mjs` (the single source both the CLI launch
// and `setup.mjs` share): the flag wins over the env var which wins over
// `maibuk.local.json`; a relative path there resolves against the Plugin root;
// every refusal names its source, the path tried, what is missing, and the setup
// command; a path with spaces works.
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
  return root;
}

/** A valid Maibuk checkout folder whose path contains spaces. */
function makeCheckout(): string {
  return fillCheckout(tempDir("maibuk checkout "));
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

  it("names the source, the path, what is missing, and the setup command", () => {
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
    expect(message).toContain("node_modules");
    expect(message).toMatch(/scripts\/setup\.mjs --maibuk/);
  });

  it("tells the author to install dependencies when node_modules is missing", () => {
    const pluginRoot = tempDir();
    const checkout = tempDir("maibuk no modules ");
    writeFileSync(join(checkout, "package.json"), `${JSON.stringify({ name: "maibuk" })}\n`);
    mkdirSync(join(checkout, "scripts/plugin"), { recursive: true });
    writeFileSync(join(checkout, "scripts/plugin/cli.ts"), "export {};\n");
    mkdirSync(join(checkout, "src/plugin-sdk"), { recursive: true });
    writeFileSync(join(checkout, "src/plugin-sdk/index.ts"), "export {};\n");

    expect(() => resolveMaibukCheckout({ flag: checkout, pluginRoot })).toThrow(/pnpm install/);
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
