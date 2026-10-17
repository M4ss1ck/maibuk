// @vitest-environment node
// The `android` step of `plugin:check` (issue #517): skipped unless the manifest's
// `platforms` lists android; otherwise it evaluates the built entry in the Android
// QuickJS engine and names the problem on a missing global, an unevaluable module,
// or a setup that throws. Each fixture is a tiny built bundle written into a temp
// Plugin folder, the same place the build step writes it.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { androidStep, type PluginStepContext } from "../../../../../scripts/plugin/steps";

const MAIBUK_ROOT = join(__dirname, "..", "..", "..", "..", "..");
const roots: string[] = [];

/** A manifest the validator accepts, based on Echoes' and set to one `platforms` list. */
function manifestWith(platforms: string[]): string {
  const echoes = JSON.parse(
    readFileSync(join(MAIBUK_ROOT, "plugins", "maibuk-echoes", "manifest.json"), "utf8")
  ) as Record<string, unknown>;
  return `${JSON.stringify({
    ...echoes,
    id: "sample-android",
    name: "Sample android",
    entry: "index.js",
    platforms,
  })}\n`;
}

/** A Plugin folder: a manifest at the root and, when given, the built bundle. */
function makePlugin(platforms: string[], bundle?: string): PluginStepContext {
  const pluginRoot = mkdtempSync(join(tmpdir(), "maibuk android "));
  roots.push(pluginRoot);
  writeFileSync(join(pluginRoot, "manifest.json"), manifestWith(platforms));
  if (bundle !== undefined) {
    const target = join(pluginRoot, "dist", "sample-android", "index.js");
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bundle);
  }
  return { pluginRoot, maibukRoot: MAIBUK_ROOT };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("androidStep()", () => {
  it("is skipped when the manifest's platforms do not list android", async () => {
    const context = makePlugin(["web", "desktop"]);

    const result = await androidStep(context);

    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.details).toEqual(["manifest.json platforms does not list android"]);
  });

  it("passes a bundle that evaluates and sets up with the Android globals", async () => {
    const context = makePlugin(
      ["web", "android"],
      'globalThis.addEventListener("message", () => {});\nexport const ready = true;\n'
    );

    const result = await androidStep(context);

    expect(result.skipped).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(result.details).toEqual(["index.js evaluates and sets up on the Android engine"]);
  });

  it("names the missing global and the fix when the bundle uses one Android lacks", async () => {
    const context = makePlugin(
      ["android"],
      'export const formatter = new Intl.NumberFormat("en");\n'
    );

    const result = await androidStep(context);

    expect(result.ok).toBe(false);
    expect(result.details).toHaveLength(1);
    expect(result.details[0]).toContain("uses `Intl`, which Android Plugins lack");
    expect(result.details[0]).toContain("bundle a polyfill");
    expect(result.details[0]).toContain("setTimeout");
  });

  it("names the unevaluable module and keeps the engine's own error text", async () => {
    const context = makePlugin(["android"], "export const = ;\n");

    const result = await androidStep(context);

    expect(result.ok).toBe(false);
    expect(result.details).toHaveLength(1);
    expect(result.details[0]).toMatch(/^index\.js does not evaluate on Android: \S/);
    expect(result.details[0]).toContain("Fix the syntax");
  });

  it("names the setup error and keeps the thrown message when setup throws", async () => {
    const context = makePlugin(
      ["android"],
      'globalThis.addEventListener("message", () => {\n  throw new Error("setup exploded");\n});\n'
    );

    const result = await androidStep(context);

    expect(result.ok).toBe(false);
    expect(result.details).toEqual(["the Plugin's setup throws on Android: setup exploded"]);
  });

  it("fails and asks for the build step when the bundle is not built yet", async () => {
    const context = makePlugin(["android"]);

    const result = await androidStep(context);

    expect(result.ok).toBe(false);
    expect(result.details[0]).toBe(
      "dist/sample-android/index.js is missing; run the build step first"
    );
  });
});
