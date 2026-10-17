import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PLUGIN_API_VERSION } from "@/features/plugins/api-table";
import { checkPluginCompatibility } from "@/features/plugins/manifest-compat";
import { validateManifestValue } from "@/features/plugins/manifest-validate";
import type { PluginManifest } from "@/features/plugins/types";

// ADR 0029: before 1.0 a Plugin API patch is additive, so a `^0.1` Plugin keeps
// loading on 0.1.1, and a Plugin that needs the 0.1.1 addition declares `^0.1.1`
// and is refused by a 0.1.0 host with the usual compatibility message (#530).

function manifestWith(apiVersion: string): PluginManifest {
  const result = validateManifestValue({
    manifestVersion: 1,
    id: "echoes",
    name: "Echoes",
    description: "Highlights overused words.",
    author: "Andy",
    version: "1.0.0",
    apiVersion,
    entry: "dist/index.js",
    platforms: ["desktop", "web", "android"],
    lifecycle: "on-demand",
    defaultLanguage: "en",
    permissions: { required: ["library:read"], optional: [] },
  });
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  return result.manifest;
}

const APP = "0.12.0";

describe("Plugin API 0.1.1 compatibility (ADR 0029)", () => {
  it("the host reports Plugin API 0.1.1", () => {
    expect(PLUGIN_API_VERSION).toBe("0.1.1");
  });

  it("a ^0.1 Plugin still loads against the 0.1.1 host", () => {
    const verdict = checkPluginCompatibility(manifestWith("^0.1"), {
      apiVersion: "0.1.1",
      appVersion: APP,
    });
    expect(verdict.verdict).toBe("ok");
  });

  it("a ^0.1.1 Plugin is refused by a 0.1.0 host with the usual message", () => {
    const verdict = checkPluginCompatibility(manifestWith("^0.1.1"), {
      apiVersion: "0.1.0",
      appVersion: APP,
    });
    expect(verdict).toEqual({
      verdict: "needs-newer-app",
      reason: "api-version",
      message: "Needs Plugin API ^0.1.1; this app provides 0.1.0",
    });
  });

  it("the Echoes manifest is 0.2.0 and needs Plugin API ^0.1.1", () => {
    const text = readFileSync(
      join(process.cwd(), "plugins", "maibuk-echoes", "manifest.json"),
      "utf8"
    );
    const json = JSON.parse(text) as { version: string; apiVersion: string };
    expect(json.version).toBe("0.2.0");
    expect(json.apiVersion).toBe("^0.1.1");
  });
});
