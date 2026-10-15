// @vitest-environment node
// Packaging a built Plugin folder (issue #455): the `.zip` holds the folder's
// files at its root, sorted by path, and two runs of the same folder produce
// byte-identical output because every entry carries one fixed time. The parent
// directory of the zip is created.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import { packagePlugin } from "../../../../../scripts/plugin/package";

const roots: string[] = [];

function tempDir(prefix = "maibuk package "): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function write(root: string, relPath: string, text: string): void {
  const target = join(root, relPath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
}

/** A built Plugin folder: a manifest, the entry, an asset, and a locale. */
function makeBuiltDir(): string {
  const root = tempDir("maibuk built ");
  write(root, "index.js", "export const x = 1;\n");
  write(root, "manifest.json", `${JSON.stringify({ id: "sample", entry: "index.js" })}\n`);
  write(root, "assets/logo.svg", "<svg></svg>\n");
  write(root, "locales/en.json", `${JSON.stringify({ name: "Sample" })}\n`);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("packagePlugin()", () => {
  it("packs the folder's files at the zip root, sorted, and creates the parent dir", async () => {
    const builtDir = makeBuiltDir();
    const zipPath = join(tempDir("maibuk out "), "nested/dir/plugin.zip");

    const result = await packagePlugin(builtDir, zipPath);

    expect(result.zipPath).toBe(zipPath);
    expect(result.files).toEqual([
      "assets/logo.svg",
      "index.js",
      "locales/en.json",
      "manifest.json",
    ]);

    const entries = unzipSync(readFileSync(zipPath));
    expect(Object.keys(entries).sort()).toEqual(result.files);
    expect(new TextDecoder().decode(entries["manifest.json"])).toContain('"id":"sample"');
    expect(new TextDecoder().decode(entries["index.js"])).toBe("export const x = 1;\n");
  });

  it("produces byte-identical zips on two runs of the same folder", async () => {
    const builtDir = makeBuiltDir();
    const first = join(tempDir("maibuk out "), "one.zip");
    const second = join(tempDir("maibuk out "), "two.zip");

    await packagePlugin(builtDir, first);
    await packagePlugin(builtDir, second);

    expect(readFileSync(first).equals(readFileSync(second))).toBe(true);
  });
});
