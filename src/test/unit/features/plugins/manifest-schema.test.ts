import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DICTATION_LANGUAGES } from "@/features/dictation/spoken-punctuation";
import {
  MANIFEST_LANGUAGES,
  PLUGIN_PLATFORMS,
  buildPluginManifestJsonSchema,
} from "@/features/plugins/manifest-schema";

const committed = JSON.parse(
  readFileSync("src/features/plugins/manifest.schema.json", "utf8")
) as Record<string, unknown>;

describe("manifest.schema.json", () => {
  it("is exactly what the generator emits (run pnpm generate:plugin-manifest)", () => {
    expect(committed).toEqual(buildPluginManifestJsonSchema());
  });

  it("refuses unknown fields except x-* at the top level and in contributions", () => {
    expect(committed.additionalProperties).toBe(false);
    expect(committed.patternProperties).toEqual({ "^x-": {} });
    const properties = committed.properties as Record<string, any>;
    const command = properties.contributes.properties.commands.items;
    expect(command.additionalProperties).toBe(false);
    expect(command.patternProperties).toEqual({ "^x-": {} });
  });

  it("reserves maibuk- and tutorial- in the id pattern for third-party Plugins", () => {
    const properties = committed.properties as Record<string, any>;
    expect(properties.id.pattern).toBe("^(?!maibuk-|tutorial-)[a-z0-9-]{3,64}$");
  });

  it("requires every frozen top-level field", () => {
    expect(committed.required).toEqual([
      "manifestVersion",
      "id",
      "name",
      "description",
      "author",
      "version",
      "apiVersion",
      "entry",
      "platforms",
      "lifecycle",
      "defaultLanguage",
      "permissions",
    ]);
  });

  it("lists the six contribution kinds", () => {
    const properties = committed.properties as Record<string, any>;
    expect(Object.keys(properties.contributes.properties).sort()).toEqual([
      "commands",
      "itemMenuEntries",
      "pages",
      "settingsRows",
      "sidebarEntries",
      "toolbarButtons",
    ]);
  });

  it("keeps manifestVersion a constant 1", () => {
    const properties = committed.properties as Record<string, any>;
    expect(properties.manifestVersion.const).toBe(1);
  });
});

describe("manifest language and platform names", () => {
  it("matches the Dictation languages", () => {
    expect([...MANIFEST_LANGUAGES]).toEqual([...DICTATION_LANGUAGES]);
  });

  it("covers desktop, web, and android", () => {
    expect([...PLUGIN_PLATFORMS]).toEqual(["desktop", "web", "android"]);
  });
});
