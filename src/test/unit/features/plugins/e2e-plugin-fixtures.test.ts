/**
 * The E2E lane's source-built fixture Plugins (issue #446). Each manifest is
 * committed by hand under e2e/fixtures/plugin-sources/, so this guards it
 * against the schema before global setup ever bundles the Plugin.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePluginManifest } from "@/features/plugins/manifest-validate";

const SOURCES_DIR = join(process.cwd(), "e2e/fixtures/plugin-sources");

describe("E2E fixture Plugin sources", () => {
  it("the remote-ui manifest parses", () => {
    const text = readFileSync(join(SOURCES_DIR, "remote-ui/manifest.json"), "utf8");
    const result = parsePluginManifest(text);
    if (!result.ok) throw new Error(JSON.stringify(result.problems, null, 2));
    expect(result.manifest.id).toBe("remote-ui");
  });
});
