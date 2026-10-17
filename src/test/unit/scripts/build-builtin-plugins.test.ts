// @vitest-environment node
// The Built-in Plugin build pipeline (issue #444): a sample built through the
// test-only ids list lands as an installable folder whose `index.json` hash the
// app recomputes, an excluded platform is omitted, the empty shipped list writes
// an index with no fixtures, and the gzip bundle-size gate reports the offender.
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hashPluginDirectory } from "@/features/plugins/directory-hash";
import { readFolderFiles } from "@/test/support/plugin-fixtures";
import {
  buildBuiltInPlugins,
  checkBundleSize,
  defaultTarget,
  parseTargetArg,
} from "../../../../scripts/build-builtin-plugins";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const FIXTURE_ROOT = resolve(REPO_ROOT, "src/test/fixtures/builtin-plugins");

const roots: string[] = [];

function tempOutRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "maibuk-builtin-"));
  roots.push(root);
  return root;
}

function readIndex(outRoot: string): { plugins: Array<Record<string, unknown>> } {
  return JSON.parse(readFileSync(join(outRoot, "index.json"), "utf8"));
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("buildBuiltInPlugins()", () => {
  it("builds a sample Built-in into the installable layout with a matching hash", async () => {
    const outRoot = tempOutRoot();
    await buildBuiltInPlugins({
      sourceRoot: FIXTURE_ROOT,
      ids: ["sample-builtin"],
      outRoot,
      target: "web",
    });

    const pluginDir = join(outRoot, "sample-builtin");
    const built = readFolderFiles(pluginDir)
      .map((file) => file.path)
      .sort();
    expect(built).toEqual(["assets/note.txt", "index.js", "manifest.json"]);

    const index = readIndex(outRoot);
    expect(index.plugins).toHaveLength(1);
    const [entry] = index.plugins as unknown as [{ id: string; hash: string; files: string[] }];
    expect(entry.id).toBe("sample-builtin");
    // The hash is the one the app computes over the built folder, byte for byte.
    expect(entry.hash).toBe(await hashPluginDirectory(readFolderFiles(pluginDir)));
    // The file list is the built folder's paths, sorted.
    expect(entry.files).toEqual(built);
  });

  it("omits a Built-in whose manifest platforms exclude the target", async () => {
    const outRoot = tempOutRoot();
    const index = await buildBuiltInPlugins({
      sourceRoot: FIXTURE_ROOT,
      ids: ["desktop-only"],
      outRoot,
      target: "web",
    });

    expect(index.plugins).toEqual([]);
    expect(readIndex(outRoot).plugins).toEqual([]);
    expect(readdirSync(outRoot)).toEqual(["index.json"]);
  });

  it("ships a Built-in for the android target when its platforms list android (#517)", async () => {
    const outRoot = tempOutRoot();
    // sample-builtin lists android; desktop-only does not.
    const index = await buildBuiltInPlugins({
      sourceRoot: FIXTURE_ROOT,
      ids: ["sample-builtin", "desktop-only"],
      outRoot,
      target: "android",
    });

    expect(index.plugins.map((p) => p.id)).toEqual(["sample-builtin"]);
    expect(() => readdirSync(join(outRoot, "desktop-only"))).toThrow();
  });

  // Issue #444: an id a previous target shipped must not survive into this
  // target's output, or a Release build would install a Built-in it excludes.
  it("empties outRoot so an id excluded for this target does not survive a previous run", async () => {
    const outRoot = tempOutRoot();
    await buildBuiltInPlugins({
      sourceRoot: FIXTURE_ROOT,
      ids: ["sample-builtin", "desktop-only"],
      outRoot,
      target: "desktop",
    });
    expect(readdirSync(outRoot).sort()).toEqual([
      "desktop-only",
      "index.json",
      "sample-builtin",
    ]);

    const index = await buildBuiltInPlugins({
      sourceRoot: FIXTURE_ROOT,
      ids: ["sample-builtin", "desktop-only"],
      outRoot,
      target: "web",
    });

    expect(index.plugins.map((plugin) => plugin.id)).toEqual(["sample-builtin"]);
    expect(readdirSync(outRoot).sort()).toEqual(["index.json", "sample-builtin"]);
    expect(() => readdirSync(join(outRoot, "desktop-only"))).toThrow();
  });

  it("builds the shipped list, Echoes only, without fixtures", async () => {
    const outRoot = tempOutRoot();
    const shipped = JSON.parse(readFileSync(join(REPO_ROOT, "plugins/builtins.json"), "utf8")) as {
      plugins: string[];
    };
    expect(shipped.plugins).toEqual(["maibuk-echoes"]);

    await buildBuiltInPlugins({
      sourceRoot: join(REPO_ROOT, "plugins"),
      ids: shipped.plugins,
      outRoot,
      target: "web",
    });

    const names = readdirSync(outRoot);
    expect(names.sort()).toEqual(["index.json", "maibuk-echoes"]);
    expect(names).not.toContain("sample-builtin");
    expect(names).not.toContain("remote-ui");
    expect(readIndex(outRoot).plugins.map((plugin) => plugin.id)).toEqual(["maibuk-echoes"]);
  });
});

describe("checkBundleSize()", () => {
  it("passes the sample under the budget and reports a tiny limit as the offender", async () => {
    const outRoot = tempOutRoot();
    await buildBuiltInPlugins({
      sourceRoot: FIXTURE_ROOT,
      ids: ["sample-builtin"],
      outRoot,
      target: "web",
    });

    const [size] = checkBundleSize(outRoot);
    expect(size.id).toBe("sample-builtin");
    expect(size.bytes).toBeGreaterThan(0);
    expect(size.bytes).toBeLessThanOrEqual(150 * 1024);
    expect(size.ok).toBe(true);

    const [tight] = checkBundleSize(outRoot, 10);
    expect(tight.ok).toBe(false);
    expect(tight.bytes).toBeGreaterThan(10);
    expect(tight.limitBytes).toBe(10);
  });
});

describe("defaultTarget()", () => {
  it("reads Tauri's platform, mapping every desktop platform to desktop", () => {
    expect(defaultTarget({ TAURI_ENV_PLATFORM: "android" })).toBe("android");
    for (const platform of ["linux", "windows", "darwin"]) {
      expect(defaultTarget({ TAURI_ENV_PLATFORM: platform })).toBe("desktop");
    }
  });

  it("reads VITE_BUILD_TARGET=web when Tauri is absent", () => {
    expect(defaultTarget({ VITE_BUILD_TARGET: "web" })).toBe("web");
  });

  it("defaults to desktop when neither environment variable is set", () => {
    expect(defaultTarget({})).toBe("desktop");
    // An empty Tauri platform falls through, like an absent one.
    expect(defaultTarget({ TAURI_ENV_PLATFORM: "" })).toBe("desktop");
  });
});

describe("parseTargetArg()", () => {
  it("reads the target from --target and --target=", () => {
    expect(parseTargetArg(["--target", "web"])).toBe("web");
    expect(parseTargetArg(["--target=android"])).toBe("android");
    expect(parseTargetArg(["--other", "x", "--target", "desktop"])).toBe("desktop");
  });

  it("returns undefined when no --target is present", () => {
    expect(parseTargetArg([])).toBeUndefined();
    expect(parseTargetArg(["build"])).toBeUndefined();
  });

  it("throws for a target outside the manifest platforms", () => {
    expect(() => parseTargetArg(["--target", "ios"])).toThrow(/--target must be one of/);
    expect(() => parseTargetArg(["--target=ios"])).toThrow(/--target must be one of/);
  });
});
