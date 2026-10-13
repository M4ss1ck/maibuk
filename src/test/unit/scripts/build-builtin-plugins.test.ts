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
import { buildBuiltInPlugins, checkBundleSize } from "../../../../scripts/build-builtin-plugins";

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

  it("writes an index with zero plugins for the empty shipped list, without fixtures", async () => {
    const outRoot = tempOutRoot();
    const shipped = JSON.parse(readFileSync(join(REPO_ROOT, "plugins/builtins.json"), "utf8")) as {
      plugins: string[];
    };
    expect(shipped.plugins).toEqual([]);

    await buildBuiltInPlugins({
      sourceRoot: join(REPO_ROOT, "plugins"),
      ids: shipped.plugins,
      outRoot,
      target: "web",
    });

    const names = readdirSync(outRoot);
    expect(names).toEqual(["index.json"]);
    expect(names).not.toContain("sample-builtin");
    expect(names).not.toContain("remote-ui");
    expect(readIndex(outRoot).plugins).toEqual([]);
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
