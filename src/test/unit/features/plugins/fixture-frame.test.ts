// @vitest-environment node
/**
 * The fixture-frame Plugin source (issue #454 unit U6): one manifest with
 * `customUi: true`, a whole-page Frame page (`ui/page.html`), and a Remote UI
 * page that embeds a kit Frame. The manifest is committed by hand under
 * e2e/fixtures/plugin-sources/, so this guards it before global setup ever
 * bundles the Plugin, and checks the Frame's `ui/` files the manifest declares
 * exist in the source folder.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePluginManifest, validateManifestValue } from "@/features/plugins/manifest-validate";
import type { PluginManifest } from "@/features/plugins/types";

const SOURCE_DIR = join(process.cwd(), "e2e/fixtures/plugin-sources/fixture-frame");
const FRAME_FILES = [
  "ui/page.html",
  "ui/page.js",
  "ui/page.css",
  "ui/embed.html",
  "ui/embed.js",
  "ui/pixel.svg",
];

function manifestValue(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SOURCE_DIR, "manifest.json"), "utf8")) as Record<
    string,
    unknown
  >;
}

function readManifest(): PluginManifest {
  const result = parsePluginManifest(readFileSync(join(SOURCE_DIR, "manifest.json"), "utf8"));
  if (!result.ok) throw new Error(`manifest.json: ${JSON.stringify(result.problems, null, 2)}`);
  return result.manifest;
}

describe("fixture-frame Plugin source", () => {
  it("parses with the real validator, declaring customUi and a persistent lifecycle", () => {
    const manifest = readManifest();
    expect(manifest.id).toBe("fixture-frame");
    expect(manifest.lifecycle).toBe("persistent");
    expect(manifest.customUi).toBe(true);
  });

  it("declares a whole-page Frame page and an embedded kit Frame page", () => {
    const pages = readManifest().contributes?.pages ?? [];
    const byId = new Map(pages.map((page) => [page.id, page]));
    expect(byId.get("frame")?.frame).toBe("ui/page.html");
    expect(byId.get("embed")?.frame).toBeUndefined();
  });

  it("declares the page-openers plus the two self-navigation Commands", () => {
    const ids = new Set((readManifest().contributes?.commands ?? []).map((command) => command.id));
    for (const id of ["openFrame", "openEmbed", "navigateData", "navigateBlob"]) {
      expect(ids.has(id), `missing Command ${id}`).toBe(true);
    }
  });

  it("points the page frame at a real file in the source folder", () => {
    const result = validateManifestValue(manifestValue(), { files: FRAME_FILES });
    if (!result.ok) throw new Error(JSON.stringify(result.problems, null, 2));
    expect(result.manifest.contributes?.pages?.find((page) => page.id === "frame")?.frame).toBe(
      "ui/page.html"
    );
    for (const file of FRAME_FILES) {
      expect(existsSync(join(SOURCE_DIR, file)), `missing ${file}`).toBe(true);
    }
  });
});
