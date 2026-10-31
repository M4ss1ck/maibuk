/**
 * The fixture Plugins the native lanes load must list the platforms they run on
 * (#517). The Plugin Platforms rule makes the launch scan skip a manifest whose
 * `platforms` omit the directory kind, so a fixture that lists only "web" starts
 * nowhere on native. This reads each manifest from disk, as the lanes ship it,
 * and asserts the rule admits the kind it runs on.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { manifestRunsOn, type PluginHostPlatform } from "@/features/plugins/host-platform";
import { parsePluginManifest } from "@/features/plugins/manifest-validate";

const SOURCES_DIR = join(process.cwd(), "e2e/fixtures/plugin-sources");

function loadManifest(folder: string) {
  const text = readFileSync(join(SOURCES_DIR, folder, "manifest.json"), "utf8");
  const result = parsePluginManifest(text);
  if (!result.ok) throw new Error(JSON.stringify(result.problems, null, 2));
  return result.manifest;
}

const DESKTOP: PluginHostPlatform = "desktop";
const ANDROID: PluginHostPlatform = "android";

describe("native lane fixture Plugins list their platforms", () => {
  it.each([
    "fixture-hostile",
    "fixture-healthy",
    "fixture-bench",
  ])("%s runs on the Linux desktop kind (webkitgtk lane)", (folder) => {
    expect(manifestRunsOn(loadManifest(folder).platforms, DESKTOP)).toBe(true);
  });

  it.each([
    "fixture-hostile",
    "fixture-healthy",
  ])("%s runs on the Android kind (conformance:plugins --platform android)", (folder) => {
    expect(manifestRunsOn(loadManifest(folder).platforms, ANDROID)).toBe(true);
  });
});
