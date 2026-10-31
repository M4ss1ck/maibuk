// @vitest-environment node
//
// The E2E seed (`e2e/support/storage.ts`) writes the approval record the
// runtime reads. This proves the record it builds for the `fixture-everything`
// Plugin is exactly the one the approval flow writes (`approvePluginCopy`), so
// a spec that seeds "approved" exercises the same bytes a keyboard approval
// produces (#446). It builds the fixture through the real Built-in build, the
// same routine the E2E global setup uses, into a throwaway folder.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { approvePluginCopy } from "@/features/plugins/approvals";
import { hashPluginDirectory, pluginFileDigests } from "@/features/plugins/directory-hash";
import type { PluginManifest } from "@/features/plugins/types";
import { readFolderFiles } from "@/test/support/plugin-fixtures";
import { buildApproval, type PluginSeedData } from "../../../e2e/support/storage";
import { buildPlugin } from "../../../scripts/build-plugin";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const SOURCE_DIR = resolve(REPO_ROOT, "e2e/fixtures/plugin-sources/fixture-everything");

const outDir = mkdtempSync(join(tmpdir(), "maibuk-fixture-everything-"));

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true });
});

describe("the E2E fixture-everything seed", () => {
  it("builds the exact approval record the approval flow writes", async () => {
    await buildPlugin({
      sourceDir: SOURCE_DIR,
      manifestPath: resolve(SOURCE_DIR, "manifest.json"),
      outDir,
      minify: false,
    });

    const files = readFolderFiles(outDir);
    const manifestFile = files.find((file) => file.path === "manifest.json");
    if (manifestFile === undefined) throw new Error("fixture-everything has no manifest.json");
    const manifest = JSON.parse(new TextDecoder().decode(manifestFile.bytes)) as PluginManifest;
    const pinnedHash = await hashPluginDirectory(files);
    const seed: PluginSeedData = {
      name: "fixture-everything",
      files: files.map((file) => ({
        path: file.path,
        base64: Buffer.from(file.bytes).toString("base64"),
      })),
      pinnedHash,
    };

    // What a spec seeds for the approved fixture: every required Plugin
    // Permission granted, the optional ones left off.
    const seeded = await buildApproval(seed, {
      pluginId: "fixture-everything",
      granted: [...manifest.permissions.required],
    });
    // What the approval flow writes for that same choice (optionalGranted: []).
    const written = approvePluginCopy(manifest, pinnedHash, await pluginFileDigests(files), []);

    expect(seeded).toEqual(written);
  });
});
