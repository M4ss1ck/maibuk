import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DICTATION_LANGUAGES } from "@/features/dictation/spoken-punctuation";
import {
  MANIFEST_LANGUAGES,
  PLUGIN_PLATFORMS,
  buildPluginManifestJsonSchema,
  pluginManifestSchema,
} from "@/features/plugins/manifest-schema";
import { PLUGIN_MANIFEST } from "@/test/support/plugin-fixtures";

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

  it("lists the seven contribution kinds", () => {
    const properties = committed.properties as Record<string, any>;
    expect(Object.keys(properties.contributes.properties).sort()).toEqual([
      "canvasReferenceSources",
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

  it("requires non-empty keyword strings and Settings row descriptions", () => {
    const properties = committed.properties as Record<string, any>;
    const command = properties.contributes.properties.commands.items;
    expect(command.properties.keywords.items.minLength).toBe(1);
    const settingsRow = properties.contributes.properties.settingsRows.items;
    expect(settingsRow.properties.keywords.items.minLength).toBe(1);
    expect(settingsRow.properties.description.minLength).toBe(1);
  });

  it("allows an optional frame path on a page", () => {
    const properties = committed.properties as Record<string, any>;
    const page = properties.contributes.properties.pages.items;
    expect(page.properties.frame.type).toBe("string");
    expect(page.properties.frame.description).toMatch(/\.html/);
    expect(page.required).toEqual(["id", "title", "command"]);
  });
});

describe("frameEntry", () => {
  const withFrameEntry = (frameEntry: unknown) => ({ ...PLUGIN_MANIFEST, frameEntry });

  it("accepts a relative .ts or .tsx source and a relative .js bundle, without customUi", () => {
    for (const source of ["frame/entry.tsx", "frame/entry.ts", "./frame/entry.tsx"]) {
      expect(
        pluginManifestSchema.safeParse(withFrameEntry({ source, bundle: "assets/frame.js" }))
          .success,
        source
      ).toBe(true);
    }
    expect(
      pluginManifestSchema.safeParse(
        withFrameEntry({ source: "frame/entry.tsx", bundle: "./frame.js" })
      ).success
    ).toBe(true);
  });

  it("refuses a path that leaves the Plugin folder or names the wrong file type", () => {
    for (const frameEntry of [
      { source: "../frame/entry.tsx", bundle: "assets/frame.js" },
      { source: "/frame/entry.tsx", bundle: "assets/frame.js" },
      { source: "frame\\entry.tsx", bundle: "assets/frame.js" },
      { source: "frame/entry.js", bundle: "assets/frame.js" },
      { source: "frame/entry.tsx", bundle: "../assets/frame.js" },
      { source: "frame/entry.tsx", bundle: "assets/frame.ts" },
      { source: "frame/entry.tsx" },
    ]) {
      expect(
        pluginManifestSchema.safeParse(withFrameEntry(frameEntry)).success,
        JSON.stringify(frameEntry)
      ).toBe(false);
    }
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

describe("toolbar button Toggle Button flag", () => {
  const withToolbarButton = (button: Record<string, unknown>) => ({
    ...PLUGIN_MANIFEST,
    contributes: {
      toolbarButtons: [{ id: "toggleHighlights", command: "run", icon: "highlighter", ...button }],
    },
  });

  it("accepts toggle: true on a toolbar button", () => {
    expect(pluginManifestSchema.safeParse(withToolbarButton({ toggle: true })).success).toBe(true);
  });

  it("accepts a toolbar button without toggle, which is a plain button", () => {
    expect(pluginManifestSchema.safeParse(withToolbarButton({})).success).toBe(true);
  });

  it("rejects a non-boolean toggle", () => {
    expect(pluginManifestSchema.safeParse(withToolbarButton({ toggle: "yes" })).success).toBe(
      false
    );
  });
});
