// @vitest-environment node
/**
 * The fixture-everything Plugin source (issue #446): every contribution point
 * and every Plugin Permission in one manifest, an English-only Command with a
 * custom Spanish phrase, and a second manifest over the same source for the
 * on-demand lifecycle. The manifests are committed by hand under
 * e2e/fixtures/plugin-sources/, so this guards them before global setup ever
 * bundles the Plugin.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONTRIBUTION_LIMITS,
  PLUGIN_PERMISSION_NAMES,
  parsePluginLocale,
  parsePluginManifest,
} from "@/features/plugins/manifest-validate";
import type { PluginManifest } from "@/features/plugins/types";

const SOURCE_DIR = join(process.cwd(), "e2e/fixtures/plugin-sources/fixture-everything");
const MANIFESTS = ["manifest.json", "manifest.on-demand.json"] as const;

function readText(name: string): string {
  return readFileSync(join(SOURCE_DIR, name), "utf8");
}

function parseManifest(name: string): PluginManifest {
  const result = parsePluginManifest(readText(name));
  if (!result.ok) throw new Error(`${name}: ${JSON.stringify(result.problems, null, 2)}`);
  return result.manifest;
}

/** A manifest with the two fields the on-demand copy may change removed. */
function withoutIdentity(manifest: PluginManifest): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...manifest };
  delete copy.id;
  delete copy.lifecycle;
  return copy;
}

describe("fixture-everything Plugin source", () => {
  it("both manifests parse with the real validator, one per lifecycle", () => {
    expect(parseManifest("manifest.json").id).toBe("fixture-everything");
    expect(parseManifest("manifest.json").lifecycle).toBe("persistent");
    expect(parseManifest("manifest.on-demand.json").id).toBe("fixture-everything-on-demand");
    expect(parseManifest("manifest.on-demand.json").lifecycle).toBe("on-demand");
  });

  it("declares every contribution point, derived from the schema's own limits", () => {
    const points = Object.keys(CONTRIBUTION_LIMITS) as (keyof typeof CONTRIBUTION_LIMITS)[];
    for (const name of MANIFESTS) {
      const contributes = parseManifest(name).contributes ?? {};
      for (const point of points) {
        expect(contributes[point]?.length ?? 0, `${name} ${point}`).toBeGreaterThan(0);
      }
    }
  });

  it("covers every Plugin Permission plus a network host, split across both lists", () => {
    for (const name of MANIFESTS) {
      const { required, optional } = parseManifest(name).permissions;
      expect(required.length, name).toBeGreaterThan(0);
      expect(optional.length, name).toBeGreaterThan(0);
      const all = new Set([...required, ...optional]);
      for (const permission of PLUGIN_PERMISSION_NAMES) {
        expect(all.has(permission), `${name} ${permission}`).toBe(true);
      }
      expect([...all].some((permission) => permission.startsWith("network:"))).toBe(true);
      for (const permission of optional) {
        expect(required.includes(permission), `${name} ${permission}`).toBe(false);
      }
    }
  });

  it("localizes en and es, keeping one English-only Command with a Spanish phrase", () => {
    const manifest = parseManifest("manifest.json");
    const en = parsePluginLocale(readText("locales/en.json"), "en", manifest);
    const es = parsePluginLocale(readText("locales/es.json"), "es", manifest);
    if (!en.ok) throw new Error(`en: ${JSON.stringify(en.problems, null, 2)}`);
    if (!es.ok) throw new Error(`es: ${JSON.stringify(es.problems, null, 2)}`);

    // The English-only Command is labeled in en and deliberately not in es.
    expect(en.locale["commands.englishOnly.label"]).toBe("English only");
    expect(es.locale["commands.englishOnly.label"]).toBeUndefined();
    // Its Spanish Voice Command phrase lives in the manifest, not the locale
    // (parsePluginLocale refuses a voice path).
    const englishOnly = manifest.contributes?.commands?.find(
      (command) => command.id === "englishOnly"
    );
    expect(englishOnly?.voice?.phrases?.es?.length ?? 0).toBeGreaterThan(0);
    // Every other localizable string is present in both languages.
    for (const key of ["commands.stamp.label", "commands.openPage.label", "pages.panel.title"]) {
      expect(en.locale[key], `en ${key}`).toBeDefined();
      expect(es.locale[key], `es ${key}`).toBeDefined();
    }
  });

  it("the two manifests differ only in id and lifecycle", () => {
    expect(withoutIdentity(parseManifest("manifest.on-demand.json"))).toEqual(
      withoutIdentity(parseManifest("manifest.json"))
    );
  });
});
